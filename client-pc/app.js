import { MSG_TYPES, ROLES, createMessage, parseMessage } from '/shared/protocol.js';
import {
  SCENES_SCHEMA,
  LIKERT_PRESETS,
  CLINICAL_MARKERS,
  getTherapyScenes,
} from '/shared/scenes-schema.js';
import { ClinicalChart } from './chart.js';

// Éléments DOM principaux
const networkSummary = document.getElementById('network-summary');
const headerPin = document.getElementById('header-pin');
const btnRegenPin = document.getElementById('btn-regen-pin');

const patientSelect = document.getElementById('patient-select');
const newPatientId = document.getElementById('new-patient-id');
const newPatientNotes = document.getElementById('new-patient-notes');
const btnCreatePatient = document.getElementById('btn-create-patient');

const initialSceneSelect = document.getElementById('initial-scene-select');
const sessionStatusBadge = document.getElementById('session-status-badge');
const btnStartSession = document.getElementById('btn-start-session');
const btnEndSession = document.getElementById('btn-end-session');
const activeSessionNotesWrap = document.getElementById('active-session-notes-wrap');
const sessionSummaryNotes = document.getElementById('session-summary-notes');

const devVrStatus = document.getElementById('dev-vr-status');
const devMobileStatus = document.getElementById('dev-mobile-status');
const devPcCount = document.getElementById('dev-pc-count');

const pcSafeBtn = document.getElementById('pc-safe-btn');
const pcScenePills = document.getElementById('pc-scene-pills');
const pcPresetsBar = document.getElementById('pc-presets-bar');
const pcBtnNewPreset = document.getElementById('pc-btn-new-preset');
const pcPresetEditor = document.getElementById('pc-preset-editor');
const pcPresetLabelInput = document.getElementById('pc-preset-label-input');
const pcPresetEditorParams = document.getElementById('pc-preset-editor-params');
const pcBtnCaptureCurrent = document.getElementById('pc-btn-capture-current');
const pcBtnCancelPreset = document.getElementById('pc-btn-cancel-preset');
const pcBtnSavePreset = document.getElementById('pc-btn-save-preset');
const pcParamsList = document.getElementById('pc-params-list');
const pcSafespaceParams = document.getElementById('pc-safespace-params');
const pcLikertLast = document.getElementById('pc-likert-last');
const pcLikertBtns = document.getElementById('pc-likert-btns');
const pcBtnVideo = document.getElementById('pc-btn-video');
const pcWebrtcVideo = document.getElementById('pc-webrtc-video');
const pcRelayVideo = document.getElementById('pc-relay-video');
const pcVideoPlaceholder = document.getElementById('pc-video-placeholder');
const pcMarkersRow = document.getElementById('pc-markers-row');

const qrMobile = document.getElementById('qr-mobile');
const qrVr = document.getElementById('qr-vr');
const qrSetup = document.getElementById('qr-setup');
const linkMobile = document.getElementById('link-mobile');
const linkVr = document.getElementById('link-vr');
const linkSetup = document.getElementById('link-setup');
const urlMdns = document.getElementById('url-mdns');
const ipsList = document.getElementById('ips-list');

// Analytique DOM
const analyticsPatientFilter = document.getElementById('analytics-patient-filter');
const sessionsList = document.getElementById('sessions-list');
const reportTitle = document.getElementById('report-title');
const reportSubtitle = document.getElementById('report-subtitle');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnPrintPdf = document.getElementById('btn-print-pdf');
const kpiDuration = document.getElementById('kpi-duration');
const kpiSuds = document.getElementById('kpi-suds');
const kpiPeak = document.getElementById('kpi-peak');
const kpiSafespace = document.getElementById('kpi-safespace');
const reportNotesEditor = document.getElementById('report-notes-editor');
const reportNotesPrint = document.getElementById('report-notes-print');
const btnSaveReportNotes = document.getElementById('btn-save-report-notes');
const timelineTbody = document.getElementById('timeline-tbody');

