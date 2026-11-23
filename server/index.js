import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Bonjour } from 'bonjour-service';

import { ensureCertificates, DEFAULT_CERTS_DIR, getLocalIPv4Addresses } from './certs.js';
import { VretDatabase, DEFAULT_DB_PATH } from './db.js';
import { SessionManager } from './sessionManager.js';
import { createApiRouter } from './routes/api.js';
import { parseMessage, createMessage, MSG_TYPES } from '../shared/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function renderSetupHtml(httpsPort, primaryIp) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VRET — Installation Certificat Local</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0b1120; color: #e2e8f0; margin: 0; padding: 24px; line-height: 1.5; }
    .card { max-width: 680px; margin: 0 auto; background: #111827; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; }
    h1 { margin-top: 0; font-size: 1.4rem; color: #38bdf8; }
    .btn { display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 14px 22px; border-radius: 10px; font-weight: 700; margin: 12px 0; }
    .btn-alt { background: #1e293b; border: 1px solid #334155; margin-left: 8px; }
    ol { padding-left: 20px; }
    li { margin-bottom: 10px; }
    code { background: #1e293b; padding: 2px 6px; border-radius: 4px; color: #7dd3fc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Configuration HTTPS Locale VRET</h1>
    <p>Les API <strong>WebXR</strong>, <strong>Web Audio</strong> et <strong>WebRTC</strong> exigent un certificat de confiance. Installez ce certificat racine local une seule fois sur l'appareil :</p>
    <p>
      <a class="btn" href="/ca.crt">1. Télécharger le certificat (vret-rootCA.crt)</a>
      <a class="btn btn-alt" href="https://${primaryIp}:${httpsPort}/vr">Ouvrir Client VR</a>
      <a class="btn btn-alt" href="https://${primaryIp}:${httpsPort}/mobile">Ouvrir Mobile</a>
    </p>
    <ol>
      <li><strong>Meta Quest / Pico (Android)</strong> : Téléchargez le certificat ci-dessus, puis allez dans <em>Paramètres &rarr; Sécurité &rarr; Chiffrement et identifiants &rarr; Installer un certificat &rarr; Certificat CA</em>.</li>
      <li><strong>iPhone / iPad (iOS)</strong> : Téléchargez avec Safari, puis <em>Réglages &rarr; Général &rarr; VPN et gestion des appareils</em> (installer le profil), puis <em>Informations &rarr; Réglages des certificats</em> (activer la confiance).</li>
      <li><strong>Android</strong> : <em>Paramètres &rarr; Sécurité &rarr; Installer depuis le stockage / Certificat CA</em>.</li>
    </ol>
    <p>URL locale directe : <code>https://${primaryIp}:${httpsPort}</code> ou <code>https://vret.local:${httpsPort}</code></p>
  </div>
</body>
</html>`;
}

export async function createVretServer(options = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 8443);
  const httpPort = options.httpPort ?? Number(process.env.HTTP_PORT ?? 8080);
  const certsDir = options.certsDir ?? DEFAULT_CERTS_DIR;
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const enableMdns = options.enableMdns ?? process.env.DISABLE_MDNS !== '1';

  const certInfo = ensureCertificates(certsDir);
  const db = new VretDatabase(dbPath);
  const sessionManager = new SessionManager(db, { pin: options.pin });

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Fichiers partagés & vendeur Three.js 100% hors-ligne
  app.use('/shared', express.static(path.join(ROOT_DIR, 'shared')));
  app.use('/vendor/three', express.static(path.join(ROOT_DIR, 'node_modules', 'three')));

  // Interfaces applicatives
  app.use('/vr', express.static(path.join(ROOT_DIR, 'client-vr')));
  app.use('/mobile', express.static(path.join(ROOT_DIR, 'client-mobile')));
  app.use('/pc', express.static(path.join(ROOT_DIR, 'client-pc')));

  // Onboarding certificat accessible aussi en HTTPS
  app.get('/setup', (req, res) => {
    const primaryIp = getLocalIPv4Addresses()[0]?.address || '127.0.0.1';
    res.type('html').send(renderSetupHtml(httpsServer.address().port, primaryIp));
  });
  app.get('/ca.crt', (req, res) => {
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="vret-rootCA.crt"');
    res.sendFile(certInfo.caCertPath);
  });

  app.get('/', (req, res) => {
    res.redirect('/pc/');
  });

  const httpsServer = https.createServer({ key: certInfo.key, cert: certInfo.cert }, app);

  async function listenHttps(targetPort) {
    await new Promise((resolve, reject) => {
      const onErr = (err) => {
        httpsServer.removeListener('listening', onListen);
        reject(err);
      };
      const onListen = () => {
        httpsServer.removeListener('error', onErr);
        resolve();
      };
      httpsServer.once('error', onErr);
      httpsServer.once('listening', onListen);
      httpsServer.listen(targetPort, '0.0.0.0');
    });
  }

  try {
    await listenHttps(port);
  } catch (err) {
    const canFallback = err.code === 'EADDRINUSE' && options.port === undefined && !process.env.PORT && port === 8443;
    if (!canFallback) throw err;
    console.warn('[HTTPS] Port 8443 déjà utilisé sur cet hôte, repli automatique sur le port 8445.');
    await listenHttps(8445);
  }

  const actualPort = httpsServer.address().port;

  // Serveur HTTP compagnon (:8080) : permet l'onboarding certificat (/setup, /ca.crt)
  // ET l'accès local complet sur http://localhost:8080/pc sans avertissement SSL.
  let httpServer = null;
  let actualHttpPort = null;
  if (httpPort !== 0 && httpPort !== false) {
    httpServer = http.createServer(app);
    try {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(httpPort, '0.0.0.0', () => {
          httpServer.removeListener('error', reject);
          resolve();
        });
      });
      actualHttpPort = httpServer.address().port;
    } catch (err) {
      console.warn(`[HTTP] Port ${httpPort} indisponible (${err.message}), HTTP désactivé.`);
      httpServer = null;
    }
  }

  // Monter l'API REST maintenant que actualPort & actualHttpPort sont connus
  app.use(
    '/api',
    createApiRouter({
      db,
      sessionManager,
      certInfo,
      port: actualPort,
      httpPort: actualHttpPort,
    })
  );

  // Serveur WebSocket temps réel sur /ws (HTTPS + HTTP localhost)
  function attachWs(wsServer) {
    wsServer.on('connection', (socket) => {
      socket.vretAuthenticated = false;
      socket.vretRole = null;

      socket.on('message', (raw) => {
        const msg = parseMessage(raw);
        if (!msg) {
          socket.send(JSON.stringify(createMessage(MSG_TYPES.ERROR, { message: 'JSON invalide.' })));
          return;
        }
        sessionManager.handleMessage(socket, msg);
      });

      socket.on('close', () => {
        sessionManager.handleDisconnect(socket);
      });

      socket.on('error', () => {
        sessionManager.handleDisconnect(socket);
      });
    });
  }

  const wss = new WebSocketServer({ server: httpsServer, path: '/ws' });
  attachWs(wss);

  let httpWss = null;
  if (httpServer) {
    httpWss = new WebSocketServer({ server: httpServer, path: '/ws' });
    attachWs(httpWss);
  }

  // Annonce mDNS vret.local
  let bonjour = null;
  let mdnsService = null;
  if (enableMdns) {
    try {
      bonjour = new Bonjour();
      mdnsService = bonjour.publish({
        name: 'VRET Clinical Platform',
        type: 'https',
        port: actualPort,
        host: 'vret.local',
      });
    } catch (err) {
      console.warn(`[mDNS] Publication ignorée: ${err.message}`);
    }
  }

  async function close() {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise((resolve) => wss.close(resolve));
    if (httpWss) {
      for (const client of httpWss.clients) {
        client.terminate();
      }
      await new Promise((resolve) => httpWss.close(resolve));
    }
    await new Promise((resolve) => httpsServer.close(resolve));
    if (httpServer) {
      await new Promise((resolve) => httpServer.close(resolve));
    }
    if (mdnsService && typeof mdnsService.stop === 'function') {
      try {
        mdnsService.stop();
      } catch {
        // ignore
      }
    }
    if (bonjour) {
      try {
        bonjour.destroy();
      } catch {
        // ignore
      }
    }
    db.close();
  }

  return {
    port: actualPort,
    httpPort: actualHttpPort,
    db,
    sessionManager,
    certInfo,
    httpsServer,
    httpServer,
    wss,
    close,
  };
}

// Exécution directe
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const srv = await createVretServer();
  const ips = getLocalIPv4Addresses().map((i) => i.address);
  const primaryIp = ips[0] || '127.0.0.1';
  console.log('==============================================================');
  console.log('  VRET WebXR Clinical Platform — Serveur Local Démarré');
  console.log('==============================================================');
  console.log(`  PIN Session    : ${srv.sessionManager.pin}`);
  console.log(`  Dashboard PC   : https://${primaryIp}:${srv.port}/pc`);
  if (srv.httpPort) {
    console.log(`  PC (sans SSL)  : http://localhost:${srv.httpPort}/pc`);
    console.log(`  Setup Cert CA  : http://${primaryIp}:${srv.httpPort}/setup`);
  }
  console.log(`  Mobile PWA     : https://${primaryIp}:${srv.port}/mobile?pin=${srv.sessionManager.pin}`);
  console.log(`  Client VR      : https://${primaryIp}:${srv.port}/vr?pin=${srv.sessionManager.pin}`);
  console.log(`  mDNS           : https://vret.local:${srv.port}/pc`);
  console.log('==============================================================');

  const shutdown = async () => {
    console.log('\nArrêt propre du serveur VRET...');
    await srv.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
