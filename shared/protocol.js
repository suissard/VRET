/**
 * Protocole WebSocket partagé entre Serveur, Client VR, Contrôleur Mobile et Dashboard PC.
 */

export const ROLES = Object.freeze({
  VR: 'vr',
  MOBILE: 'mobile',
  PC: 'pc',
});

export const MSG_TYPES = Object.freeze({
  AUTH: 'AUTH',
  AUTH_OK: 'AUTH_OK',
  AUTH_ERROR: 'AUTH_ERROR',
  STATE_SYNC: 'STATE_SYNC',
  SCENE_LOAD: 'SCENE_LOAD',
  SCENE_READY: 'SCENE_READY',
  PARAM_UPDATE: 'PARAM_UPDATE',
  PRESET_APPLY: 'PRESET_APPLY',
  SAFE_SPACE_TOGGLE: 'SAFE_SPACE_TOGGLE',
  SAFE_SPACE_PARAM_UPDATE: 'SAFE_SPACE_PARAM_UPDATE',
  LIKERT_TRIGGER: 'LIKERT_TRIGGER',
  LIKERT_CANCEL: 'LIKERT_CANCEL',
  LIKERT_RESPONSE: 'LIKERT_RESPONSE',
  CLINICAL_MARKER: 'CLINICAL_MARKER',
  TELEMETRY: 'TELEMETRY',
  RTC_SIGNAL: 'RTC_SIGNAL',
  VIDEO_STREAM_TOGGLE: 'VIDEO_STREAM_TOGGLE',
  VIDEO_FRAME: 'VIDEO_FRAME',
  ERROR: 'ERROR',
});

/**
 * Construit une enveloppe JSON normalisée pour le protocole VRET.
 */
export function createMessage(type, payload = {}) {
  return {
    type,
    timestamp: Date.now(),
    payload,
  };
}

/**
 * Analyse et valide la structure de base d'un message WebSocket entrant.
 */
export function parseMessage(raw) {
  try {
    const str = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = JSON.parse(str);
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return {
      type: parsed.type,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      payload: parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {},
    };
  } catch {
    return null;
  }
}