const chart = new ClinicalChart(
  document.getElementById('clinical-chart'),
  document.getElementById('chart-tooltip')
);

let ws = null;
let currentPin = '';
let currentState = null;
let renderedPcScene = null;
let renderedPresetsKey = '';
let editingPresetId = null;
let selectedAnalyticsSessionId = null;

// Navigation onglets Supervision / Analyse
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view-container').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'analytics') {
      await refreshSessionsList();
    }
  });
});

// Remplir les listes de scènes & boutons Likert / Marqueurs PC
for (const sc of getTherapyScenes()) {
  const opt = document.createElement('option');
  opt.value = sc.id;
  opt.textContent = sc.label;
  initialSceneSelect.appendChild(opt);

  const pill = document.createElement('button');
  pill.className = 'scene-pill-btn';
  pill.dataset.sceneId = sc.id;
  pill.textContent = `${sc.icon} ${sc.shortLabel}`;
  pill.addEventListener('click', () => sendWs(MSG_TYPES.SCENE_LOAD, { sceneId: sc.id }));
  pcScenePills.appendChild(pill);
}

for (const lk of LIKERT_PRESETS) {
  const btn = document.createElement('button');
  btn.className = 'btn-xs';
  btn.textContent = lk.label;
  btn.addEventListener('click', () => {
    sendWs(MSG_TYPES.LIKERT_TRIGGER, {
      question: lk.question,
      scaleMin: lk.scaleMin,
      scaleMax: lk.scaleMax,
      step: lk.step || 1,
      labels: lk.labels,
    });
  });
  pcLikertBtns.appendChild(btn);
}

for (const mk of CLINICAL_MARKERS) {
  const btn = document.createElement('button');
  btn.className = 'preset-chip';
  btn.textContent = `${mk.icon} ${mk.label}`;
  btn.addEventListener('click', () => {
    sendWs(MSG_TYPES.CLINICAL_MARKER, {
      markerId: mk.id,
      label: mk.label,
      note: '',
    });
  });
  pcMarkersRow.appendChild(btn);
}

pcSafeBtn.addEventListener('click', () => {
  sendWs(MSG_TYPES.SAFE_SPACE_TOGGLE, { active: !currentState?.safeSpace });
});

// Vidéo PC (WebRTC + Fallback Relay)
let pcRtc = null;
pcBtnVideo.addEventListener('click', () => {
  const next = !currentState?.videoStreamActive;
  sendWs(MSG_TYPES.VIDEO_STREAM_TOGGLE, { active: next });
  if (next) {
    sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: { type: 'request-offer' } });
  } else {
    closePcRtc();
  }
});

function closePcRtc() {
  if (pcRtc) {
    try { pcRtc.close(); } catch {}
    pcRtc = null;
  }
  pcWebrtcVideo.srcObject = null;
  pcWebrtcVideo.classList.add('hidden');
  pcRelayVideo.classList.add('hidden');
  pcVideoPlaceholder.classList.remove('hidden');
}

