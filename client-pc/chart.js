import { SCENES_SCHEMA } from '/shared/scenes-schema.js';

/**
 * Moteur de graphique clinique synchronisé 100 % local (Canvas 2D haute résolution).
 * Trace sur le même axe temporel :
 * - Courbe principale : scores Likert (SUDs) normalisés ou 0..10
 * - Courbe secondaire : intensité normalisée (0..100%) du stimulus clé de la scène
 * - Zones vertes : intervalles d'activation du Safe Space
 * - Repères verticaux : marqueurs cliniques et changements de scène
 */
export class ClinicalChart {
  constructor(canvas, tooltipEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltipEl = tooltipEl;
    this.hitPoints = [];

    this.canvas.addEventListener('mousemove', (e) => this.#onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      if (this.tooltipEl) this.tooltipEl.classList.add('hidden');
    });
  }

  render(details) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    this.hitPoints = [];

    if (!details || !details.session) return;

    const { session, events, likert } = details;
    const startTs = session.started_at;
    const allTs = [
      startTs,
      session.ended_at || startTs + 60000,
      ...events.map((e) => e.timestamp),
      ...likert.map((l) => l.timestamp),
    ];
    const minT = Math.min(...allTs);
    const maxT = Math.max(minT + 30000, ...allTs);
    const spanT = maxT - minT;

    const pad = { left: 56, right: 56, top: 28, bottom: 42 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const xOf = (ts) => pad.left + ((ts - minT) / spanT) * plotW;
    const yOfScore = (score, scaleMin, scaleMax) => {
      const ratio = scaleMax > scaleMin ? (score - scaleMin) / (scaleMax - scaleMin) : 0;
      return pad.top + plotH - ratio * plotH;
    };
    const yOfPct = (pct) => pad.top + plotH - (pct / 100) * plotH;

    // 1. Grille de fond
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';

    for (let i = 0; i <= 5; i++) {
      const y = pad.top + (plotH * i) / 5;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();

      const sudVal = Math.round(10 - i * 2);
      ctx.textAlign = 'right';
      ctx.fillText(String(sudVal), pad.left - 10, y + 4);

      const pctVal = 100 - i * 20;
      ctx.textAlign = 'left';
      ctx.fillText(`${pctVal}%`, W - pad.right + 8, y + 4);
    }

    // Axe X (minutes écoulées)
    ctx.textAlign = 'center';
    for (let i = 0; i <= 6; i++) {
      const t = minT + (spanT * i) / 6;
      const x = xOf(t);
      const mins = ((t - minT) / 60000).toFixed(1);
      ctx.fillText(`${mins} min`, x, H - 14);
    }

    // 2. Zones Safe Space (entre SAFE_SPACE_ON et SAFE_SPACE_OFF)
    let safeStart = null;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
    for (const ev of events) {
      if (ev.event_type === 'SAFE_SPACE_ON' && safeStart === null) {
        safeStart = ev.timestamp;
      } else if (ev.event_type === 'SAFE_SPACE_OFF' && safeStart !== null) {
        const x1 = xOf(safeStart);
        const x2 = xOf(ev.timestamp);
        ctx.fillRect(x1, pad.top, Math.max(4, x2 - x1), plotH);
        safeStart = null;
      }
    }
    if (safeStart !== null) {
      const x1 = xOf(safeStart);
      const x2 = xOf(maxT);
      ctx.fillRect(x1, pad.top, Math.max(4, x2 - x1), plotH);
    }

    // 3. Courbe Stimulus Clé (%) en escalier
    const stimPoints = [];
    let currentScene = session.initial_scene;
    let currentParams = {};
    for (const ev of events) {
      if (ev.event_type === 'SCENE_CHANGE') {
        currentScene = ev.scene_id;
        currentParams = { ...(ev.payload?.params || {}) };
      } else if (ev.event_type === 'PARAM_CHANGE') {
        currentParams[ev.payload?.key] = ev.payload?.value;
      } else if (ev.event_type === 'PRESET_APPLY') {
        currentParams = { ...(ev.payload?.params || currentParams) };
      }
      const metric = SCENES_SCHEMA[currentScene]?.keyMetric;
      if (metric && currentParams[metric.key] !== undefined) {
        const raw = Number(currentParams[metric.key]);
        let ratio = (raw - metric.min) / (metric.max - metric.min || 1);
        ratio = Math.max(0, Math.min(1, ratio));
        if (metric.invertForStress) ratio = 1 - ratio;
        stimPoints.push({
          t: ev.timestamp,
          pct: Math.round(ratio * 100),
          label: `${metric.label}: ${raw}`,
        });
      }
    }

    if (stimPoints.length > 0) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      stimPoints.forEach((pt, idx) => {
        const x = xOf(pt.t);
        const y = yOfPct(pt.pct);
        if (idx === 0) {
          ctx.moveTo(x, y);
        } else {
          // Tracer en palier (step-after)
          const prevY = yOfPct(stimPoints[idx - 1].pct);
          ctx.lineTo(x, prevY);
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo(xOf(maxT), yOfPct(stimPoints[stimPoints.length - 1].pct));
      ctx.stroke();
    }

    // 4. Repères verticaux des Marqueurs Cliniques
    for (const ev of events) {
      if (ev.event_type === 'CLINICAL_MARKER') {
        const x = xOf(ev.timestamp);
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x, pad.top + 8, 5, 0, Math.PI * 2);
        ctx.fill();

        this.hitPoints.push({
          x,
          y: pad.top + 8,
          title: ev.payload?.label || 'Marqueur clinique',
          body: ev.payload?.note || new Date(ev.timestamp).toLocaleTimeString(),
        });
      }
    }

    // 5. Courbe principale Likert (SUDs)
    if (likert.length > 0) {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      likert.forEach((lk, idx) => {
        const x = xOf(lk.timestamp);
        const y = yOfScore(lk.score, lk.scale_min, lk.scale_max);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      for (const lk of likert) {
        const x = xOf(lk.timestamp);
        const y = yOfScore(lk.score, lk.scale_min, lk.scale_max);
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 3;
        ctx.stroke();

        const paramsStr = Object.entries(lk.activeParams || {})
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        this.hitPoints.push({
          x,
          y,
          title: `Score ${lk.score}/${lk.scale_max} (${new Date(lk.timestamp).toLocaleTimeString()})`,
          body: `${lk.question}\nParamètres : ${paramsStr || 'défaut'}`,
        });
      }
    }
  }

  #onMouseMove(e) {
    if (!this.tooltipEl || this.hitPoints.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let closest = null;
    let bestDist = 24;
    for (const pt of this.hitPoints) {
      const d = Math.hypot(pt.x - mx, pt.y - my);
      if (d < bestDist) {
        bestDist = d;
        closest = pt;
      }
    }

    if (closest) {
      this.tooltipEl.innerHTML = `<strong>${escapeHtml(closest.title)}</strong><br/>${escapeHtml(closest.body).replace(/\n/g, '<br/>')}`;
      this.tooltipEl.style.left = `${Math.min(rect.width - 260, Math.max(8, e.clientX - rect.left + 12))}px`;
      this.tooltipEl.style.top = `${Math.max(8, e.clientY - rect.top - 32)}px`;
      this.tooltipEl.classList.remove('hidden');
    } else {
      this.tooltipEl.classList.add('hidden');
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
