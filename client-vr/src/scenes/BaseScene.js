import * as THREE from 'three';

/**
 * Classe abstraite commune à toutes les scènes 3D thérapeutiques VRET.
 * Garantit l'interpolation douce des stimuli et l'absence de fuite mémoire GPU.
 */
export class BaseScene {
  constructor(renderer, soundEngine) {
    this.renderer = renderer;
    this.soundEngine = soundEngine;
    this.scene = new THREE.Scene();
    this.params = {};
    this.targets = {};
    this.elapsed = 0;
  }

  async preload() {
    // Surchargeable si la scène doit précharger des ressources
  }

  onEnter(initialParams = {}) {
    this.params = { ...initialParams };
    this.targets = { ...initialParams };
  }

  setParam(key, targetValue) {
    this.targets[key] = targetValue;
  }

  lerp(current, target, speed, dt) {
    const factor = 1 - Math.exp(-speed * dt);
    return THREE.MathUtils.lerp(current, target, factor);
  }

  /**
   * Retourne les bornes marchables { minX, maxX, minZ, maxZ, y } pour la téléportation sécurisée.
   */
  getNavBounds() {
    return { minX: -2.0, maxX: 2.0, minZ: -2.0, maxZ: 2.0, y: 0 };
  }

  /**
   * Contraint une position (x, z) à la zone marchable valide de la scène.
   */
  clampPosition(x, z) {
    const b = this.getNavBounds();
    return {
      x: THREE.MathUtils.clamp(x, b.minX, b.maxX),
      z: THREE.MathUtils.clamp(z, b.minZ, b.maxZ),
    };
  }

  /**
   * Retourne l'intensité de mouvement vertical/caméra pour le vignettage de confort.
   */
  getMotionIntensity() {
    return 0;
  }

  update(dt, xrCamera, playerRig) {
    this.elapsed += dt;
  }

  onExit() {
    // Arrêt des sons spécifiques à la scène
  }

  dispose() {
    this.onExit();
    this.scene.traverse((obj) => {
      if (obj.geometry) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          for (const value of Object.values(mat)) {
            if (value && typeof value === 'object' && typeof value.dispose === 'function' && value.isTexture) {
              value.dispose();
            }
          }
          mat.dispose();
        }
      }
    });
    this.scene.clear();
  }
}
