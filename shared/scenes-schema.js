/**
 * Schéma canonique des scènes thérapeutiques, paramètres, paliers cliniques et échelles de Likert.
 * Partagé entre le Serveur (validation), le Client VR (rendu), le Mobile (contrôles) et le Dashboard PC (analyse).
 */

export const SCENES_SCHEMA = Object.freeze({
  safe_space: {
    id: 'safe_space',
    label: 'Sanctuaire (Safe Space)',
    shortLabel: 'Safe Space',
    description: 'Environnement apaisant configurable (plage, forêt, prairie, lac alpin) et cohérence cardiaque.',
    icon: '🌿',
    hiddenFromCatalogue: true,
    params: {
      environment: {
        key: 'environment',
        label: 'Environnement du Sanctuaire',
        type: 'enum',
        options: [
          { value: 'beach', label: '🏝️ Plage' },
          { value: 'forest', label: '🌲 Forêt' },
          { value: 'meadow', label: '🌾 Prairie' },
          { value: 'mountain', label: '🏔️ Lac alpin' },
        ],
        default: 'beach',
      },
      lighting_mood: {
        key: 'lighting_mood',
        label: 'Ambiance lumineuse',
        type: 'enum',
        options: [
          { value: 'day', label: '☀️ Jour doux' },
          { value: 'sunset', label: '🌅 Coucher de soleil' },
          { value: 'starlight', label: '✨ Ciel étoilé' },
        ],
        default: 'day',
      },
      breathing_guide: {
        key: 'breathing_guide',
        label: 'Orbe de cohérence cardiaque',
        type: 'bool',
        default: true,
      },
    },
    presets: [],
  },

  elevator: {
    id: 'elevator',
    label: 'Claustrophobie — Ascenseur',
    shortLabel: 'Ascenseur',
    description: 'Cabine d’ascenseur modulable : volume, densité humaine, portes et incidents.',
    icon: '🛗',
    keyMetric: { key: 'cabin_size', label: 'Taille cabine', min: 0.6, max: 1.5, invertForStress: true },
    params: {
      cabin_size: {
        key: 'cabin_size',
        label: 'Taille de la cabine',
        unit: '×',
        type: 'float',
        min: 0.6,
        max: 1.5,
        step: 0.05,
        default: 1.2,
      },
      light_level: {
        key: 'light_level',
        label: 'Intensité lumineuse',
        unit: '%',
        displayScale: 100,
        type: 'float',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 1.0,
      },
      crowd_count: {
        key: 'crowd_count',
        label: 'Avatars présents',
        unit: 'pers.',
        type: 'int',
        min: 0,
        max: 6,
        step: 1,
        default: 0,
      },
      door_state: {
        key: 'door_state',
        label: 'État des portes',
        type: 'enum',
        options: [
          { value: 'open', label: 'Ouvertes' },
          { value: 'closed', label: 'Fermées' },
          { value: 'stuck', label: 'Bloquées' },
        ],
        default: 'open',
      },
      incident_flicker: {
        key: 'incident_flicker',
        label: 'Clignotement néon',
        type: 'bool',
        default: false,
      },
      incident_stop: {
        key: 'incident_stop',
        label: 'Arrêt mécanique',
        type: 'bool',
        default: false,
      },
    },
    presets: [
      {
        id: 'elevator_p1',
        label: 'Palier 1 — Cabine large ouverte',
        params: { cabin_size: 1.4, light_level: 1.0, crowd_count: 0, door_state: 'open', incident_flicker: false, incident_stop: false },
      },
      {
        id: 'elevator_p2',
        label: 'Palier 2 — Fermeture calme',
        params: { cabin_size: 1.15, light_level: 0.9, crowd_count: 1, door_state: 'closed', incident_flicker: false, incident_stop: false },
      },
      {
        id: 'elevator_p3',
        label: 'Palier 3 — Promiscuité & resserrement',
        params: { cabin_size: 0.85, light_level: 0.7, crowd_count: 4, door_state: 'closed', incident_flicker: false, incident_stop: false },
      },
      {
        id: 'elevator_p4',
        label: 'Palier 4 — Panne & pénombre',
        params: { cabin_size: 0.7, light_level: 0.25, crowd_count: 5, door_state: 'stuck', incident_flicker: true, incident_stop: true },
      },
    ],
  },

  acrophobia: {
    id: 'acrophobia',
    label: 'Acrophobie — Terrasse & Planche',
    shortLabel: 'Acrophobie',
    description: 'Terrasse urbaine, refuge intérieur, plancher à opacité modulable et mode planche.',
    icon: '🏙️',
    keyMetric: { key: 'height_floor', label: 'Étage', min: 1, max: 40, invertForStress: false },
    params: {
      height_floor: {
        key: 'height_floor',
        label: 'Hauteur (étage)',
        unit: 'ét.',
        type: 'int',
        min: 1,
        max: 40,
        step: 1,
        default: 2,
      },
      railing_opacity: {
        key: 'railing_opacity',
        label: 'Opacité garde-corps',
        unit: '%',
        displayScale: 100,
        type: 'float',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 1.0,
      },
      floor_opacity: {
        key: 'floor_opacity',
        label: 'Opacité du plancher',
        unit: '%',
        displayScale: 100,
        type: 'float',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 1.0,
      },
      platform_width: {
        key: 'platform_width',
        label: 'Largeur plateforme / planche',
        unit: 'm',
        type: 'float',
        min: 0.4,
        max: 6.0,
        step: 0.2,
        default: 4.2,
      },
      platform_length: {
        key: 'platform_length',
        label: 'Longueur plateforme / planche',
        unit: 'm',
        type: 'float',
        min: 1.5,
        max: 10.0,
        step: 0.5,
        default: 5.0,
      },
      wind_intensity: {
        key: 'wind_intensity',
        label: 'Intensité du vent',
        unit: '%',
        displayScale: 100,
        type: 'float',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 0.1,
      },
      weather: {
        key: 'weather',
        label: 'Ambiance / Météo',
        type: 'enum',
        options: [
          { value: 'clear', label: 'Clair' },
          { value: 'fog', label: 'Brouillard' },
          { value: 'night', label: 'Nuit' },
        ],
        default: 'clear',
      },
    },
    presets: [
      {
        id: 'acro_p1',
        label: 'Palier 1 — Balcon bas sécurisé',
        params: { height_floor: 2, railing_opacity: 1.0, floor_opacity: 1.0, platform_width: 4.2, platform_length: 5.0, wind_intensity: 0.1, weather: 'clear' },
      },
      {
        id: 'acro_p2',
        label: 'Palier 2 — 10e étage garde-corps verre',
        params: { height_floor: 10, railing_opacity: 0.35, floor_opacity: 0.85, platform_width: 4.2, platform_length: 5.0, wind_intensity: 0.3, weather: 'clear' },
      },
      {
        id: 'acro_p3',
        label: 'Palier 3 — 25e étage plancher verre',
        params: { height_floor: 25, railing_opacity: 0.25, floor_opacity: 0.25, platform_width: 3.6, platform_length: 5.0, wind_intensity: 0.55, weather: 'fog' },
      },
      {
        id: 'acro_p4',
        label: 'Palier 4 — Mode Planche (25e étage)',
        params: { height_floor: 25, railing_opacity: 0.0, floor_opacity: 0.9, platform_width: 0.6, platform_length: 6.5, wind_intensity: 0.65, weather: 'clear' },
      },
      {
        id: 'acro_p5',
        label: 'Palier 5 — Sommet 40e planche verre nuit',
        params: { height_floor: 40, railing_opacity: 0.0, floor_opacity: 0.15, platform_width: 0.8, platform_length: 6.0, wind_intensity: 0.85, weather: 'night' },
      },
    ],
  },

  arachnophobia: {
    id: 'arachnophobia',
    label: 'Arachnophobie — Salle d’exposition',
    shortLabel: 'Arachnophobie',
    description: 'Exposition graduée : taille, nombre, réalisme, vitesse et distance de sécurité.',
    icon: '🕷️',
    keyMetric: { key: 'spider_count', label: 'Nb araignées', min: 0, max: 20, invertForStress: false },
    params: {
      spider_count: {
        key: 'spider_count',
        label: 'Nombre d’araignées',
        unit: '',
        type: 'int',
        min: 0,
        max: 20,
        step: 1,
        default: 1,
      },
      spider_scale: {
        key: 'spider_scale',
        label: 'Taille',
        unit: '×',
        type: 'float',
        min: 0.2,
        max: 3.0,
        step: 0.1,
        default: 0.5,
      },
      realism_level: {
        key: 'realism_level',
        label: 'Style visuel',
        type: 'enum',
        options: [
          { value: 'cartoon', label: 'Stylisé (Cartoon)' },
          { value: 'realistic', label: 'Réaliste' },
        ],
        default: 'cartoon',
      },
      movement_speed: {
        key: 'movement_speed',
        label: 'Vitesse de déplacement',
        unit: '%',
        displayScale: 100,
        type: 'float',
        min: 0.0,
        max: 1.0,
        step: 0.05,
        default: 0.0,
      },
      min_distance: {
        key: 'min_distance',
        label: 'Distance de sécurité patient',
        unit: 'm',
        type: 'float',
        min: 0.5,
        max: 4.0,
        step: 0.1,
        default: 3.0,
      },
    },
    presets: [
      {
        id: 'arach_p1',
        label: 'Palier 1 — Petite stylisée immobile à distance',
        params: { spider_count: 1, spider_scale: 0.4, realism_level: 'cartoon', movement_speed: 0.0, min_distance: 3.0 },
      },
      {
        id: 'arach_p2',
        label: 'Palier 2 — Réaliste immobile sur table',
        params: { spider_count: 1, spider_scale: 0.9, realism_level: 'realistic', movement_speed: 0.0, min_distance: 2.0 },
      },
      {
        id: 'arach_p3',
        label: 'Palier 3 — Groupe en mouvement modéré',
        params: { spider_count: 5, spider_scale: 1.2, realism_level: 'realistic', movement_speed: 0.4, min_distance: 1.2 },
      },
      {
        id: 'arach_p4',
        label: 'Palier 4 — Haute densité & proximité',
        params: { spider_count: 14, spider_scale: 2.0, realism_level: 'realistic', movement_speed: 0.75, min_distance: 0.6 },
      },
    ],
  },
});

