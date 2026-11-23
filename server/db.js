import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { SCENES_SCHEMA, getTherapyScenes, sanitizeSceneParams } from '../shared/scenes-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
export const DEFAULT_DB_PATH = path.join(ROOT_DIR, 'data', 'vret.db');

export class VretDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.#initSchema();
    this.#seedDefaultPresetsIfEmpty();
    this.#seedDemoIfEmpty();
  }

  #initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        notes TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        initial_scene TEXT NOT NULL,
        summary_notes TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS events_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS likert_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL,
        scene_id TEXT NOT NULL,
        question TEXT NOT NULL,
        scale_min INTEGER NOT NULL,
        scale_max INTEGER NOT NULL,
        score INTEGER NOT NULL,
        response_time_ms INTEGER,
        active_params_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scene_presets (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        label TEXT NOT NULL,
        difficulty_order INTEGER NOT NULL DEFAULT 0,
        params_json TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_patient ON sessions(patient_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events_log(session_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_likert_session ON likert_responses(session_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_scene_presets_scene ON scene_presets(scene_id, difficulty_order ASC);
    `);
  }

  #seedDefaultPresetsIfEmpty() {
    const now = Date.now();
    const countStmt = this.db.prepare('SELECT COUNT(*) AS cnt FROM scene_presets WHERE scene_id = ?');
    const insertStmt = this.db.prepare(
      `INSERT INTO scene_presets (id, scene_id, label, difficulty_order, params_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    );

    for (const scene of getTherapyScenes()) {
      const row = countStmt.get(scene.id);
      if (row && row.cnt > 0) continue;
      (scene.presets || []).forEach((preset, idx) => {
        const sanitized = sanitizeSceneParams(scene.id, preset.params);
        insertStmt.run(
          preset.id,
          scene.id,
          preset.label,
          idx,
          JSON.stringify(sanitized),
          now,
          now
        );
      });
    }
  }

  #seedDemoIfEmpty() {
    const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM patients').get();
    if (countRow && countRow.cnt > 0) return;

    const now = Date.now();
    const baseTime = now - 3600 * 1000 * 24;

    this.createPatient({
      id: 'PAT-2026-001',
      notes: 'Suivi acrophobie — protocole exposition graduée (balcon puis passerelle).',
    });
    this.createPatient({
      id: 'PAT-2026-002',
      notes: 'Suivi claustrophobie — ascenseur urbain, travail sur la respiration.',
    });

    const sessionId = this.startSession('PAT-2026-001', 'acrophobia', baseTime);
    const demoEvents = [
      { dt: 0, type: 'SCENE_CHANGE', scene: 'acrophobia', payload: { sceneId: 'acrophobia', params: { height_floor: 2, railing_opacity: 1, floor_opacity: 1, platform_width: 4.2, platform_length: 5.0, wind_intensity: 0.1, weather: 'clear' } } },
      { dt: 120000, type: 'PARAM_CHANGE', scene: 'acrophobia', payload: { key: 'height_floor', value: 8 } },
      { dt: 240000, type: 'PARAM_CHANGE', scene: 'acrophobia', payload: { key: 'height_floor', value: 18 } },
      { dt: 300000, type: 'CLINICAL_MARKER', scene: 'acrophobia', payload: { markerId: 'anxiety_peak', label: 'Pic d’anxiété observé', note: 'Crispation mains sur rambarde' } },
      { dt: 330000, type: 'SAFE_SPACE_ON', scene: 'acrophobia', payload: { active: true } },
      { dt: 390000, type: 'SAFE_SPACE_OFF', scene: 'acrophobia', payload: { active: false } },
      { dt: 450000, type: 'CLINICAL_MARKER', scene: 'acrophobia', payload: { markerId: 'breathing', label: 'Respiration guidée', note: 'Retour au calme avant reprise' } },
      { dt: 540000, type: 'PARAM_CHANGE', scene: 'acrophobia', payload: { key: 'height_floor', value: 22 } },
      { dt: 660000, type: 'PARAM_CHANGE', scene: 'acrophobia', payload: { key: 'railing_opacity', value: 0.4 } },
    ];
    for (const ev of demoEvents) {
      this.logEvent(sessionId, ev.type, ev.scene, ev.payload, baseTime + ev.dt);
    }

    const demoLikert = [
      { dt: 30000, score: 3, rt: 2900, params: { height_floor: 2, railing_opacity: 1, floor_glass: false } },
      { dt: 150000, score: 5, rt: 3400, params: { height_floor: 8, railing_opacity: 1, floor_glass: false } },
      { dt: 280000, score: 8, rt: 4100, params: { height_floor: 18, railing_opacity: 1, floor_glass: false } },
      { dt: 370000, score: 3, rt: 2200, params: { safeSpace: true, height_floor: 18 } },
      { dt: 560000, score: 6, rt: 3100, params: { height_floor: 22, railing_opacity: 1, floor_glass: false } },
      { dt: 720000, score: 4, rt: 2600, params: { height_floor: 22, railing_opacity: 0.4, floor_glass: false } },
    ];
    for (const lk of demoLikert) {
      this.logLikertResponse(
        sessionId,
        {
          sceneId: 'acrophobia',
          question: 'Quel est votre niveau d’anxiété en ce moment ?',
          scaleMin: 0,
          scaleMax: 10,
          score: lk.score,
          responseTimeMs: lk.rt,
          activeParams: lk.params,
        },
        baseTime + lk.dt
      );
    }

    this.endSession(
      sessionId,
      'Séance de démonstration : pic SUDs 8/10 au 18e étage puis habituation progressive à 4/10 au 22e étage après passage en Safe Space.',
      baseTime + 780000
    );
  }

  listPatients() {
    return this.db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM sessions s WHERE s.patient_id = p.id) AS session_count,
                (SELECT MAX(started_at) FROM sessions s WHERE s.patient_id = p.id) AS last_session_at
         FROM patients p
         ORDER BY p.created_at DESC`
      )
      .all();
  }

  getPatient(id) {
    return this.db.prepare('SELECT * FROM patients WHERE id = ?').get(id) || null;
  }

  createPatient({ id, notes = '' }) {
    const cleanId = String(id || '').trim();
    if (!cleanId) {
      throw new Error('Identifiant pseudonyme patient requis.');
    }
    const createdAt = Date.now();
    this.db
      .prepare('INSERT INTO patients (id, created_at, notes) VALUES (?, ?, ?)')
      .run(cleanId, createdAt, String(notes || ''));
    return this.getPatient(cleanId);
  }

  listSessions(patientId = null) {
    const baseQuery = `
      SELECT s.*,
             (SELECT COUNT(*) FROM likert_responses l WHERE l.session_id = s.id) AS likert_count,
             (SELECT MAX(score) FROM likert_responses l WHERE l.session_id = s.id) AS max_score,
             (SELECT COUNT(*) FROM events_log e WHERE e.session_id = s.id AND e.event_type = 'SAFE_SPACE_ON') AS safe_space_count
      FROM sessions s
    `;
    if (patientId) {
      return this.db
        .prepare(`${baseQuery} WHERE s.patient_id = ? ORDER BY s.started_at DESC`)
        .all(patientId);
    }
    return this.db.prepare(`${baseQuery} ORDER BY s.started_at DESC`).all();
  }

  startSession(patientId, initialScene = 'elevator', startedAt = Date.now()) {
    const patient = this.getPatient(patientId);
    if (!patient) {
      throw new Error(`Patient introuvable: ${patientId}`);
    }
    const info = this.db
      .prepare(
        'INSERT INTO sessions (patient_id, started_at, initial_scene, summary_notes) VALUES (?, ?, ?, ?)'
      )
      .run(patientId, startedAt, initialScene, '');
    return Number(info.lastInsertRowid);
  }

  endSession(sessionId, summaryNotes = undefined, endedAt = Date.now()) {
    if (typeof summaryNotes === 'string') {
      this.db
        .prepare('UPDATE sessions SET ended_at = COALESCE(ended_at, ?), summary_notes = ? WHERE id = ?')
        .run(endedAt, summaryNotes, sessionId);
    } else {
      this.db
        .prepare('UPDATE sessions SET ended_at = COALESCE(ended_at, ?) WHERE id = ?')
        .run(endedAt, sessionId);
    }
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) || null;
  }

  updateSessionNotes(sessionId, summaryNotes) {
    this.db
      .prepare('UPDATE sessions SET summary_notes = ? WHERE id = ?')
      .run(String(summaryNotes || ''), sessionId);
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) || null;
  }

  logEvent(sessionId, eventType, sceneId, payload = {}, timestamp = Date.now()) {
    if (!sessionId) return null;
    const info = this.db
      .prepare(
        'INSERT INTO events_log (session_id, timestamp, event_type, scene_id, payload_json) VALUES (?, ?, ?, ?, ?)'
      )
      .run(sessionId, timestamp, eventType, sceneId, JSON.stringify(payload));
    return Number(info.lastInsertRowid);
  }

  logLikertResponse(
    sessionId,
    { sceneId, question, scaleMin, scaleMax, score, responseTimeMs = null, activeParams = {} },
    timestamp = Date.now()
  ) {
    if (!sessionId) return null;
    const info = this.db
      .prepare(
        `INSERT INTO likert_responses
         (session_id, timestamp, scene_id, question, scale_min, scale_max, score, response_time_ms, active_params_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        timestamp,
        sceneId,
        question,
        scaleMin,
        scaleMax,
        score,
        responseTimeMs,
        JSON.stringify(activeParams)
      );
    return Number(info.lastInsertRowid);
  }

  getSessionDetails(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;

    const patient = this.getPatient(session.patient_id);
    const events = this.db
      .prepare('SELECT * FROM events_log WHERE session_id = ? ORDER BY timestamp ASC, id ASC')
      .all(sessionId)
      .map((row) => ({
        ...row,
        payload: safeJsonParse(row.payload_json),
      }));

    const likert = this.db
      .prepare('SELECT * FROM likert_responses WHERE session_id = ? ORDER BY timestamp ASC, id ASC')
      .all(sessionId)
      .map((row) => ({
        ...row,
        activeParams: safeJsonParse(row.active_params_json),
      }));

    return { session, patient, events, likert };
  }

  exportSessionCsv(sessionId) {
    const details = this.getSessionDetails(sessionId);
    if (!details) return null;

    const rows = [];
    for (const ev of details.events) {
      rows.push({
        timestamp: ev.timestamp,
        iso: new Date(ev.timestamp).toISOString(),
        record_type: 'EVENT',
        event_or_question: ev.event_type,
        scene_id: ev.scene_id,
        score: '',
        scale: '',
        response_time_ms: '',
        details_json: ev.payload_json,
      });
    }
    for (const lk of details.likert) {
      rows.push({
        timestamp: lk.timestamp,
        iso: new Date(lk.timestamp).toISOString(),
        record_type: 'LIKERT',
        event_or_question: lk.question,
        scene_id: lk.scene_id,
        score: lk.score,
        scale: `${lk.scale_min}-${lk.scale_max}`,
        response_time_ms: lk.response_time_ms ?? '',
        details_json: lk.active_params_json,
      });
    }

    rows.sort((a, b) => a.timestamp - b.timestamp);

    const header = [
      'session_id',
      'patient_id',
      'timestamp_ms',
      'iso_time',
      'record_type',
      'event_or_question',
      'scene_id',
      'score',
      'scale',
      'response_time_ms',
      'details_json',
    ].join(',');

    const escapeCsv = (val) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = rows.map((r) =>
      [
        details.session.id,
        details.session.patient_id,
        r.timestamp,
        r.iso,
        r.record_type,
        r.event_or_question,
        r.scene_id,
        r.score,
        r.scale,
        r.response_time_ms,
        r.details_json,
      ]
        .map(escapeCsv)
        .join(',')
    );

    return [header, ...lines].join('\n');
  }

  listPresets(sceneId = null) {
    const rows = sceneId
      ? this.db
          .prepare(
            'SELECT * FROM scene_presets WHERE scene_id = ? ORDER BY difficulty_order ASC, created_at ASC'
          )
          .all(sceneId)
      : this.db
          .prepare(
            'SELECT * FROM scene_presets ORDER BY scene_id ASC, difficulty_order ASC, created_at ASC'
          )
          .all();

    return rows.map((r) => ({
      id: r.id,
      sceneId: r.scene_id,
      label: r.label,
      difficultyOrder: r.difficulty_order,
      params: safeJsonParse(r.params_json),
      isDefault: Boolean(r.is_default),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getPreset(id) {
    const r = this.db.prepare('SELECT * FROM scene_presets WHERE id = ?').get(String(id || ''));
    if (!r) return null;
    return {
      id: r.id,
      sceneId: r.scene_id,
      label: r.label,
      difficultyOrder: r.difficulty_order,
      params: safeJsonParse(r.params_json),
      isDefault: Boolean(r.is_default),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  createPreset({ sceneId, label, params = {}, difficultyOrder = undefined }) {
    const schema = SCENES_SCHEMA[sceneId];
    if (!schema || schema.hiddenFromCatalogue) {
      throw new Error(`Scène invalide pour palier: ${sceneId}`);
    }
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) {
      throw new Error('Nom du palier requis.');
    }

    const sanitized = sanitizeSceneParams(sceneId, params);
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(difficulty_order), -1) AS max_order FROM scene_presets WHERE scene_id = ?')
      .get(sceneId);
    const order = Number.isFinite(Number(difficultyOrder))
      ? Math.max(0, Math.round(Number(difficultyOrder)))
      : (maxRow?.max_order ?? -1) + 1;

    const id = `custom_${sceneId}_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO scene_presets (id, scene_id, label, difficulty_order, params_json, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, sceneId, cleanLabel, order, JSON.stringify(sanitized), now, now);

    return this.getPreset(id);
  }

  updatePreset(id, { label, params, difficultyOrder } = {}) {
    const existing = this.getPreset(id);
    if (!existing) return null;

    const nextLabel = label !== undefined ? String(label).trim() : existing.label;
    if (!nextLabel) {
      throw new Error('Nom du palier requis.');
    }
    const nextParams =
      params && typeof params === 'object'
        ? sanitizeSceneParams(existing.sceneId, { ...existing.params, ...params })
        : existing.params;
    const nextOrder = Number.isFinite(Number(difficultyOrder))
      ? Math.max(0, Math.round(Number(difficultyOrder)))
      : existing.difficultyOrder;

    this.db
      .prepare(
        `UPDATE scene_presets
         SET label = ?, params_json = ?, difficulty_order = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nextLabel, JSON.stringify(nextParams), nextOrder, Date.now(), existing.id);

    return this.getPreset(existing.id);
  }

  deletePreset(id) {
    const existing = this.getPreset(id);
    if (!existing) return false;
    this.db.prepare('DELETE FROM scene_presets WHERE id = ?').run(existing.id);
    return true;
  }

  reorderPresets(sceneId, orderedIds) {
    if (!Array.isArray(orderedIds)) {
      throw new Error('orderedIds doit être un tableau.');
    }
    const existing = this.listPresets(sceneId);
    const existingIds = existing.map((p) => p.id);
    const validOrdered = orderedIds.filter((id) => existingIds.includes(id));
    for (const id of existingIds) {
      if (!validOrdered.includes(id)) validOrdered.push(id);
    }

    const updateStmt = this.db.prepare(
      'UPDATE scene_presets SET difficulty_order = ?, updated_at = ? WHERE id = ? AND scene_id = ?'
    );
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      validOrdered.forEach((id, idx) => {
        updateStmt.run(idx, now, id, sceneId);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return this.listPresets(sceneId);
  }

  close() {
    this.db.close();
  }
}

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