async function handlePcRtcSignal(payload) {
  const { signal } = payload || {};
  if (!signal) return;
  if (signal.type === 'offer') {
    if (pcRtc) pcRtc.close();
    pcRtc = new RTCPeerConnection({ iceServers: [] });
    pcRtc.ontrack = (ev) => {
      pcWebrtcVideo.srcObject = ev.streams[0];
      pcWebrtcVideo.classList.remove('hidden');
      pcRelayVideo.classList.add('hidden');
      pcVideoPlaceholder.classList.add('hidden');
    };
    pcRtc.onicecandidate = (ev) => {
      if (ev.candidate) {
        sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: { candidate: ev.candidate } });
      }
    };
    await pcRtc.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await pcRtc.createAnswer();
    await pcRtc.setLocalDescription(answer);
    sendWs(MSG_TYPES.RTC_SIGNAL, { target: ROLES.VR, signal: answer });
  } else if (signal.candidate && pcRtc) {
    await pcRtc.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

function getActiveScenePresets(sceneId) {
  const fromState = currentState?.presetsByScene?.[sceneId];
  if (Array.isArray(fromState) && fromState.length > 0) return fromState;
  return SCENES_SCHEMA[sceneId]?.presets || [];
}

function buildPcPresetsList(sceneId) {
  const presets = getActiveScenePresets(sceneId);
  const key = `${sceneId}:${JSON.stringify(presets.map((p) => [p.id, p.label, p.difficultyOrder]))}`;
  if (key === renderedPresetsKey) return;
  renderedPresetsKey = key;

  pcPresetsBar.innerHTML = '';
  presets.forEach((preset, idx) => {
    const row = document.createElement('div');
    row.className = 'preset-row';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'preset-apply-btn';
    applyBtn.title = 'Appliquer ce palier';
    applyBtn.innerHTML = `<span class="preset-rank">#${idx + 1}</span><span>${escapeHtml(preset.label)}</span>`;
    applyBtn.addEventListener('click', () => sendWs(MSG_TYPES.PRESET_APPLY, { presetId: preset.id }));

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const upBtn = document.createElement('button');
    upBtn.className = 'preset-act-btn';
    upBtn.textContent = '↑';
    upBtn.title = 'Plus facile (monter)';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => movePcPreset(sceneId, idx, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'preset-act-btn';
    downBtn.textContent = '↓';
    downBtn.title = 'Plus difficile (descendre)';
    downBtn.disabled = idx === presets.length - 1;
    downBtn.addEventListener('click', () => movePcPreset(sceneId, idx, 1));

    const editBtn = document.createElement('button');
    editBtn.className = 'preset-act-btn';
    editBtn.textContent = '✏️';
    editBtn.title = 'Éditer ce palier';
    editBtn.addEventListener('click', () => openPcPresetEditor(sceneId, preset));

    const delBtn = document.createElement('button');
    delBtn.className = 'preset-act-btn';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Supprimer ce palier';
    delBtn.addEventListener('click', () => deletePcPreset(preset));

    actions.append(upBtn, downBtn, editBtn, delBtn);
    row.append(applyBtn, actions);
    pcPresetsBar.appendChild(row);
  });
}

async function movePcPreset(sceneId, idx, delta) {
  const presets = [...getActiveScenePresets(sceneId)];
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= presets.length) return;
  const [item] = presets.splice(idx, 1);
  presets.splice(targetIdx, 0, item);
  const orderedIds = presets.map((p) => p.id);

  await fetch('/api/presets/reorder', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sceneId, orderedIds }),
  });
}

async function deletePcPreset(preset) {
  if (!confirm(`Supprimer le palier « ${preset.label} » ?`)) return;
  await fetch(`/api/presets/${encodeURIComponent(preset.id)}`, { method: 'DELETE' });
}

function openPcPresetEditor(sceneId, preset = null) {
  const schema = SCENES_SCHEMA[sceneId];
  if (!schema) return;
  editingPresetId = preset ? preset.id : null;
  pcPresetLabelInput.value = preset
    ? preset.label
    : `Palier ${getActiveScenePresets(sceneId).length + 1} — Personnalisé`;

  const sourceParams = preset ? preset.params : (currentState?.params || {});
  populatePresetEditorParams(schema, sourceParams);
  pcPresetEditor.classList.remove('hidden');
  pcPresetLabelInput.focus();
}

