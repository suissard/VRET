import fs from 'node:fs';
import express from 'express';
import QRCode from 'qrcode';
import { getLocalIPv4Addresses } from '../certs.js';

export function createApiRouter({ db, sessionManager, certInfo, port, httpPort }) {
  const router = express.Router();

  router.get('/status', async (req, res) => {
    try {
      const detected = getLocalIPv4Addresses();
      const primaryIp = detected[0]?.address || '127.0.0.1';
      const pin = sessionManager.pin;

      const mobileUrl = `https://${primaryIp}:${port}/mobile?pin=${pin}`;
      const vrUrl = `https://${primaryIp}:${port}/vr?pin=${pin}`;
      const mdnsUrl = `https://vret.local:${port}`;
      const setupHttpUrl = httpPort ? `http://${primaryIp}:${httpPort}/setup` : `https://${primaryIp}:${port}/setup`;

      const [mobileQr, vrQr, setupQr] = await Promise.all([
        QRCode.toDataURL(mobileUrl, { margin: 1, width: 220 }),
        QRCode.toDataURL(vrUrl, { margin: 1, width: 220 }),
        QRCode.toDataURL(setupHttpUrl, { margin: 1, width: 180 }),
      ]);

      res.json({
        ok: true,
        pin,
        port,
        httpPort,
        primaryIp,
        ips: detected,
        urls: {
          mobile: mobileUrl,
          vr: vrUrl,
          pc: `https://${primaryIp}:${port}/pc`,
          mdns: mdnsUrl,
          setup: setupHttpUrl,
        },
        qrCodes: {
          mobile: mobileQr,
          vr: vrQr,
          setup: setupQr,
        },
        certsMethod: certInfo?.method || 'unknown',
        state: sessionManager.getPublicState(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/pin/regenerate', (req, res) => {
    const pin = sessionManager.regeneratePin();
    res.json({ ok: true, pin });
  });

  router.get('/patients', (req, res) => {
    res.json({ ok: true, patients: db.listPatients() });
  });

  router.post('/patients', (req, res) => {
    try {
      const { id, notes } = req.body || {};
      const patient = db.createPatient({ id, notes });
      res.status(201).json({ ok: true, patient });
    } catch (err) {
      const status = err.message.includes('UNIQUE') ? 409 : 400;
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.get('/sessions', (req, res) => {
    const patientId = req.query.patientId ? String(req.query.patientId) : null;
    res.json({ ok: true, sessions: db.listSessions(patientId) });
  });

  router.post('/sessions/start', (req, res) => {
    try {
      const { patientId, initialScene } = req.body || {};
      if (!patientId) {
        return res.status(400).json({ ok: false, error: 'patientId requis.' });
      }
      const sessionId = sessionManager.startClinicalSession(String(patientId), initialScene);
      res.status(201).json({ ok: true, sessionId, state: sessionManager.getPublicState() });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.post('/sessions/:id/end', (req, res) => {
    const id = Number(req.params.id);
    const { summaryNotes } = req.body || {};
    if (sessionManager.state.sessionId === id) {
      const ended = sessionManager.endClinicalSession(summaryNotes);
      return res.json({ ok: true, session: ended, state: sessionManager.getPublicState() });
    }
    const ended = db.endSession(id, summaryNotes);
    if (!ended) return res.status(404).json({ ok: false, error: 'Séance introuvable.' });
    res.json({ ok: true, session: ended });
  });

  router.put('/sessions/:id/notes', (req, res) => {
    const id = Number(req.params.id);
    const { summaryNotes } = req.body || {};
    const updated = db.updateSessionNotes(id, summaryNotes);
    if (!updated) return res.status(404).json({ ok: false, error: 'Séance introuvable.' });
    res.json({ ok: true, session: updated });
  });

  router.get('/sessions/:id/details', (req, res) => {
    const id = Number(req.params.id);
    const details = db.getSessionDetails(id);
    if (!details) return res.status(404).json({ ok: false, error: 'Séance introuvable.' });
    res.json({ ok: true, ...details });
  });

  router.get('/sessions/:id/export.csv', (req, res) => {
    const id = Number(req.params.id);
    const csv = db.exportSessionCsv(id);
    if (csv === null) return res.status(404).json({ ok: false, error: 'Séance introuvable.' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="vret-session-${id}.csv"`);
    res.send(csv);
  });

  // Paliers cliniques personnalisés (CRUD + ordonnancement facile -> difficile)
  router.get('/presets', (req, res) => {
    const sceneId = req.query.sceneId ? String(req.query.sceneId) : null;
    res.json({ ok: true, presets: db.listPresets(sceneId) });
  });

  router.post('/presets', (req, res) => {
    try {
      const { sceneId, label, params, difficultyOrder } = req.body || {};
      const preset = db.createPreset({ sceneId, label, params, difficultyOrder });
      sessionManager.broadcastState();
      res.status(201).json({ ok: true, preset, presets: db.listPresets(sceneId) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.put('/presets/reorder', (req, res) => {
    try {
      const { sceneId, orderedIds } = req.body || {};
      if (!sceneId) {
        return res.status(400).json({ ok: false, error: 'sceneId requis.' });
      }
      const presets = db.reorderPresets(String(sceneId), orderedIds);
      sessionManager.broadcastState();
      res.json({ ok: true, presets });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.put('/presets/:id', (req, res) => {
    try {
      const { label, params, difficultyOrder } = req.body || {};
      const updated = db.updatePreset(req.params.id, { label, params, difficultyOrder });
      if (!updated) return res.status(404).json({ ok: false, error: 'Palier introuvable.' });
      sessionManager.broadcastState();
      res.json({ ok: true, preset: updated, presets: db.listPresets(updated.sceneId) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  router.delete('/presets/:id', (req, res) => {
    const existing = db.getPreset(req.params.id);
    if (!existing) return res.status(404).json({ ok: false, error: 'Palier introuvable.' });
    db.deletePreset(req.params.id);
    sessionManager.broadcastState();
    res.json({ ok: true, presets: db.listPresets(existing.sceneId) });
  });

  router.get('/certs/rootCA.pem', (req, res) => {
    if (!certInfo?.caCertPath || !fs.existsSync(certInfo.caCertPath)) {
      return res.status(404).json({ ok: false, error: 'Certificat CA introuvable.' });
    }
    res.setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.setHeader('Content-Disposition', 'attachment; filename="vret-rootCA.crt"');
    res.sendFile(certInfo.caCertPath);
  });

  return router;
}
