import { MSG_TYPES, ROLES, createMessage, parseMessage } from '/shared/protocol.js';
import {
  SCENES_SCHEMA,
  LIKERT_PRESETS,
  CLINICAL_MARKERS,
  getTherapyScenes,
} from '/shared/scenes-schema.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const pinInput = document.getElementById('pin-input');
const btnAuth = document.getElementById('btn-auth');
const authErr = document.getElementById('auth-err');

const wsDot = document.getElementById('ws-dot');
const wsStatusText = document.getElementById('ws-status-text');
const badgeVr = document.getElementById('badge-vr');
const badgeFps = document.getElementById('badge-fps');
const badgeBat = document.getElementById('badge-bat');
const alertBanner = document.getElementById('alert-banner');
const btnSafeSpace = document.getElementById('btn-safe-space');
const sceneSelector = document.getElementById('scene-selector');
const presetsGrid = document.getElementById('presets-grid');
const btnSavePresetMob = document.getElementById('btn-save-preset-mob');
const btnTogglePresetEdit = document.getElementById('btn-toggle-preset-edit');
const mobPresetForm = document.getElementById('mob-preset-form');
const mobPresetLabel = document.getElementById('mob-preset-label');
const mobPresetCancel = document.getElementById('mob-preset-cancel');
const mobPresetConfirm = document.getElementById('mob-preset-confirm');
const paramsContainer = document.getElementById('params-container');
const safespaceParamsContainer = document.getElementById('safespace-params');

const lastLikertScore = document.getElementById('last-likert-score');
const lastLikertMeta = document.getElementById('last-likert-meta');
const activeLikertBox = document.getElementById('active-likert-box');
const activeLikertQ = document.getElementById('active-likert-q');
const btnCancelLikert = document.getElementById('btn-cancel-likert');
const likertTriggers = document.getElementById('likert-triggers');
const likertTimerSelect = document.getElementById('likert-timer-select');
const markersGrid = document.getElementById('markers-grid');
const markerNoteInput = document.getElementById('marker-note-input');
const btnSendNote = document.getElementById('btn-send-note');

const btnToggleVideo = document.getElementById('btn-toggle-video');
const webrtcVideo = document.getElementById('webrtc-video');
const relayVideo = document.getElementById('relay-video');
const videoPlaceholder = document.getElementById('video-placeholder');
const telemetryDetails = document.getElementById('telemetry-details');

let ws = null;
let pin = '';
let authenticated = false;
let shouldReconnect = false;
let reconnectDelay = 1000;
let reconnectTimer = null;
let currentState = null;
let renderedSceneId = null;
let renderedMobPresetsKey = '';
let mobPresetEditMode = false;
let mobEditingPresetId = null;

// Wake Lock API pour garder l'écran allumé durant la séance
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Ignorer si non autorisé sans interaction
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && authenticated) {
    requestWakeLock();
  }
});

// Onglets
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// Construction statique des boutons Scènes, Likert & Marqueurs
for (const scene of getTherapyScenes()) {
  const btn = document.createElement('button');
  btn.className = 'scene-btn';
  btn.dataset.sceneId = scene.id;
  btn.innerHTML = `<span>${scene.icon}</span><span>${scene.shortLabel}</span>`;
  btn.addEventListener('click', () => {
    sendWs(MSG_TYPES.SCENE_LOAD, { sceneId: scene.id });
  });
  sceneSelector.appendChild(btn);
}

for (const preset of LIKERT_PRESETS) {
  const btn = document.createElement('button');
  btn.className = 'likert-btn';
  btn.textContent = preset.label;
  btn.addEventListener('click', () => {
    sendWs(MSG_TYPES.LIKERT_TRIGGER, {
      question: preset.question,
      scaleMin: preset.scaleMin,
      scaleMax: preset.scaleMax,
      step: preset.step || 1,
      labels: preset.labels,
    });
  });
  likertTriggers.appendChild(btn);
}

for (const mk of CLINICAL_MARKERS) {
  const btn = document.createElement('button');
  btn.className = 'marker-btn';
  btn.textContent = `${mk.icon} ${mk.label}`;
  btn.addEventListener('click', () => {
    sendWs(MSG_TYPES.CLINICAL_MARKER, {
      markerId: mk.id,
      label: mk.label,
      note: '',
    });
  });
  markersGrid.appendChild(btn);
}

btnSendNote.addEventListener('click', () => {
  const text = markerNoteInput.value.trim();
  if (!text) return;
  sendWs(MSG_TYPES.CLINICAL_MARKER, {
    markerId: 'custom_note',
    label: 'Note praticien',
    note: text,
  });
  markerNoteInput.value = '';
});

