import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_CERTS_DIR = path.join(ROOT_DIR, 'certs');

/**
 * Détecte toutes les adresses IPv4 locales non-loopback actives sur la machine hôte.
 */
export function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Prioriser les interfaces LAN classiques (192.168.x, 10.x, 172.16-31.x) avant docker/tailscale
        const isVirtual = name.startsWith('docker') || name.startsWith('br-') || name.startsWith('veth') || name.startsWith('tailscale');
        ips.push({ address: addr.address, interface: name, isVirtual });
      }
    }
  }
  ips.sort((a, b) => Number(a.isVirtual) - Number(b.isVirtual));
  return ips;
}

function hasMkcert() {
  try {
    execFileSync('which', ['mkcert'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function writeOpensslConfig(configPath, ipv4List) {
  const altNames = [
    'DNS.1 = localhost',
    'DNS.2 = vret.local',
    'DNS.3 = *.vret.local',
    'IP.1 = 127.0.0.1',
  ];
  let ipIdx = 2;
  for (const ip of ipv4List) {
    altNames.push(`IP.${ipIdx++} = ${ip}`);
  }

  const content = `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C = FR
O = VRET Local Clinical Server
CN = vret.local

[v3_req]
basicConstraints = critical, CA:FALSE
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
${altNames.join('\n')}
`;
  fs.writeFileSync(configPath, content, 'utf8');
}

function writeCaConfig(configPath) {
  const content = `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ca

[dn]
C = FR
O = VRET Clinical Local Root CA
CN = VRET Local Root CA

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
`;
  fs.writeFileSync(configPath, content, 'utf8');
}

/**
 * Vérifie si les certificats existent et couvrent bien toutes les IPs locales actuelles.
 * Sinon, génère une PKI locale (CA persistante + certificat serveur SAN).
 */
export function ensureCertificates(certsDir = DEFAULT_CERTS_DIR, forceRegenerate = false) {
  fs.mkdirSync(certsDir, { recursive: true });

  const caKeyPath = path.join(certsDir, 'rootCA.key');
  const caCertPath = path.join(certsDir, 'rootCA.pem');
  const serverKeyPath = path.join(certsDir, 'server.key');
  const serverCertPath = path.join(certsDir, 'server.pem');
  const metaPath = path.join(certsDir, 'certs-meta.json');

  const detectedIps = getLocalIPv4Addresses().map((i) => i.address);
  const ipSignature = [...new Set(['127.0.0.1', ...detectedIps])].sort().join(',');

  let existingMeta = null;
  if (fs.existsSync(metaPath)) {
    try {
      existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      existingMeta = null;
    }
  }

  const allExist =
    fs.existsSync(caCertPath) &&
    fs.existsSync(serverKeyPath) &&
    fs.existsSync(serverCertPath);

  if (!forceRegenerate && allExist && existingMeta?.ipSignature === ipSignature) {
    return {
      key: fs.readFileSync(serverKeyPath),
      cert: fs.readFileSync(serverCertPath),
      caCertPath,
      serverCertPath,
      serverKeyPath,
      method: existingMeta.method || 'cached',
      ips: detectedIps,
    };
  }

  let method = 'openssl';

  if (hasMkcert() && !process.env.VRET_FORCE_OPENSSL) {
    try {
      const caroot = execFileSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).trim();
      const mkcertCa = path.join(caroot, 'rootCA.pem');
      if (fs.existsSync(mkcertCa)) {
        fs.copyFileSync(mkcertCa, caCertPath);
      } else {
        execFileSync('mkcert', ['-install'], { stdio: 'ignore' });
        if (fs.existsSync(mkcertCa)) fs.copyFileSync(mkcertCa, caCertPath);
      }
      const sanHosts = ['localhost', 'vret.local', '127.0.0.1', ...detectedIps];
      execFileSync(
        'mkcert',
        ['-cert-file', serverCertPath, '-key-file', serverKeyPath, ...sanHosts],
        { stdio: 'pipe' }
      );
      if (fs.existsSync(caCertPath) && fs.existsSync(serverCertPath)) {
        method = 'mkcert';
      }
    } catch {
      method = 'openssl';
    }
  }

  if (method === 'openssl' || !fs.existsSync(serverCertPath) || !fs.existsSync(caCertPath)) {
    method = 'openssl';
    const caConf = path.join(certsDir, 'ca.cnf');
    const srvConf = path.join(certsDir, 'server.cnf');
    const srvCsr = path.join(certsDir, 'server.csr');
    const caSrl = path.join(certsDir, 'rootCA.srl');

    // Générer la CA racine uniquement si elle n'existe pas encore (évite de devoir la réinstaller sur les casques)
    if (forceRegenerate || !fs.existsSync(caKeyPath) || !fs.existsSync(caCertPath)) {
      writeCaConfig(caConf);
      execFileSync('openssl', ['genrsa', '-out', caKeyPath, '2048'], { stdio: 'pipe' });
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-new',
          '-nodes',
          '-key',
          caKeyPath,
          '-sha256',
          '-days',
          '3650',
          '-out',
          caCertPath,
          '-config',
          caConf,
          '-extensions',
          'v3_ca',
        ],
        { stdio: 'pipe' }
      );
    }

    writeOpensslConfig(srvConf, detectedIps);
    execFileSync('openssl', ['genrsa', '-out', serverKeyPath, '2048'], { stdio: 'pipe' });
    execFileSync(
      'openssl',
      ['req', '-new', '-key', serverKeyPath, '-out', srvCsr, '-config', srvConf],
      { stdio: 'pipe' }
    );
    execFileSync(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        srvCsr,
        '-CA',
        caCertPath,
        '-CAkey',
        caKeyPath,
        '-CAcreateserial',
        '-CAserial',
        caSrl,
        '-out',
        serverCertPath,
        '-days',
        '365',
        '-sha256',
        '-extensions',
        'v3_req',
        '-extfile',
        srvConf,
      ],
      { stdio: 'pipe' }
    );
  }

  fs.writeFileSync(
    metaPath,
    JSON.stringify({ method, ipSignature, generatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  return {
    key: fs.readFileSync(serverKeyPath),
    cert: fs.readFileSync(serverCertPath),
    caCertPath,
    serverCertPath,
    serverKeyPath,
    method,
    ips: detectedIps,
  };
}

if (process.argv.includes('--generate')) {
  const force = process.argv.includes('--force');
  const res = ensureCertificates(DEFAULT_CERTS_DIR, force);
  console.log(`[PKI] Certificats prêts (${res.method}) dans ${DEFAULT_CERTS_DIR}`);
  console.log(`[PKI] CA racine : ${res.caCertPath}`);
  console.log(`[PKI] IPs couvertes : ${['127.0.0.1', ...res.ips].join(', ')}`);
}