export const LIKERT_PRESETS = Object.freeze([
  {
    id: 'suds_0_10',
    label: 'Anxiété (SUDs 0–10)',
    question: 'Quel est votre niveau d’anxiété en ce moment ?',
    scaleMin: 0,
    scaleMax: 10,
    labels: ['Calme total', 'Panique extrême'],
  },
  {
    id: 'avoidance_1_5',
    label: 'Envie de fuir (1–5)',
    question: 'Quelle est votre envie de quitter la situation ?',
    scaleMin: 1,
    scaleMax: 5,
    labels: ['Aucune', 'Irrésistible'],
  },
  {
    id: 'control_0_10',
    label: 'Maîtrise / Contrôle (0–10)',
    question: 'À quel point vous sentez-vous en contrôle ?',
    scaleMin: 0,
    scaleMax: 10,
    labels: ['Dépassé', 'Maîtrise totale'],
  },
  {
    id: 'suds_0_100',
    label: 'SUDs fin (0–100, pas de 10)',
    question: 'Évaluez votre détresse subjective (0 à 100) :',
    scaleMin: 0,
    scaleMax: 100,
    step: 10,
    labels: ['0 — Repos', '100 — Maximum'],
  },
]);

export const CLINICAL_MARKERS = Object.freeze([
  { id: 'breathing', label: 'Respiration guidée', icon: '🫁' },
  { id: 'anxiety_peak', label: 'Pic d’anxiété observé', icon: '📈' },
  { id: 'cognitive_reappraisal', label: 'Réévaluation cognitive', icon: '🧠' },
  { id: 'avoidance', label: 'Évitement / Recul physique', icon: '↩️' },
]);