btnCancelLikert.addEventListener('click', () => {
  sendWs(MSG_TYPES.LIKERT_CANCEL, {});
});

// Timer Likert automatique
let likertInterval = null;
likertTimerSelect.addEventListener('change', () => {
  if (likertInterval) {
    clearInterval(likertInterval);
    likertInterval = null;
  }
  const sec = Number(likertTimerSelect.value);
  if (sec > 0) {
    const def = LIKERT_PRESETS[0];
    likertInterval = setInterval(() => {
      if (authenticated && !currentState?.activeLikert) {
        sendWs(MSG_TYPES.LIKERT_TRIGGER, {
          question: def.question,
          scaleMin: def.scaleMin,
          scaleMax: def.scaleMax,
          labels: def.labels,
        });
      }
    }, sec * 1000);
  }
});

// Bouton SAFE SPACE sans confirmation
btnSafeSpace.addEventListener('click', () => {
  const nextActive = !currentState?.safeSpace;
  sendWs(MSG_TYPES.SAFE_SPACE_TOGGLE, { active: nextActive });
});

// Toggle Vidéo à la demande
let pc = null;
btnToggleVideo.addEventListener('click', () => {
  const next = !currentState?.videoStreamActive;
  sendWs(MSG_TYPES.VIDEO_STREAM_TOGGLE, { active: next });
  if (next) {
    sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: { type: 'request-offer' } });
  } else {
    closeRtc();
  }
});

function closeRtc() {
  if (pc) {
    try { pc.close(); } catch {}
    pc = null;
  }
  webrtcVideo.srcObject = null;
  webrtcVideo.classList.add('hidden');
  relayVideo.classList.add('hidden');
  videoPlaceholder.classList.remove('hidden');
}