function populatePresetEditorParams(schema, sourceParams) {
  pcPresetEditorParams.innerHTML = '';
  for (const param of Object.values(schema.params || {})) {
    const field = document.createElement('div');
    field.className = 'preset-editor-field';
    const lbl = document.createElement('label');
    lbl.textContent = param.label;
    field.appendChild(lbl);

    const val = sourceParams?.[param.key] ?? param.default;
    if (param.type === 'enum') {
      const sel = document.createElement('select');
      sel.dataset.paramKey = param.key;
      for (const opt of param.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === val) o.selected = true;
        sel.appendChild(o);
      }
      field.appendChild(sel);
    } else if (param.type === 'bool') {
      const sel = document.createElement('select');
      sel.dataset.paramKey = param.key;
      sel.innerHTML = `<option value="true">Actif</option><option value="false">Inactif</option>`;
      sel.value = String(Boolean(val));
      field.appendChild(sel);
    } else {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = param.min;
      inp.max = param.max;
      inp.step = param.step;
      inp.value = val;
      inp.dataset.paramKey = param.key;
      field.appendChild(inp);
    }
    pcPresetEditorParams.appendChild(field);
  }
}

pcBtnNewPreset.addEventListener('click', () => {
  if (!currentState?.sceneId) return;
  openPcPresetEditor(currentState.sceneId, null);
});

pcBtnCaptureCurrent.addEventListener('click', () => {
  const schema = SCENES_SCHEMA[currentState?.sceneId];
  if (schema && currentState?.params) {
    populatePresetEditorParams(schema, currentState.params);
  }
});

pcBtnCancelPreset.addEventListener('click', () => {
  editingPresetId = null;
  pcPresetEditor.classList.add('hidden');
});

pcBtnSavePreset.addEventListener('click', async () => {
  const sceneId = currentState?.sceneId;
  const schema = SCENES_SCHEMA[sceneId];
  if (!schema) return;
  const label = pcPresetLabelInput.value.trim();
  if (!label) {
    pcPresetLabelInput.focus();
    return;
  }

  const params = {};
  for (const param of Object.values(schema.params || {})) {
    const el = pcPresetEditorParams.querySelector(`[data-param-key="${param.key}"]`);
    if (!el) continue;
    if (param.type === 'bool') params[param.key] = el.value === 'true';
    else if (param.type === 'int') params[param.key] = parseInt(el.value, 10);
    else if (param.type === 'float') params[param.key] = parseFloat(el.value);
    else params[param.key] = el.value;
  }

  const url = editingPresetId
    ? `/api/presets/${encodeURIComponent(editingPresetId)}`
    : '/api/presets';
  const method = editingPresetId ? 'PUT' : 'POST';
  const body = editingPresetId ? { label, params } : { sceneId, label, params };

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || 'Erreur enregistrement palier');
    return;
  }
  editingPresetId = null;
  pcPresetEditor.classList.add('hidden');
});

function buildPcSafeSpaceControls() {
  const safeSchema = SCENES_SCHEMA.safe_space;
  if (!safeSchema) return;
  pcSafespaceParams.innerHTML = '';

  for (const param of Object.values(safeSchema.params || {})) {
    const row = document.createElement('div');
    row.className = 'pc-safespace-row';
    const lbl = document.createElement('label');
    lbl.textContent = param.label;
    row.appendChild(lbl);

    if (param.type === 'enum') {
      const opts = document.createElement('div');
      opts.className = 'mini-opts';
      opts.id = `pc-safe-ctrl-${param.key}`;
      for (const o of param.options) {
        const btn = document.createElement('button');
        btn.className = 'mini-opt-btn';
        btn.dataset.value = o.value;
        btn.textContent = o.label;
        btn.addEventListener('click', () => {
          sendWs(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: param.key, value: o.value });
        });
        opts.appendChild(btn);
      }
      row.appendChild(opts);
    } else if (param.type === 'bool') {
      const btn = document.createElement('button');
      btn.className = 'mini-opt-btn';
      btn.id = `pc-safe-ctrl-${param.key}`;
      btn.addEventListener('click', () => {
        const cur = currentState?.safeSpaceParams?.[param.key] !== false;
        sendWs(MSG_TYPES.SAFE_SPACE_PARAM_UPDATE, { key: param.key, value: !cur });
      });
      row.appendChild(btn);
    }
    pcSafespaceParams.appendChild(row);
  }
}
buildPcSafeSpaceControls();

