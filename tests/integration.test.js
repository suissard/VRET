import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { createVretServer } from '../server/index.js';
import { ensureCertificates } from '../server/certs.js';
import { MSG_TYPES, ROLES, createMessage, parseMessage } from '../shared/protocol.js';
import { validateAndClampParam } from '../shared/scenes-schema.js';

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          let parsed = body;
          if ((res.headers['content-type'] || '').includes('application/json')) {
            parsed = JSON.parse(body);
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function connectWsClient(port, role, pin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, {
      rejectUnauthorized: false,
    });
    const messages = [];
    const waiters = [];

    ws.on('message', (raw) => {
      const msg = parseMessage(raw);
      if (!msg) return;
      const idx = waiters.findIndex((w) => w.predicate(msg));
      if (idx !== -1) {
        const w = waiters.splice(idx, 1)[0];
        w.resolve(msg);
      } else {
        messages.push(msg);
      }
    });

    ws.waitFor = (predicate, timeoutMs = 3000) => {
      const existingIdx = messages.findIndex(predicate);
      if (existingIdx !== -1) {
        return Promise.resolve(messages.splice(existingIdx, 1)[0]);
      }
      return new Promise((res, rej) => {
        const timer = setTimeout(() => {
          rej(new Error(`Timeout waiting for WS message on ${role}`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            res(m);
          },
        });
      });
    };

    ws.on('open', () => {
      ws.send(JSON.stringify(createMessage(MSG_TYPES.AUTH, { role, pin })));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

test('Validation et bornage des paramètres du schéma partagé', () => {
  assert.deepEqual(validateAndClampParam('elevator', 'cabin_size', 99), { valid: true, value: 1.5 });
  assert.deepEqual(validateAndClampParam('elevator', 'cabin_size', 0.1), { valid: true, value: 0.6 });
  assert.deepEqual(validateAndClampParam('acrophobia', 'height_floor', 25.4), { valid: true, value: 25 });
  assert.deepEqual(validateAndClampParam('acrophobia', 'floor_opacity', -0.5), { valid: true, value: 0 });
  assert.deepEqual(validateAndClampParam('acrophobia', 'platform_width', 0.2), { valid: true, value: 0.4 });
  assert.deepEqual(validateAndClampParam('acrophobia', 'platform_length', 15), { valid: true, value: 10 });
  assert.deepEqual(validateAndClampParam('safe_space', 'environment', 'forest'), { valid: true, value: 'forest' });
  assert.equal(validateAndClampParam('safe_space', 'environment', 'desert').valid, false);
  assert.deepEqual(validateAndClampParam('elevator', 'door_state', 'stuck'), { valid: true, value: 'stuck' });
  assert.equal(validateAndClampParam('elevator', 'door_state', 'broken').valid, false);
});

test('Génération PKI locale autonome avec OpenSSL (CA + SAN IP)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vret-certs-'));
  try {
    process.env.VRET_FORCE_OPENSSL = '1';
    const res = ensureCertificates(tmpDir, true);
    assert.ok(fs.existsSync(res.caCertPath));
    assert.ok(fs.existsSync(res.serverCertPath));
    const sanOutput = execFileSync('openssl', ['x509', '-in', res.serverCertPath, '-noout', '-text'], {
      encoding: 'utf8',
    });
    assert.match(sanOutput, /vret\.local/);
    assert.match(sanOutput, /127\.0\.0\.1/);
  } finally {
    delete process.env.VRET_FORCE_OPENSSL;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Intégration complète Serveur HTTPS + API REST + SQLite + WebSocket multi-rôles', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vret-int-'));
  const srv = await createVretServer({
    port: 0,
    httpPort: 0,
    certsDir: path.join(tmpDir, 'certs'),
    dbPath: path.join(tmpDir, 'vret.db'),
    pin: '4829',
    enableMdns: false,
  });

  let vrWs, mobWs, pcWs;
  try {
    // 1. Vérifier /api/status et les 3 interfaces servies en local
    const statusRes = await requestJson(`https://127.0.0.1:${srv.port}/api/status`);
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.pin, '4829');
    assert.ok(statusRes.body.qrCodes.mobile.startsWith('data:image/png;base64,'));

    for (const p of ['/vr/', '/mobile/', '/pc/', '/vendor/three/build/three.module.js', '/shared/protocol.js']) {
      const r = await requestJson(`https://127.0.0.1:${srv.port}${p}`);
      assert.equal(r.status, 200, `Expected 200 for ${p}`);
    }

    // 2. Créer un patient et démarrer une séance SQLite
    const createPat = await requestJson(`https://127.0.0.1:${srv.port}/api/patients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'PAT-TEST-01', notes: 'Test intégration' }),
    });
    assert.equal(createPat.status, 201);

    const startSes = await requestJson(`https://127.0.0.1:${srv.port}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: 'PAT-TEST-01', initialScene: 'acrophobia' }),
    });
    assert.equal(startSes.status, 201);
    const sessionId = startSes.body.sessionId;
    assert.equal(startSes.body.state.sceneId, 'acrophobia');

    // 3. Authentification WebSocket (rejet mauvais PIN, puis connexion VR + Mobile + PC)
    const badWs = await connectWsClient(srv.port, ROLES.MOBILE, '0000');
    const authErr = await badWs.waitFor((m) => m.type === MSG_TYPES.AUTH_ERROR);
    assert.equal(authErr.type, MSG_TYPES.AUTH_ERROR);
    badWs.close();

    vrWs = await connectWsClient(srv.port, ROLES.VR, '4829');
    await vrWs.waitFor((m) => m.type === MSG_TYPES.AUTH_OK);
    await vrWs.waitFor((m) => m.type === MSG_TYPES.STATE_SYNC);

    mobWs = await connectWsClient(srv.port, ROLES.MOBILE, '4829');
    await mobWs.waitFor((m) => m.type === MSG_TYPES.AUTH_OK);
    await mobWs.waitFor((m) => m.type === MSG_TYPES.STATE_SYNC);

    pcWs = await connectWsClient(srv.port, ROLES.PC, '4829');
    await pcWs.waitFor((m) => m.type === MSG_TYPES.AUTH_OK);
    await pcWs.waitFor((m) => m.type === MSG_TYPES.STATE_SYNC);

    // 4. Changement de scène & accusé SCENE_READY
    mobWs.send(JSON.stringify(createMessage(MSG_TYPES.SCENE_LOAD, { sceneId: 'arachnophobia' })));
    const loadingSync = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.sceneId === 'arachnophobia'
    );
    assert.equal(loadingSync.payload.sceneLoading, true);

    vrWs.send(JSON.stringify(createMessage(MSG_TYPES.SCENE_READY, { sceneId: 'arachnophobia' })));
    const readySync = await mobWs.waitFor(
      (m) =>
        m.type === MSG_TYPES.STATE_SYNC &&
        m.payload.sceneId === 'arachnophobia' &&
        m.payload.sceneLoading === false
    );
    assert.equal(readySync.payload.sceneId, 'arachnophobia');

    // 5. Modulation de paramètre + Safe Space + Likert + Marqueur
    mobWs.send(JSON.stringify(createMessage(MSG_TYPES.PARAM_UPDATE, { key: 'spider_count', value: 7 })));
    const paramSync = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.params.spider_count === 7
    );
    assert.equal(paramSync.payload.params.spider_count, 7);

    mobWs.send(JSON.stringify(createMessage(MSG_TYPES.SAFE_SPACE_TOGGLE, { active: true })));
    const safeSync = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.safeSpace === true
    );
    assert.equal(safeSync.payload.safeSpace, true);

    mobWs.send(
      JSON.stringify(
        createMessage(MSG_TYPES.LIKERT_TRIGGER, {
          promptId: 'p-1',
          question: 'Anxiété ?',
          scaleMin: 0,
          scaleMax: 10,
        })
      )
    );
    const likertAsk = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.activeLikert?.promptId === 'p-1'
    );
    assert.equal(likertAsk.payload.activeLikert.question, 'Anxiété ?');

    vrWs.send(
      JSON.stringify(
        createMessage(MSG_TYPES.LIKERT_RESPONSE, { promptId: 'p-1', value: 6, responseTimeMs: 2400 })
      )
    );
    const likertDone = await pcWs.waitFor(
      (m) =>
        m.type === MSG_TYPES.STATE_SYNC &&
        m.payload.activeLikert === null &&
        m.payload.likertHistory.length === 1
    );
    assert.equal(likertDone.payload.likertHistory[0].score, 6);

    // 6. Clôture de séance et vérification des détails + export CSV
    const endRes = await requestJson(`https://127.0.0.1:${srv.port}/api/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryNotes: 'Bonne habituation finale.' }),
    });
    assert.equal(endRes.status, 200);

    const detailsRes = await requestJson(`https://127.0.0.1:${srv.port}/api/sessions/${sessionId}/details`);
    assert.equal(detailsRes.status, 200);
    assert.equal(detailsRes.body.likert.length, 1);
    assert.equal(detailsRes.body.likert[0].activeParams.spider_count, 7);
    assert.equal(detailsRes.body.likert[0].activeParams.safeSpace, true);

    const csvRes = await requestJson(`https://127.0.0.1:${srv.port}/api/sessions/${sessionId}/export.csv`);
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.body, /PAT-TEST-01/);
    assert.match(csvRes.body, /SAFE_SPACE_ON/);
    assert.match(csvRes.body, /LIKERT/);

    // 7. Paliers personnalisés (Création, Édition, Réordonnancement facile -> dur, Application & Suppression)
    const initialPresetsRes = await requestJson(`https://127.0.0.1:${srv.port}/api/presets?sceneId=acrophobia`);
    assert.equal(initialPresetsRes.status, 200);
    assert.ok(initialPresetsRes.body.presets.length >= 5);

    const createPresetRes = await requestJson(`https://127.0.0.1:${srv.port}/api/presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneId: 'acrophobia',
        label: 'Planche intermédiaire perso',
        params: {
          height_floor: 15,
          railing_opacity: 0.15,
          floor_opacity: 0.4,
          platform_width: 0.8,
          platform_length: 6.0,
          wind_intensity: 0.4,
          weather: 'clear',
        },
      }),
    });
    assert.equal(createPresetRes.status, 201);
    const customId = createPresetRes.body.preset.id;
    assert.equal(createPresetRes.body.preset.params.platform_width, 0.8);

    const updatePresetRes = await requestJson(`https://127.0.0.1:${srv.port}/api/presets/${customId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'Planche intermédiaire éditée',
        params: { height_floor: 18, floor_opacity: 0.3 },
      }),
    });
    assert.equal(updatePresetRes.status, 200);
    assert.equal(updatePresetRes.body.preset.label, 'Planche intermédiaire éditée');
    assert.equal(updatePresetRes.body.preset.params.height_floor, 18);
    assert.equal(updatePresetRes.body.preset.params.floor_opacity, 0.3);

    const currentList = updatePresetRes.body.presets.map((p) => p.id);
    const reorderedIds = [customId, ...currentList.filter((id) => id !== customId)];
    const reorderRes = await requestJson(`https://127.0.0.1:${srv.port}/api/presets/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sceneId: 'acrophobia', orderedIds: reorderedIds }),
    });
    assert.equal(reorderRes.status, 200);
    assert.equal(reorderRes.body.presets[0].id, customId);

    // Charger acrophobia puis appliquer le palier personnalisé
    mobWs.send(JSON.stringify(createMessage(MSG_TYPES.SCENE_LOAD, { sceneId: 'acrophobia' })));
    await vrWs.waitFor((m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.sceneId === 'acrophobia');

    mobWs.send(JSON.stringify(createMessage(MSG_TYPES.PRESET_APPLY, { presetId: customId })));
    const presetApplied = await vrWs.waitFor(
      (m) =>
        m.type === MSG_TYPES.STATE_SYNC &&
        m.payload.sceneId === 'acrophobia' &&
        m.payload.params.height_floor === 18 &&
        m.payload.params.platform_width === 0.8 &&
        m.payload.params.floor_opacity === 0.3
    );
    assert.equal(presetApplied.payload.params.platform_width, 0.8);

    // 8. Configuration dynamique de la Safe Zone (forêt / prairie / ciel étoilé)
    mobWs.send(
      JSON.stringify(
        createMessage(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: 'environment', value: 'forest' })
      )
    );
    const safeEnvSync = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.safeSpaceParams?.environment === 'forest'
    );
    assert.equal(safeEnvSync.payload.safeSpaceParams.environment, 'forest');

    mobWs.send(
      JSON.stringify(
        createMessage(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: 'lighting_mood', value: 'starlight' })
      )
    );
    const safeMoodSync = await vrWs.waitFor(
      (m) => m.type === MSG_TYPES.STATE_SYNC && m.payload.safeSpaceParams?.lighting_mood === 'starlight'
    );
    assert.equal(safeMoodSync.payload.safeSpaceParams.lighting_mood, 'starlight');

    const delPresetRes = await requestJson(`https://127.0.0.1:${srv.port}/api/presets/${customId}`, {
      method: 'DELETE',
    });
    assert.equal(delPresetRes.status, 200);
    assert.ok(!delPresetRes.body.presets.some((p) => p.id === customId));
  } finally {
    vrWs?.close();
    mobWs?.close();
    pcWs?.close();
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