async function handleRtcSignal(payload) {
  const { signal } = payload || {};
  if (!signal) return;
  if (signal.type === 'offer') {
    if (pc) pc.close();
    pc = new RTCPeerConnection({ iceServers: [] });
    pc.ontrack = (ev) => {
      webrtcVideo.srcObject = ev.streams[0];
      webrtcVideo.classList.remove('hidden');
      relayVideo.classList.add('hidden');
      videoPlaceholder.classList.add('hidden');
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: { candidate: ev.candidate } });
      }
    };
    await pc.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: answer });
  } else if (signal.candidate && pc) {
    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

// Throttle 50 ms sur les sliders continus
const lastSentByKey = new Map();
const pendingTimerByKey = new Map();
function sendParamThrottled(key, value) {
  const now = performance.now();
  const last = lastSentByKey.get(key) || 0;
  if (now - last >= 50) {
    lastSentByKey.set(key, now);
    sendWs(MSG_TYPES.PARAM_UPDATE, { key, value });
  } else {
    clearTimeout(pendingTimerByKey.get(key));
    pendingTimerByKey.set(
      key,
      setTimeout(() => {
        lastSentByKey.set(key, performance.now());
        sendWs(MSG_TYPES.PARAM_UPDATE, { key, value });
      }, 50)
    );
  }
}

function getMobScenePresets(sceneId) {
  const fromState = currentState?.presetsByScene?.[sceneId];
  if (Array.isArray(fromState) && fromState.length > 0) return fromState;
  return SCENES_SCHEMA[sceneId]?.presets || [];
}

function renderMobPresets(sceneId, force = false) {
  const presets = getMobScenePresets(sceneId);
  const key = `${sceneId}:${mobPresetEditMode}:${JSON.stringify(presets.map((p) => [p.id, p.label, p.difficultyOrder]))}`;
  if (!force && key === renderedMobPresetsKey) return;
  renderedMobPresetsKey = key;

  presetsGrid.innerHTML = '';
  presets.forEach((preset, idx) => {
    const row = document.createElement('div');
    row.className = 'preset-item-row';

    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    const badge = document.createElement('span');
    badge.className = 'preset-rank-badge';
    badge.textContent = `#${idx + 1}`;
    const txt = document.createElement('span');
    txt.textContent = preset.label;
    btn.append(badge, txt);
    btn.addEventListener('click', () => {
      sendWs(MSG_TYPES.PRESET_APPLY, { presetId: preset.id });
    });
    row.appendChild(btn);

    if (mobPresetEditMode) {
      const ctrls = document.createElement('div');
      ctrls.className = 'preset-edit-controls';

      const upBtn = document.createElement('button');
      upBtn.className = 'btn-mini';
      upBtn.textContent = '↑';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => moveMobPreset(sceneId, idx, -1));

      const downBtn = document.createElement('button');
      downBtn.className = 'btn-mini';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === presets.length - 1;
      downBtn.addEventListener('click', () => moveMobPreset(sceneId, idx, 1));

      const editBtn = document.createElement('button');
      editBtn.className = 'btn-mini';
      editBtn.textContent = '✏️';
      editBtn.addEventListener('click', () => {
        mobEditingPresetId = preset.id;
        mobPresetLabel.value = preset.label;
        mobPresetForm.classList.remove('hidden');
        mobPresetLabel.focus();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-mini';
      delBtn.textContent = '🗑️';
      delBtn.addEventListener('click', async () => {
        await fetch(`/api/presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' });
      });

      ctrls.append(upBtn, downBtn, editBtn, delBtn);
      row.appendChild(ctrls);
    }

    presetsGrid.appendChild(row);
  });
}

async function moveMobPreset(sceneId, idx, delta) {
  const presets = [...getMobScenePresets(sceneId)];
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= presets.length) return;
  const [item] = presets.splice(idx, 1);
  presets.splice(targetIdx, 0, item);
  await fetch('/api/presets/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneId, orderedIds: presets.map((p) => p.id) }),
  });
}

btnTogglePresetEdit.addEventListener('click', () => {
  mobPresetEditMode = !mobPresetEditMode;
  btnTogglePresetEdit.classList.toggle('active', mobPresetEditMode);
  if (currentState?.sceneId) renderMobPresets(currentState.sceneId, true);
});

btnSavePresetMob.addEventListener('click', () => {
  if (!currentState?.sceneId) return;
  mobEditingPresetId = null;
  const count = getMobScenePresets(currentState.sceneId).length;
  mobPresetLabel.value = `Palier ${count + 1} — Perso`;
  mobPresetForm.classList.remove('hidden');
  mobPresetLabel.focus();
});

mobPresetCancel.addEventListener('click', () => {
  mobEditingPresetId = null;
  mobPresetForm.classList.add('hidden');
});

mobPresetConfirm.addEventListener('click', async () => {
  const sceneId = currentState?.sceneId;
  const label = mobPresetLabel.value.trim();
  if (!sceneId || !label) return;
  const params = currentState?.params || {};
  const url = mobEditingPresetId
    ? `/api/presets/${encodeURIComponent(mobEditingPresetId)}`
    : '/api/presets';
  const method = mobEditingPresetId ? 'PUT' : 'POST';
  const body = mobEditingPresetId ? { label, params } : { sceneId, label, params };
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    mobEditingPresetId = null;
    mobPresetForm.classList.add('hidden');
  }
});

function buildSafeSpaceMobileControls() {
  const safeSchema = SCENES_SCHEMA.safe_space;
  if (!safeSchema) return;
  safespaceParamsContainer.innerHTML = '';

  for (const param of Object.values(safeSchema.params || {})) {
    const wrapper = document.createElement('div');
    wrapper.className = 'param-item';

    const head = document.createElement('div');
    head.className = 'param-head';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = param.label;
    head.appendChild(labelSpan);
    wrapper.appendChild(head);

    if (param.type === 'enum') {
      const row = document.createElement('div');
      row.className = 'enum-row';
      row.style.flexWrap = 'wrap';
      row.id = `mob-safe-ctrl-${param.key}`;
      for (const opt of param.options) {
        const btn = document.createElement('button');
        btn.className = 'enum-btn';
        btn.style.minWidth = '45%';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          sendWs(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: param.key, value: opt.value });
        });
        row.appendChild(btn);
      }
      wrapper.appendChild(row);
    } else if (param.type === 'bool') {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.id = `mob-safe-ctrl-${param.key}`;
      btn.addEventListener('click', () => {
        const cur = currentState?.safeSpaceParams?.[param.key] !== false;
        sendWs(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: param.key, value: !cur });
      });
      wrapper.appendChild(btn);
    }
    safespaceParamsContainer.appendChild(wrapper);
  }
}
buildSafeSpaceMobileControls();

function buildSceneControls(sceneId) {
  renderedSceneId = sceneId;
  renderedMobPresetsKey = '';
  const schema = SCENES_SCHEMA[sceneId];
  presetsGrid.innerHTML = '';
  paramsContainer.innerHTML = '';
  if (!schema) return;

  renderMobPresets(sceneId, true);

  for (const param of Object.values(schema.params || {})) {
    const wrapper = document.createElement('div');
    wrapper.className = 'param-item';

    const head = document.createElement('div');
    head.className = 'param-head';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = param.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'param-val';
    valSpan.id = `pval-${param.key}`;
    head.append(labelSpan, valSpan);
    wrapper.appendChild(head);

    if (param.type === 'float' || param.type === 'int') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = param.min;
      input.max = param.max;
      input.step = param.step;
      input.id = `pctrl-${param.key}`;
      input.addEventListener('input', () => {
        const val = param.type === 'int' ? parseInt(input.value, 10) : parseFloat(input.value);
        updateParamLabel(param, val);
        sendParamThrottled(param.key, val);
      });
      wrapper.appendChild(input);
    } else if (param.type === 'bool') {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn';
      btn.id = `pctrl-${param.key}`;
      btn.addEventListener('click', () => {
        const cur = Boolean(currentState?.params?.[param.key]);
        sendWs(MSG_TYPES.PARAM_UPDATE, { key: param.key, value: !cur });
      });
      wrapper.appendChild(btn);
    } else if (param.type === 'enum') {
      const row = document.createElement('div');
      row.className = 'enum-row';
      row.id = `pctrl-${param.key}`;
      for (const opt of param.options) {
        const btn = document.createElement('button');
        btn.className = 'enum-btn';
        btn.dataset.value = opt.value;
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          sendWs(MSG_TYPES.PARAM_UPDATE, { key: param.key, value: opt.value });
        });
        row.appendChild(btn);
      }
      wrapper.appendChild(row);
    }

    paramsContainer.appendChild(wrapper);
  }
}

function updateParamLabel(param, value) {
  const valSpan = document.getElementById(`pval-${param.key}`);
  if (!valSpan) return;
  if (param.type === 'bool') {
    valSpan.textContent = value ? 'ACTIF' : 'Inactif';
  } else if (param.type === 'enum') {
    const found = param.options.find((o) => o.value === value);
    valSpan.textContent = found ? found.label : value;
  } else if (param.displayScale) {
    valSpan.textContent = `${Math.round(Number(value) * param.displayScale)}${param.unit || ''}`;
  } else {
    valSpan.textContent = `${value}${param.unit ? ' ' + param.unit : ''}`;
  }
}

function applyState(state) {
  currentState = state;

  // Bouton Safe Space
  btnSafeSpace.classList.toggle('active', Boolean(state.safeSpace));
  btnSafeSpace.textContent = state.safeSpace
    ? '✅ SAFE SPACE ACTIF — REPRENDRE LA SCÈNE'
    : '🚨 ACTIVER SAFE SPACE (URGENCE)';

  // Télémétrie VR
  const vr = state.vrStatus || {};
  badgeVr.textContent = vr.connected ? (vr.inVR ? 'VR: En séance' : 'VR: Lobby') : 'VR: Hors ligne';
  badgeVr.classList.toggle('ok', Boolean(vr.connected));
  badgeFps.textContent = `${vr.fps || 0} FPS`;
  if (typeof vr.battery === 'number') {
    badgeBat.textContent = `${Math.round(vr.battery * 100)}%`;
    badgeBat.classList.remove('hidden');
  } else {
    badgeBat.classList.add('hidden');
  }

  // Alertes critiques (déconnexion VR ou casque retiré)
  const alerts = [];
  if (!vr.connected) alerts.push('Casque VR déconnecté.');
  else if (vr.trackingLost) alerts.push('Casque retiré ou en veille (audio en pause).');
  if (state.sceneLoading) alerts.push('Chargement de la scène sur le casque...');
  alertBanner.textContent = alerts.join(' ');
  alertBanner.classList.toggle('hidden', alerts.length === 0);

  // Sélecteur de scène (verrouillé si sceneLoading)
  sceneSelector.querySelectorAll('.scene-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sceneId === state.sceneId);
    btn.disabled = Boolean(state.sceneLoading);
  });

  // Contrôles dynamiques
  if (renderedSceneId !== state.sceneId) {
    buildSceneControls(state.sceneId);
  } else {
    renderMobPresets(state.sceneId);
  }

  // Sync Safe Space Config Mobile
  const safeSchema = SCENES_SCHEMA.safe_space;
  if (safeSchema && state.safeSpaceParams) {
    for (const p of Object.values(safeSchema.params || {})) {
      const val = state.safeSpaceParams[p.key];
      const ctrl = document.getElementById(`mob-safe-ctrl-${p.key}`);
      if (!ctrl) continue;
      if (p.type === 'bool') {
        ctrl.classList.toggle('active', Boolean(val));
        ctrl.textContent = val ? 'Désactiver' : 'Activer';
      } else if (p.type === 'enum') {
        ctrl.querySelectorAll('.enum-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === val);
        });
      }
    }
  }
  const schema = SCENES_SCHEMA[state.sceneId];
  if (schema && state.params) {
    for (const param of Object.values(schema.params)) {
      const val = state.params[param.key];
      updateParamLabel(param, val);
      const ctrl = document.getElementById(`pctrl-${param.key}`);
      if (!ctrl) continue;
      if (param.type === 'float' || param.type === 'int') {
        ctrl.value = val;
      } else if (param.type === 'bool') {
        ctrl.classList.toggle('active', Boolean(val));
        ctrl.textContent = val ? 'Désactiver' : 'Activer';
      } else if (param.type === 'enum') {
        ctrl.querySelectorAll('.enum-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === val);
        });
      }
    }
  }

  // Likert
  if (state.activeLikert) {
    activeLikertBox.classList.remove('hidden');
    activeLikertQ.textContent = state.activeLikert.question;
  } else {
    activeLikertBox.classList.add('hidden');
  }

  const lastLk = state.likertHistory?.[state.likertHistory.length - 1];
  if (lastLk) {
    lastLikertScore.textContent = `${lastLk.score} / ${lastLk.scaleMax}`;
    const sec = lastLk.responseTimeMs ? `${(lastLk.responseTimeMs / 1000).toFixed(1)} s` : '--';
    lastLikertMeta.textContent = `${lastLk.question} • Temps de réponse : ${sec}`;
  }

  // Vidéo
  btnToggleVideo.textContent = state.videoStreamActive ? 'Couper le flux' : 'Activer le flux';
  if (!state.videoStreamActive) {
    closeRtc();
  }
  telemetryDetails.textContent = `Hauteur tête : ${vr.headPose?.y ?? '--'} m • Interaction : ${
    vr.interactionMode === 'gaze' ? 'Regard (Gaze)' : 'Manettes'
  }`;
}

function connectWs(inputPin) {
  pin = String(inputPin || '').trim();
  if (!pin) return;
  shouldReconnect = true;
  reconnectDelay = 1000;
  openSocket();
}

function openSocket() {
  clearTimeout(reconnectTimer);
  if (ws) try { ws.close(); } catch {}

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wsDot.className = 'dot';
  wsStatusText.textContent = 'Connexion...';

  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(createMessage(MSG_TYPES.AUTH, { role: ROLES.MOBILE, pin })));
  });

  ws.addEventListener('message', (ev) => {
    const msg = parseMessage(ev.data);
    if (!msg) return;

    switch (msg.type) {
      case MSG_TYPES.AUTH_OK:
        authenticated = true;
        reconnectDelay = 1000;
        authScreen.classList.add('hidden');
        appShell.classList.remove('hidden');
        wsDot.className = 'dot ok';
        wsStatusText.textContent = 'Connecté';
        requestWakeLock();
        break;
      case MSG_TYPES.AUTH_ERROR:
        shouldReconnect = false;
        authErr.textContent = msg.payload.message || 'PIN invalide';
        break;
      case MSG_TYPES.STATE_SYNC:
        applyState(msg.payload);
        break;
      case MSG_TYPES.RTC_SIGNAL:
        handleRtcSignal(msg.payload);
        break;
      case MSG_TYPES.VIDEO_FRAME:
        if (!webrtcVideo.srcObject && msg.payload?.dataUrl) {
          relayVideo.src = msg.payload.dataUrl;
          relayVideo.classList.remove('hidden');
          videoPlaceholder.classList.add('hidden');
        }
        break;
      default:
        break;
    }
  });

  ws.addEventListener('close', () => {
    authenticated = false;
    wsDot.className = 'dot err';
    if (shouldReconnect) {
      wsStatusText.textContent = `Reconnexion (${reconnectDelay / 1000}s)...`;
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(8000, reconnectDelay * 2);
        openSocket();
      }, reconnectDelay);
    } else {
      wsStatusText.textContent = 'Déconnecté';
    }
  });
}

function sendWs(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN && authenticated) {
    ws.send(JSON.stringify(createMessage(type, payload)));
  }
}

btnAuth.addEventListener('click', () => {
  authErr.textContent = '';
  connectWs(pinInput.value);
});

const urlPin = new URLSearchParams(location.search).get('pin');
if (urlPin) {
  pinInput.value = urlPin;
  connectWs(urlPin);
}