function buildPcSceneControls(sceneId) {
  renderedPcScene = sceneId;
  renderedPresetsKey = '';
  editingPresetId = null;
  pcPresetEditor.classList.add('hidden');

  const schema = SCENES_SCHEMA[sceneId];
  pcPresetsBar.innerHTML = '';
  pcParamsList.innerHTML = '';
  if (!schema) return;

  buildPcPresetsList(sceneId);

  for (const param of Object.values(schema.params || {})) {
    const row = document.createElement('div');
    row.className = 'pc-param-row';

    const top = document.createElement('div');
    top.className = 'pc-param-top';
    const lbl = document.createElement('span');
    lbl.textContent = param.label;
    const valEl = document.createElement('span');
    valEl.className = 'pc-param-val';
    valEl.id = `pc-val-${param.key}`;
    top.append(lbl, valEl);
    row.appendChild(top);

    if (param.type === 'float' || param.type === 'int') {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = param.min;
      slider.max = param.max;
      slider.step = param.step;
      slider.id = `pc-ctrl-${param.key}`;
      slider.addEventListener('input', () => {
        const val = param.type === 'int' ? parseInt(slider.value, 10) : parseFloat(slider.value);
        sendWs(MSG_TYPES.PARAM_UPDATE, { key: param.key, value: val });
      });
      row.appendChild(slider);
    } else if (param.type === 'bool') {
      const btn = document.createElement('button');
      btn.className = 'mini-opt-btn';
      btn.id = `pc-ctrl-${param.key}`;
      btn.addEventListener('click', () => {
        const cur = Boolean(currentState?.params?.[param.key]);
        sendWs(MSG_TYPES.PARAM_UPDATE, { key: param.key, value: !cur });
      });
      row.appendChild(btn);
    } else if (param.type === 'enum') {
      const opts = document.createElement('div');
      opts.className = 'mini-opts';
      opts.id = `pc-ctrl-${param.key}`;
      for (const o of param.options) {
        const btn = document.createElement('button');
        btn.className = 'mini-opt-btn';
        btn.dataset.value = o.value;
        btn.textContent = o.label;
        btn.addEventListener('click', () => {
          sendWs(MSG_TYPES.PARAM_UPDATE, { key: param.key, value: o.value });
        });
        opts.appendChild(btn);
      }
      row.appendChild(opts);
    }

    pcParamsList.appendChild(row);
  }
}

