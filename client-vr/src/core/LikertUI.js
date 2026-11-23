import * as THREE from 'three';

/**
 * Échelle de Likert 3D World-Space :
 * - Positionnée à 1,8 m devant le regard (yaw horizontal uniquement)
 * - Anti-clipping (depthTest: false, renderOrder: 999)
 * - CanvasTexture 1024x512 haute netteté
 * - Double interaction : Raycast Manette/Souris + Gaze (1,5 s)
 */
export class LikertUI {
  constructor(renderer, soundEngine, onSubmit) {
    this.renderer = renderer;
    this.soundEngine = soundEngine;
    this.onSubmit = onSubmit;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const maxAniso = this.renderer?.capabilities?.getMaxAnisotropy?.() || 4;
    this.texture.anisotropy = Math.min(8, maxAniso);

    this.panelWidth = 1.5;
    this.panelHeight = 0.75;

    const geo = new THREE.PlaneGeometry(this.panelWidth, this.panelHeight);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 999;
    this.mesh.visible = false;

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.visible = false;

    this.activePrompt = null;
    this.options = [];
    this.buttonRects = [];
    this.hoveredIndex = -1;
    this.gazeProgress = 0;
    this.gazeDwellSeconds = 1.5;

    this.raycaster = new THREE.Raycaster();
    this.tempMatrix = new THREE.Matrix4();
    this.camPos = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
  }

  show(prompt, xrCamera) {
    if (!prompt) {
      this.hide();
      return;
    }
    this.activePrompt = prompt;
    this.hoveredIndex = -1;
    this.gazeProgress = 0;

    // Construire la liste des valeurs discrètes (ex: 0..10 ou 0..100 pas 10)
    const step = prompt.step || 1;
    const vals = [];
    for (let v = prompt.scaleMin; v <= prompt.scaleMax; v += step) {
      vals.push(v);
    }
    this.options = vals;

    // Positionner à 1,8 m devant la caméra sur l'axe horizontal (yaw uniquement)
    if (xrCamera) {
      xrCamera.getWorldPosition(this.camPos);
      xrCamera.getWorldDirection(this.camDir);
      this.camDir.y = 0;
      if (this.camDir.lengthSq() < 0.001) {
        this.camDir.set(0, 0, -1);
      } else {
        this.camDir.normalize();
      }
      this.group.position.set(
        this.camPos.x + this.camDir.x * 1.8,
        this.camPos.y,
        this.camPos.z + this.camDir.z * 1.8
      );
      this.group.lookAt(this.camPos.x, this.camPos.y, this.camPos.z);
    }

    this.group.visible = true;
    this.mesh.visible = true;
    this.#redraw();
  }

  hide() {
    this.activePrompt = null;
    this.hoveredIndex = -1;
    this.gazeProgress = 0;
    this.group.visible = false;
    this.mesh.visible = false;
  }

  isVisible() {
    return Boolean(this.activePrompt && this.group.visible);
  }

  /**
   * Teste l'intersection depuis une manette WebXR ou depuis la caméra (mode Gaze) ou un pointeur NDC.
   */
  update(dt, { xrCamera, controllers = [], forceGaze = false, pointerNdc = null }) {
    if (!this.isVisible()) return;

    let hitUv = null;
    const hasActiveController = controllers.some((c) => c.visible);
    const useGaze = forceGaze || !hasActiveController;

    if (pointerNdc && xrCamera) {
      this.raycaster.setFromCamera(pointerNdc, xrCamera);
      const hits = this.raycaster.intersectObject(this.mesh, false);
      if (hits.length > 0 && hits[0].uv) hitUv = hits[0].uv;
    }

    if (!hitUv && hasActiveController) {
      for (const ctrl of controllers) {
        if (!ctrl.visible) continue;
        this.tempMatrix.identity().extractRotation(ctrl.matrixWorld);
        this.raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
        const hits = this.raycaster.intersectObject(this.mesh, false);
        if (hits.length > 0 && hits[0].uv) {
          hitUv = hits[0].uv;
          break;
        }
      }
    }

    if (!hitUv && useGaze && xrCamera) {
      xrCamera.getWorldPosition(this.raycaster.ray.origin);
      xrCamera.getWorldDirection(this.raycaster.ray.direction);
      const hits = this.raycaster.intersectObject(this.mesh, false);
      if (hits.length > 0 && hits[0].uv) {
        hitUv = hits[0].uv;
      }
    }

    const newHover = hitUv ? this.#findButtonAtUv(hitUv) : -1;

    if (newHover !== this.hoveredIndex) {
      this.hoveredIndex = newHover;
      this.gazeProgress = 0;
      this.#redraw();
    }

    if (useGaze && this.hoveredIndex >= 0) {
      this.gazeProgress += dt / this.gazeDwellSeconds;
      this.#redraw();
      if (this.gazeProgress >= 1.0) {
        this.selectHovered();
      }
    }
  }

