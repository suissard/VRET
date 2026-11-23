import { randomInt, randomUUID } from 'node:crypto';
import { MSG_TYPES, ROLES, createMessage } from '../shared/protocol.js';
import {
  SCENES_SCHEMA,
  getDefaultParams,
  validateAndClampParam,
} from '../shared/scenes-schema.js';

/**
 * Gère l'état canonique de la séance VRET ("Single Source of Truth")
 * et la diffusion temps réel vers le Casque VR, le Mobile et les Dashboards PC.
 */
export class SessionManager {
  constructor(db, options = {}) {
    this.db = db;
    this.pin = options.pin || String(randomInt(1000, 10000));

    this.state = {
      sessionId: null,
      patientId: null,
      sessionStartedAt: null,
      sceneId: 'elevator',
      sceneLoading: false,
      safeSpace: false,
      safeSpaceParams: getDefaultParams('safe_space'),
      params: getDefaultParams('elevator'),
      activeLikert: null,
      likertHistory: [],
      clinicalMarkers: [],
      videoStreamActive: false,
      vrStatus: {
        connected: false,
        inVR: false,
        fps: 0,
        battery: null,
        trackingLost: false,
        headPose: { y: 1.65 },
        interactionMode: 'controller',
        lastTelemetryAt: null,
      },
      connectedClients: {
        vr: false,
        mobile: false,
        pcCount: 0,
      },
    };

    // Sockets authentifiés par rôle
    this.vrSocket = null;
    this.mobileSocket = null;
    this.pcSockets = new Set();
  }

  regeneratePin() {
    this.pin = String(randomInt(1000, 10000));
    return this.pin;
  }

  getPublicState() {
    const allPresets = this.db.listPresets();
    const presetsByScene = {};
    for (const p of allPresets) {
      if (!presetsByScene[p.sceneId]) presetsByScene[p.sceneId] = [];
      presetsByScene[p.sceneId].push(p);
    }
    return {
      ...this.state,
      vrStatus: { ...this.state.vrStatus },
      connectedClients: { ...this.state.connectedClients },
      params: { ...this.state.params },
      safeSpaceParams: { ...this.state.safeSpaceParams },
      presetsByScene,
      likertHistory: this.state.likertHistory.slice(-20),
      clinicalMarkers: this.state.clinicalMarkers.slice(-20),
    };
  }