function applyPcState(state) {
  currentState = state;

  // Périphériques
  const vr = state.vrStatus || {};
  devVrStatus.textContent = vr.connected
    ? `${vr.inVR ? 'En VR' : 'Lobby'} • ${vr.fps || 0} FPS`
    : 'Hors ligne';
  devVrStatus.className = `tag ${vr.connected ? 'ok' : 'off'}`;

  devMobileStatus.textContent = state.connectedClients?.mobile ? 'Connecté' : 'Hors ligne';
  devMobileStatus.className = `tag ${state.connectedClients?.mobile ? 'ok' : 'off'}`;
  devPcCount.textContent = String(state.connectedClients?.pcCount || 0);

  // Séance SQLite active
  if (state.sessionId) {
    sessionStatusBadge.textContent = `Séance #${state.sessionId} (${state.patientId})`;
    sessionStatusBadge.className = 'tag live';
    btnStartSession.classList.add('hidden');
    btnEndSession.classList.remove('hidden');
    activeSessionNotesWrap.classList.remove('hidden');
  } else {
    sessionStatusBadge.textContent = 'Aucune séance active';
    sessionStatusBadge.className = 'tag';
    btnStartSession.classList.remove('hidden');
    btnEndSession.classList.add('hidden');
    activeSessionNotesWrap.classList.add('hidden');
  }

  // Safe Space
  pcSafeBtn.classList.toggle('active', Boolean(state.safeSpace));
  pcSafeBtn.textContent = state.safeSpace ? '✅ SAFE SPACE ACTIF' : '🚨 SAFE SPACE';

  // Scènes
  pcScenePills.querySelectorAll('.scene-pill-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sceneId === state.sceneId);
  });

  if (renderedPcScene !== state.sceneId) {
    buildPcSceneControls(state.sceneId);
  } else {
    buildPcPresetsList(state.sceneId);
  }

  // Sync Safe Space Config
  const safeSchema = SCENES_SCHEMA.safe_space;
  if (safeSchema && state.safeSpaceParams) {
    for (const p of Object.values(safeSchema.params || {})) {
      const val = state.safeSpaceParams[p.key];
      const ctrl = document.getElementById(`pc-safe-ctrl-${p.key}`);
      if (!ctrl) continue;
      if (p.type === 'bool') {
        ctrl.classList.toggle('active', Boolean(val));
        ctrl.textContent = val ? 'Actif' : 'Inactif';
      } else if (p.type === 'enum') {
        ctrl.querySelectorAll('.mini-opt-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === val);
        });
      }
    }
  }

  const schema = SCENES_SCHEMA[state.sceneId];
  if (schema && state.params) {
    for (const p of Object.values(schema.params)) {
      const val = state.params[p.key];
      const valEl = document.getElementById(`pc-val-${p.key}`);
      if (valEl) {
        valEl.textContent = p.displayScale
          ? `${Math.round(Number(val) * p.displayScale)}${p.unit || ''}`
          : `${val}${p.unit ? ' ' + p.unit : ''}`;
      }
      const ctrl = document.getElementById(`pc-ctrl-${p.key}`);
      if (!ctrl) continue;
      if (p.type === 'float' || p.type === 'int') ctrl.value = val;
      else if (p.type === 'bool') {
        ctrl.classList.toggle('active', Boolean(val));
        ctrl.textContent = val ? 'Actif' : 'Inactif';
      } else if (p.type === 'enum') {
        ctrl.querySelectorAll('.mini-opt-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.value === val);
        });
      }
    }
  }

  const lastLk = state.likertHistory?.[state.likertHistory.length - 1];
  pcLikertLast.textContent = lastLk
    ? `Dernière : ${lastLk.score}/${lastLk.scaleMax}`
    : 'Dernière : —';

  pcBtnVideo.textContent = state.videoStreamActive ? 'Couper flux' : 'Activer flux';
  if (!state.videoStreamActive) closePcRtc();
}

// API REST & Chargement initial
async function fetchStatusAndQr() {
  const res = await fetch('/api/status');
  const data = await res.json();
  if (!data.ok) return;

  currentPin = data.pin;
  headerPin.textContent = data.pin;
  networkSummary.textContent = `HTTPS :${data.port} • IP principale ${data.primaryIp}`;

  qrMobile.src = data.qrCodes.mobile;
  qrVr.src = data.qrCodes.vr;
  qrSetup.src = data.qrCodes.setup;

  linkMobile.href = data.urls.mobile;
  linkVr.href = data.urls.vr;
  linkSetup.href = data.urls.setup;

  urlMdns.textContent = data.urls.mdns;
  ipsList.textContent = data.ips.map((i) => `${i.address} (${i.interface})`).join(', ') || '127.0.0.1';

  applyPcState(data.state);
  connectPcWs();
}

function connectPcWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(createMessage(MSG_TYPES.AUTH, { role: ROLES.PC, pin: currentPin })));
  });

  ws.addEventListener('message', (ev) => {
    const msg = parseMessage(ev.data);
    if (!msg) return;
    if (msg.type === MSG_TYPES.STATE_SYNC) {
      applyPcState(msg.payload);
    } else if (msg.type === MSG_TYPES.RTC_SIGNAL) {
      handlePcRtcSignal(msg.payload);
    } else if (msg.type === MSG_TYPES.VIDEO_FRAME) {
      if (!pcWebrtcVideo.srcObject && msg.payload?.dataUrl) {
        pcRelayVideo.src = msg.payload.dataUrl;
        pcRelayVideo.classList.remove('hidden');
        pcVideoPlaceholder.classList.add('hidden');
      }
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connectPcWs, 2000);
  });
}