  selectHovered() {
    if (!this.isVisible() || this.hoveredIndex < 0) return false;
    const value = this.options[this.hoveredIndex];
    const prompt = this.activePrompt;
    this.soundEngine?.playLikertConfirm();
    this.hide();
    if (this.onSubmit && prompt) {
      this.onSubmit({
        promptId: prompt.promptId,
        value,
        responseTimeMs: Math.max(0, Date.now() - (prompt.triggeredAt || Date.now())),
      });
    }
    return true;
  }

  selectValueDirect(val) {
    if (!this.isVisible()) return false;
    if (!this.options.includes(val)) return false;
    const prompt = this.activePrompt;
    this.soundEngine?.playLikertConfirm();
    this.hide();
    if (this.onSubmit && prompt) {
      this.onSubmit({
        promptId: prompt.promptId,
        value: val,
        responseTimeMs: Math.max(0, Date.now() - (prompt.triggeredAt || Date.now())),
      });
    }
    return true;
  }

  #findButtonAtUv(uv) {
    const px = uv.x * this.canvas.width;
    const py = (1 - uv.y) * this.canvas.height;
    for (let i = 0; i < this.buttonRects.length; i++) {
      const r = this.buttonRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
        return i;
      }
    }
    return -1;
  }

  #redraw() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Fond carte sombre translucide à contraste élevé
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    this.#roundRect(ctx, 16, 16, W - 32, H - 32, 28);
    ctx.fill();

    ctx.lineWidth = 4;
    ctx.strokeStyle = '#38bdf8';
    this.#roundRect(ctx, 16, 16, W - 32, H - 32, 28);
    ctx.stroke();

    if (!this.activePrompt) return;

    // Titre / Question
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.activePrompt.question, W / 2, 108, W - 110);

    // Boutons d'échelle
    const count = this.options.length;
    const padX = 56;
    const gap = 12;
    const availW = W - padX * 2 - gap * (count - 1);
    const btnW = Math.min(84, availW / count);
    const totalRowW = count * btnW + (count - 1) * gap;
    const startX = (W - totalRowW) / 2;
    const btnY = 185;
    const btnH = 128;

    this.buttonRects = [];

    for (let i = 0; i < count; i++) {
      const val = this.options[i];
      const bx = startX + i * (btnW + gap);
      this.buttonRects.push({ x: bx, y: btnY, w: btnW, h: btnH });

      const isHover = i === this.hoveredIndex;
      const ratio = count > 1 ? i / (count - 1) : 0;
      const baseColor = ratio < 0.35 ? '#0f766e' : ratio < 0.7 ? '#b45309' : '#b91c1c';

      ctx.fillStyle = isHover ? '#0284c7' : '#1e293b';
      this.#roundRect(ctx, bx, btnY, btnW, btnH, 14);
      ctx.fill();

      ctx.lineWidth = isHover ? 5 : 3;
      ctx.strokeStyle = isHover ? '#7dd3fc' : baseColor;
      this.#roundRect(ctx, bx, btnY, btnW, btnH, 14);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(val), bx + btnW / 2, btnY + btnH / 2);

      // Anneau de progression Gaze si survolé en mode Gaze
      if (isHover && this.gazeProgress > 0) {
        ctx.beginPath();
        ctx.arc(
          bx + btnW / 2,
          btnY + btnH / 2,
          Math.min(btnW, btnH) * 0.38,
          -Math.PI / 2,
          -Math.PI / 2 + Math.min(1, this.gazeProgress) * Math.PI * 2
        );
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();
      }
    }

    // Labels extrêmes
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText(this.activePrompt.labels?.[0] || 'Calme', startX, 375);
    ctx.textAlign = 'right';
    ctx.fillText(this.activePrompt.labels?.[1] || 'Panique', startX + totalRowW, 375);

    ctx.textAlign = 'center';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Visez avec la manette (gâchette) ou fixez la note 1,5 s du regard', W / 2, 445);

    this.texture.needsUpdate = true;
  }

  #roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