  #send(socket, type, payload) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(createMessage(type, payload)));
    }
  }

  broadcastState() {
    const stateSnapshot = this.getPublicState();
    const packet = JSON.stringify(createMessage(MSG_TYPES.STATE_SYNC, stateSnapshot));
    if (this.vrSocket?.readyState === 1) this.vrSocket.send(packet);
    if (this.mobileSocket?.readyState === 1) this.mobileSocket.send(packet);
    for (const pcSock of this.pcSockets) {
      if (pcSock.readyState === 1) pcSock.send(packet);
    }
  }

  #syncClientCounts() {
    const vrUp = Boolean(this.vrSocket && this.vrSocket.readyState === 1);
    const mobUp = Boolean(this.mobileSocket && this.mobileSocket.readyState === 1);
    for (const s of [...this.pcSockets]) {
      if (s.readyState !== 1) this.pcSockets.delete(s);
    }
    this.state.connectedClients = {
      vr: vrUp,
      mobile: mobUp,
      pcCount: this.pcSockets.size,
    };
    this.state.vrStatus.connected = vrUp;
  }

  /**
   * Démarre une séance clinique enregistrée en base SQLite.
   */
  startClinicalSession(patientId, initialScene = this.state.sceneId) {
    if (this.state.sessionId) {
      this.endClinicalSession();
    }
    const targetScene = SCENES_SCHEMA[initialScene] && !SCENES_SCHEMA[initialScene].hiddenFromCatalogue
      ? initialScene
      : 'elevator';

    const sessionId = this.db.startSession(patientId, targetScene);
    this.state.sessionId = sessionId;
    this.state.patientId = patientId;
    this.state.sessionStartedAt = Date.now();
    this.state.likertHistory = [];
    this.state.clinicalMarkers = [];

    if (this.state.sceneId !== targetScene) {
      this.state.sceneId = targetScene;
      this.state.params = getDefaultParams(targetScene);
      this.state.sceneLoading = this.state.connectedClients.vr;
    }

    this.db.logEvent(sessionId, 'SCENE_CHANGE', this.state.sceneId, {
      sceneId: this.state.sceneId,
      params: this.state.params,
      safeSpace: this.state.safeSpace,
    });

    this.broadcastState();
    return sessionId;
  }

  /**
   * Clôture la séance en cours dans SQLite.
   */
  endClinicalSession(summaryNotes = undefined) {
    if (!this.state.sessionId) return null;
    const ended = this.db.endSession(this.state.sessionId, summaryNotes);
    this.state.sessionId = null;
    this.state.patientId = null;
    this.state.sessionStartedAt = null;
    this.state.activeLikert = null;
    this.broadcastState();
    return ended;
  }

  handleDisconnect(socket) {
    const role = socket.vretRole;
    if (!role) return;

    if (role === ROLES.VR && this.vrSocket === socket) {
      this.vrSocket = null;
      this.state.vrStatus.connected = false;
      this.state.vrStatus.inVR = false;
      this.state.sceneLoading = false;
      this.state.videoStreamActive = false;
    } else if (role === ROLES.MOBILE && this.mobileSocket === socket) {
      this.mobileSocket = null;
    } else if (role === ROLES.PC) {
      this.pcSockets.delete(socket);
    }

    this.#syncClientCounts();
    this.broadcastState();
  }

  handleMessage(socket, msg) {
    const { type, payload } = msg;

    // Authentification obligatoire avant toute commande
    if (type === MSG_TYPES.AUTH) {
      this.#handleAuth(socket, payload);
      return;
    }

    if (!socket.vretAuthenticated) {
      this.#send(socket, MSG_TYPES.ERROR, { message: 'Non authentifié. Envoyez AUTH en premier.' });
      return;
    }

    const role = socket.vretRole;
    const isPractitioner = role === ROLES.MOBILE || role === ROLES.PC;

    switch (type) {
      case MSG_TYPES.SCENE_LOAD: {
        if (!isPractitioner) return;
        const { sceneId } = payload;
        if (!SCENES_SCHEMA[sceneId] || SCENES_SCHEMA[sceneId].hiddenFromCatalogue) {
          this.#send(socket, MSG_TYPES.ERROR, { message: `Scène invalide: ${sceneId}` });
          return;
        }
        this.state.sceneId = sceneId;
        this.state.params = getDefaultParams(sceneId);
        this.state.safeSpace = false;
        this.state.sceneLoading = Boolean(this.vrSocket && this.vrSocket.readyState === 1);
        this.db.logEvent(this.state.sessionId, 'SCENE_CHANGE', sceneId, {
          sceneId,
          params: this.state.params,
        });
        this.broadcastState();
        break;
      }

      case MSG_TYPES.SCENE_READY: {
        if (role !== ROLES.VR) return;
        this.state.sceneLoading = false;
        this.broadcastState();
        break;
      }

      case MSG_TYPES.PARAM_UPDATE: {
        if (!isPractitioner) return;
        const { key, value } = payload;
        const check = validateAndClampParam(this.state.sceneId, key, value);
        if (!check.valid) {
          this.#send(socket, MSG_TYPES.ERROR, { message: check.error });
          return;
        }
        this.state.params[key] = check.value;
        this.db.logEvent(this.state.sessionId, 'PARAM_CHANGE', this.state.sceneId, {
          key,
          value: check.value,
        });
        this.broadcastState();
        break;
      }

      case MSG_TYPES.PRESET_APPLY: {
        if (!isPractitioner) return;
        const dbPreset = this.db.getPreset(payload.presetId);
        let preset = dbPreset && dbPreset.sceneId === this.state.sceneId ? dbPreset : null;
        if (!preset) {
          const schema = SCENES_SCHEMA[this.state.sceneId];
          preset = schema?.presets?.find((p) => p.id === payload.presetId) || null;
        }
        if (!preset) {
          this.#send(socket, MSG_TYPES.ERROR, { message: 'Palier clinique introuvable' });
          return;
        }
        for (const [k, v] of Object.entries(preset.params)) {
          const check = validateAndClampParam(this.state.sceneId, k, v);
          if (check.valid) this.state.params[k] = check.value;
        }
        this.db.logEvent(this.state.sessionId, 'PRESET_APPLY', this.state.sceneId, {
          presetId: preset.id,
          label: preset.label,
          params: this.state.params,
        });
        this.broadcastState();
        break;
      }

      case MSG_TYPES.SAFE_SPACE_TOGGLE: {
        if (!isPractitioner) return;
        const active = typeof payload.active === 'boolean' ? payload.active : !this.state.safeSpace;
        this.state.safeSpace = active;
        this.db.logEvent(
          this.state.sessionId,
          active ? 'SAFE_SPACE_ON' : 'SAFE_SPACE_OFF',
          this.state.sceneId,
          { active, safeSpaceParams: this.state.safeSpaceParams }
        );
        this.broadcastState();
        break;
      }

      case MSG_TYPES.SAFE_SPACE_PARAM_UPDATE: {
        if (!isPractitioner) return;
        const { key, value } = payload;
        const check = validateAndClampParam('safe_space', key, value);
        if (!check.valid) {
          this.#send(socket, MSG_TYPES.ERROR, { message: check.error });
          return;
        }
        this.state.safeSpaceParams[key] = check.value;
        this.db.logEvent(this.state.sessionId, 'SAFE_SPACE_CONFIG', 'safe_space', {
          key,
          value: check.value,
        });
        this.broadcastState();
        break;
      }

      case MSG_TYPES.LIKERT_TRIGGER: {
        if (!isPractitioner) return;
        const promptId = payload.promptId || randomUUID();
        const scaleMin = Number.isFinite(Number(payload.scaleMin)) ? Number(payload.scaleMin) : 0;
        const scaleMax = Number.isFinite(Number(payload.scaleMax)) ? Number(payload.scaleMax) : 10;
        const step = Number.isFinite(Number(payload.step)) && Number(payload.step) > 0 ? Number(payload.step) : 1;
        this.state.activeLikert = {
          promptId,
          question: String(payload.question || 'Quel est votre niveau d’anxiété ?'),
          scaleMin,
          scaleMax,
          step,
          labels: Array.isArray(payload.labels) && payload.labels.length >= 2
            ? [String(payload.labels[0]), String(payload.labels[1])]
            : ['Calme', 'Panique'],
          triggeredAt: Date.now(),
        };
        this.broadcastState();
        break;
      }

      case MSG_TYPES.LIKERT_CANCEL: {
        if (!isPractitioner) return;
        this.state.activeLikert = null;
        this.broadcastState();
        break;
      }

      case MSG_TYPES.LIKERT_RESPONSE: {
        if (role !== ROLES.VR) return;
        const active = this.state.activeLikert;
        if (!active || (payload.promptId && payload.promptId !== active.promptId)) {
          return;
        }
        const score = Math.round(Number(payload.value));
        if (!Number.isFinite(score)) return;
        const clampedScore = Math.min(active.scaleMax, Math.max(active.scaleMin, score));
        const responseTimeMs = Number.isFinite(Number(payload.responseTimeMs))
          ? Math.max(0, Math.round(Number(payload.responseTimeMs)))
          : Date.now() - active.triggeredAt;

        const entry = {
          promptId: active.promptId,
          timestamp: Date.now(),
          sceneId: this.state.safeSpace ? 'safe_space' : this.state.sceneId,
          question: active.question,
          scaleMin: active.scaleMin,
          scaleMax: active.scaleMax,
          score: clampedScore,
          responseTimeMs,
        };

        this.state.likertHistory.push(entry);
        this.db.logLikertResponse(this.state.sessionId, {
          sceneId: this.state.sceneId,
          question: active.question,
          scaleMin: active.scaleMin,
          scaleMax: active.scaleMax,
          score: clampedScore,
          responseTimeMs,
          activeParams: {
            ...this.state.params,
            safeSpace: this.state.safeSpace,
          },
        });

        this.state.activeLikert = null;
        this.broadcastState();
        break;
      }

      case MSG_TYPES.CLINICAL_MARKER: {
        if (!isPractitioner) return;
        const marker = {
          id: randomUUID(),
          timestamp: Date.now(),
          markerId: String(payload.markerId || 'note'),
          label: String(payload.label || 'Note clinique'),
          note: String(payload.note || ''),
          sceneId: this.state.sceneId,
        };
        this.state.clinicalMarkers.push(marker);
        this.db.logEvent(this.state.sessionId, 'CLINICAL_MARKER', this.state.sceneId, {
          markerId: marker.markerId,
          label: marker.label,
          note: marker.note,
        });
        this.broadcastState();
        break;
      }

      case MSG_TYPES.TELEMETRY: {
        if (role !== ROLES.VR) return;
        this.state.vrStatus = {
          ...this.state.vrStatus,
          connected: true,
          inVR: Boolean(payload.inVR),
          fps: Number.isFinite(Number(payload.fps)) ? Math.round(Number(payload.fps)) : this.state.vrStatus.fps,
          battery: payload.battery !== undefined ? payload.battery : this.state.vrStatus.battery,
          trackingLost: Boolean(payload.trackingLost),
          headPose: payload.headPose && typeof payload.headPose === 'object' ? payload.headPose : this.state.vrStatus.headPose,
          interactionMode: payload.interactionMode || this.state.vrStatus.interactionMode,
          lastTelemetryAt: Date.now(),
        };
        this.broadcastState();
        break;
      }

      case MSG_TYPES.VIDEO_STREAM_TOGGLE: {
        if (!isPractitioner) return;
        this.state.videoStreamActive = Boolean(payload.active);
        this.broadcastState();
        break;
      }

      case MSG_TYPES.RTC_SIGNAL: {
        const target = payload.target;
        const forwarded = createMessage(MSG_TYPES.RTC_SIGNAL, {
          from: role,
          signal: payload.signal,
        });
        const json = JSON.stringify(forwarded);
        if (target === ROLES.VR && this.vrSocket?.readyState === 1) {
          this.vrSocket.send(json);
        } else if (target === ROLES.MOBILE && this.mobileSocket?.readyState === 1) {
          this.mobileSocket.send(json);
        } else if (target === ROLES.PC) {
          for (const pcSock of this.pcSockets) {
            if (pcSock.readyState === 1) pcSock.send(json);
          }
        }
        break;
      }

      case MSG_TYPES.VIDEO_FRAME: {
        if (role !== ROLES.VR || !this.state.videoStreamActive) return;
        const packet = JSON.stringify(
          createMessage(MSG_TYPES.VIDEO_FRAME, {
            dataUrl: payload.dataUrl,
            width: payload.width,
            height: payload.height,
          })
        );
        if (this.mobileSocket?.readyState === 1) this.mobileSocket.send(packet);
        for (const pcSock of this.pcSockets) {
          if (pcSock.readyState === 1) pcSock.send(packet);
        }
        break;
      }

      default:
        break;
    }
  }

  #handleAuth(socket, payload) {
    const { role, pin } = payload;
    if (!Object.values(ROLES).includes(role)) {
      this.#send(socket, MSG_TYPES.AUTH_ERROR, { message: 'Rôle client invalide.' });
      return;
    }
    if (String(pin || '').trim() !== this.pin) {
      this.#send(socket, MSG_TYPES.AUTH_ERROR, { message: 'Code PIN incorrect.' });
      return;
    }

    // Exclusivité VR et Mobile : un nouvel appareil remplace proprement l'ancien
    if (role === ROLES.VR) {
      if (this.vrSocket && this.vrSocket !== socket && this.vrSocket.readyState === 1) {
        this.#send(this.vrSocket, MSG_TYPES.ERROR, { message: 'Remplacé par un autre casque VR.' });
        this.vrSocket.close(4001, 'Replaced by new VR client');
      }
      this.vrSocket = socket;
    } else if (role === ROLES.MOBILE) {
      if (this.mobileSocket && this.mobileSocket !== socket && this.mobileSocket.readyState === 1) {
        this.#send(this.mobileSocket, MSG_TYPES.ERROR, { message: 'Remplacé par un autre contrôleur mobile.' });
        this.mobileSocket.close(4001, 'Replaced by new Mobile client');
      }
      this.mobileSocket = socket;
    } else if (role === ROLES.PC) {
      this.pcSockets.add(socket);
    }

    socket.vretAuthenticated = true;
    socket.vretRole = role;
    this.#syncClientCounts();

    this.#send(socket, MSG_TYPES.AUTH_OK, { role });
    this.broadcastState();
  }
}