function sendWs(type, payload = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(createMessage(type, payload)));
  }
}

async function loadPatients() {
  const res = await fetch('/api/patients');
  const data = await res.json();
  if (!data.ok) return;

  patientSelect.innerHTML = '';
  analyticsPatientFilter.innerHTML = '<option value="">Tous les patients</option>';

  for (const p of data.patients) {
    const opt1 = document.createElement('option');
    opt1.value = p.id;
    opt1.textContent = `${p.id} (${p.session_count} séance${p.session_count > 1 ? 's' : ''})`;
    patientSelect.appendChild(opt1);

    const opt2 = opt1.cloneNode(true);
    analyticsPatientFilter.appendChild(opt2);
  }
}

btnCreatePatient.addEventListener('click', async () => {
  const id = newPatientId.value.trim();
  if (!id) return;
  const res = await fetch('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, notes: newPatientNotes.value.trim() }),
  });
  const data = await res.json();
  if (!data.ok) {
    alert(data.error || 'Erreur création patient');
    return;
  }
  newPatientId.value = '';
  newPatientNotes.value = '';
  await loadPatients();
  patientSelect.value = data.patient.id;
});

btnStartSession.addEventListener('click', async () => {
  const patientId = patientSelect.value;
  if (!patientId) return;
  const res = await fetch('/api/sessions/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId, initialScene: initialSceneSelect.value }),
  });
  const data = await res.json();
  if (data.ok) {
    sessionSummaryNotes.value = '';
    applyPcState(data.state);
  }
});

btnEndSession.addEventListener('click', async () => {
  if (!currentState?.sessionId) return;
  const res = await fetch(`/api/sessions/${currentState.sessionId}/end`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaryNotes: sessionSummaryNotes.value }),
  });
  const data = await res.json();
  if (data.ok) {
    applyPcState(data.state);
    await loadPatients();
  }
});

btnRegenPin.addEventListener('click', async () => {
  const res = await fetch('/api/pin/regenerate', { method: 'POST' });
  const data = await res.json();
  if (data.ok) {
    await fetchStatusAndQr();
  }
});

// VUE ANALYTIQUE
async function refreshSessionsList() {
  const pid = analyticsPatientFilter.value;
  const url = pid ? `/api/sessions?patientId=${encodeURIComponent(pid)}` : '/api/sessions';
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) return;

  sessionsList.innerHTML = '';
  for (const s of data.sessions) {
    const item = document.createElement('div');
    item.className = `session-item ${s.id === selectedAnalyticsSessionId ? 'active' : ''}`;
    const dt = new Date(s.started_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const scLabel = SCENES_SCHEMA[s.initial_scene]?.shortLabel || s.initial_scene;
    item.innerHTML = `
      <div class="session-item-title">#${s.id} • ${s.patient_id}</div>
      <div class="session-item-meta">${dt} • ${scLabel} • ${s.likert_count} Likert</div>
    `;
    item.addEventListener('click', () => loadSessionReport(s.id));
    sessionsList.appendChild(item);
  }

  if (!selectedAnalyticsSessionId && data.sessions.length > 0) {
    await loadSessionReport(data.sessions[0].id);
  }
}