/**
 * Retourne la liste des scènes exposables dans le catalogue thérapeutique.
 */
export function getTherapyScenes() {
  return Object.values(SCENES_SCHEMA).filter((s) => !s.hiddenFromCatalogue);
}

/**
 * Retourne un objet neuf contenant les valeurs par défaut des paramètres d'une scène.
 */
export function getDefaultParams(sceneId) {
  const schema = SCENES_SCHEMA[sceneId];
  if (!schema) return {};
  const defaults = {};
  for (const [key, def] of Object.entries(schema.params)) {
    defaults[key] = def.default;
  }
  return defaults;
}

/**
 * Valide et borne une valeur de paramètre selon le schéma de la scène.
 * Retourne { valid: boolean, value?: any, error?: string }.
 */
export function validateAndClampParam(sceneId, key, rawValue) {
  const schema = SCENES_SCHEMA[sceneId];
  if (!schema) {
    return { valid: false, error: `Scène inconnue: ${sceneId}` };
  }
  const paramDef = schema.params[key];
  if (!paramDef) {
    return { valid: false, error: `Paramètre inconnu '${key}' pour la scène ${sceneId}` };
  }

  if (paramDef.type === 'float') {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return { valid: false, error: 'Valeur flottante invalide' };
    const clamped = Math.min(paramDef.max, Math.max(paramDef.min, num));
    return { valid: true, value: Math.round(clamped * 1000) / 1000 };
  }

  if (paramDef.type === 'int') {
    const num = Math.round(Number(rawValue));
    if (!Number.isFinite(num)) return { valid: false, error: 'Valeur entière invalide' };
    const clamped = Math.min(paramDef.max, Math.max(paramDef.min, num));
    return { valid: true, value: clamped };
  }

  if (paramDef.type === 'bool') {
    if (typeof rawValue === 'boolean') return { valid: true, value: rawValue };
    if (rawValue === 'true' || rawValue === 1) return { valid: true, value: true };
    if (rawValue === 'false' || rawValue === 0) return { valid: true, value: false };
    return { valid: false, error: 'Valeur booléenne invalide' };
  }

  if (paramDef.type === 'enum') {
    const allowed = paramDef.options.map((o) => o.value);
    if (!allowed.includes(rawValue)) {
      return { valid: false, error: `Option invalide '${rawValue}'` };
    }
    return { valid: true, value: rawValue };
  }

  return { valid: false, error: 'Type de paramètre non supporté' };
}

/**
 * Fusionne les valeurs par défaut d'une scène avec un objet de paramètres brut,
 * en validant et bornant chaque champ connu.
 */
export function sanitizeSceneParams(sceneId, rawParams = {}) {
  const result = getDefaultParams(sceneId);
  if (!rawParams || typeof rawParams !== 'object') return result;
  for (const [key, val] of Object.entries(rawParams)) {
    const check = validateAndClampParam(sceneId, key, val);
    if (check.valid) {
      result[key] = check.value;
    }
  }
  return result;
}