async function loadSessionReport(sessionId) {
  selectedAnalyticsSessionId = sessionId;
  sessionsList.querySelectorAll('.session-item').forEach((el) => {
    el.classList.toggle('active', el.textContent.startsWith(`#${sessionId} `));
  });

  const res = await fetch(`/api/sessions/${sessionId}/details`);
  const details = await res.json();
  if (!details.ok) return;

  const { session, events, likert } = details;
  reportTitle.textContent = `Rapport VRET — Séance #${session.id} (${session.patient_id})`;
  reportSubtitle.textContent = `Démarrée le ${new Date(session.started_at).toLocaleString('fr-FR')}`;
  btnExportCsv.href = `/api/sessions/${session.id}/export.csv`;

  const endTs = session.ended_at || events[events.length - 1]?.timestamp || session.started_at;
  const durMin = Math.max(1, Math.round((endTs - session.started_at) / 60000));
  kpiDuration.textContent = `${durMin} min`;

  if (likert.length > 0) {
    const first = likert[0];
    const last = likert[likert.length - 1];
    const peak = Math.max(...likert.map((l) => l.score));
    kpiSuds.textContent = `${first.score} → ${last.score} / ${last.scale_max}`;
    kpiPeak.textContent = `${peak} / ${last.scale_max}`;
  } else {
    kpiSuds.textContent = '—';
    kpiPeak.textContent = '—';
  }

  const safeCount = events.filter((e) => e.event_type === 'SAFE_SPACE_ON').length;
  kpiSafespace.textContent = String(safeCount);

  reportNotesEditor.value = session.summary_notes || '';
  reportNotesPrint.textContent = session.summary_notes || 'Aucune note de synthèse.';

  chart.render(details);

  // Table chronologique unifiée
  const merged = [
    ...events.map((e) => ({
      ts: e.timestamp,
      kind: e.event_type,
      scene: e.scene_id,
      detail: formatEventDetail(e),
    })),
    ...likert.map((l) => ({
      ts: l.timestamp,
      kind: 'LIKERT',
      scene: l.scene_id,
      detail: `Score ${l.score}/${l.scale_max} — "${l.question}" (${l.response_time_ms ?? '?'} ms)`,
    })),
  ].sort((a, b) => a.ts - b.ts);

  timelineTbody.innerHTML = '';
  for (const row of merged) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(row.ts).toLocaleTimeString('fr-FR')}</td>
      <td><strong>${row.kind}</strong></td>
      <td>${SCENES_SCHEMA[row.scene]?.shortLabel || row.scene}</td>
      <td>${escapeHtml(row.detail)}</td>
    `;
    timelineTbody.appendChild(tr);
  }
}

function formatEventDetail(ev) {
  if (ev.event_type === 'PARAM_CHANGE') {
    return `${ev.payload?.key} → ${ev.payload?.value}`;
  }
  if (ev.event_type === 'CLINICAL_MARKER') {
    return `${ev.payload?.label}${ev.payload?.note ? ' : ' + ev.payload.note : ''}`;
  }
  if (ev.event_type === 'PRESET_APPLY') {
    return ev.payload?.label || ev.payload?.presetId;
  }
  if (ev.event_type === 'SAFE_SPACE_ON') return 'Activation d’urgence du Sanctuaire';
  if (ev.event_type === 'SAFE_SPACE_OFF') return 'Reprise de l’exposition';
  if (ev.event_type === 'SCENE_CHANGE') return `Chargement de ${ev.scene_id}`;
  return ev.payload_json;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

analyticsPatientFilter.addEventListener('change', () => {
  selectedAnalyticsSessionId = null;
  refreshSessionsList();
});

btnSaveReportNotes.addEventListener('click', async () => {
  if (!selectedAnalyticsSessionId) return;
  const notes = reportNotesEditor.value;
  await fetch(`/api/sessions/${selectedAnalyticsSessionId}/notes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaryNotes: notes }),
  });
  reportNotesPrint.textContent = notes || 'Aucune note de synthèse.';
});

btnPrintPdf.addEventListener('click', () => {
  reportNotesPrint.textContent = reportNotesEditor.value || 'Aucune note de synthèse.';
  window.print();
});

// Boot
await loadPatients();
await fetchStatusAndQr();
