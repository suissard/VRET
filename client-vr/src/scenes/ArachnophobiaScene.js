import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

/**
 * Scène Arachnophobie — Salle d'exposition clinique.
 * Pool de 20 araignées articulées avec toggle Cartoon/Réaliste, vitesse, taille et bulle de sécurité strictement respectée.
 */
export class ArachnophobiaScene extends BaseScene {
  constructor(renderer, soundEngine) {
    super(renderer, soundEngine);
    this.spiders = [];
    this.safetyRing = null;
    this.curScale = 0.5;
    this.curMinDist = 3.0;
    this.curRealism = 'cartoon';
    this.camWorldPos = new THREE.Vector3();

    // Matériaux partagés (optimisation GPU)
    this.cartoonBodyMat = new THREE.MeshLambertMaterial({ color: '#7c3aed' });
    this.cartoonLegMat = new THREE.MeshLambertMaterial({ color: '#a78bfa' });
    this.cartoonEyeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

    this.realBodyMat = new THREE.MeshStandardMaterial({ color: '#1c1917', roughness: 0.9 });
    this.realLegMat = new THREE.MeshStandardMaterial({ color: '#292524', roughness: 0.85 });
    this.realEyeMat = new THREE.MeshBasicMaterial({ color: '#09090b' });

    this.#build();
  }

  #build() {
    this.scene.background = new THREE.Color('#f1f5f9');

    const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 1.05);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight('#fffbeb', 0.7);
    dir.position.set(3, 6, 4);
    this.scene.add(dir);

    // Pièce clinique chaleureuse (9m x 9m)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshLambertMaterial({ color: '#e2d4c0' })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const wallMat = new THREE.MeshLambertMaterial({ color: '#e2e8f0' });
    const wallConfigs = [
      [0, 1.75, -4.5, 0],
      [0, 1.75, 4.5, Math.PI],
      [-4.5, 1.75, 0, Math.PI / 2],
      [4.5, 1.75, 0, -Math.PI / 2],
    ];
    for (const [wx, wy, wz, ry] of wallConfigs) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.5), wallMat);
      w.position.set(wx, wy, wz);
      w.rotation.y = ry;
      this.scene.add(w);
    }

    // Table d'observation devant le patient (Z = -2.2)
    const woodMat = new THREE.MeshLambertMaterial({ color: '#a16207' });
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.2), woodMat);
    tableTop.position.set(0, 0.78, -2.4);
    this.scene.add(tableTop);
    for (const [lx, lz] of [[-0.95, -2.9], [0.95, -2.9], [-0.95, -1.9], [0.95, -1.9]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.78, 0.08), woodMat);
      leg.position.set(lx, 0.39, lz);
      this.scene.add(leg);
    }

    // Anneau discret au sol visualisant le rayon de sécurité min_distance
    const ringGeo = new THREE.RingGeometry(0.98, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    this.safetyRing = new THREE.Mesh(ringGeo, ringMat);
    this.safetyRing.position.y = 0.01;
    this.scene.add(this.safetyRing);

    // Pool de 20 araignées articulées
    for (let i = 0; i < 20; i++) {
      const spider = this.#createSpider(i);
      spider.group.visible = false;
      this.scene.add(spider.group);
      this.spiders.push(spider);
    }
  }

  #createSpider(index) {
    const group = new THREE.Group();
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), this.cartoonBodyMat);
    abdomen.position.set(0, 0.045, 0.055);
    abdomen.scale.set(1, 0.85, 1.2);

    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), this.cartoonBodyMat);
    thorax.position.set(0, 0.038, -0.025);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), this.cartoonEyeMat);
    eyeL.position.set(-0.016, 0.048, -0.056);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), this.cartoonEyeMat);
    eyeR.position.set(0.016, 0.048, -0.056);

    group.add(abdomen, thorax, eyeL, eyeR);

    const legs = [];
    const legGeo = new THREE.CylinderGeometry(0.005, 0.003, 0.14, 6);
    legGeo.translate(0, 0.07, 0);

    for (let side of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.025, 0.035, -0.035 + j * 0.022);
        const legMesh = new THREE.Mesh(legGeo, this.cartoonLegMat);
        legMesh.rotation.z = side * -1.15;
        legMesh.rotation.y = side * (0.45 - j * 0.3);
        pivot.add(legMesh);
        group.add(pivot);
        legs.push({ pivot, side, j, legMesh });
      }
    }

    // Position initiale sur la table ou autour de la pièce
    const onTable = index < 4;
    const angle = (index / 20) * Math.PI * 2;
    const pos = onTable
      ? new THREE.Vector3((index - 1.5) * 0.35, 0.82, -2.4)
      : new THREE.Vector3(Math.cos(angle) * 3.1, 0, Math.sin(angle) * 3.1);

    group.position.copy(pos);

    return {
      group,
      abdomen,
      thorax,
      eyeL,
      eyeR,
      legs,
      onTable,
      heading: angle + Math.PI * 0.5,
      phase: index * 0.9,
    };
  }

  #applyRealism(mode) {
    const isReal = mode === 'realistic';
    const bodyMat = isReal ? this.realBodyMat : this.cartoonBodyMat;
    const legMat = isReal ? this.realLegMat : this.cartoonLegMat;
    const eyeMat = isReal ? this.realEyeMat : this.cartoonEyeMat;

    for (const sp of this.spiders) {
      sp.abdomen.material = bodyMat;
      sp.thorax.material = bodyMat;
      sp.eyeL.material = eyeMat;
      sp.eyeR.material = eyeMat;
      sp.eyeL.scale.setScalar(isReal ? 0.55 : 1.15);
      sp.eyeR.scale.setScalar(isReal ? 0.55 : 1.15);
      for (const l of sp.legs) {
        l.legMesh.material = legMat;
      }
    }
    this.curRealism = mode;
  }

  getNavBounds() {
    return { minX: -3.5, maxX: 3.5, minZ: -1.4, maxZ: 3.5, y: 0 };
  }

  onEnter(initialParams = {}) {
    super.onEnter({
      spider_count: 1,
      spider_scale: 0.5,
      realism_level: 'cartoon',
      movement_speed: 0.0,
      min_distance: 3.0,
      ...initialParams,
    });
    this.curScale = Number(this.targets.spider_scale ?? 0.5);
    this.curMinDist = Number(this.targets.min_distance ?? 3.0);
    this.#applyRealism(this.targets.realism_level || 'cartoon');
  }

  update(dt, xrCamera) {
    super.update(dt, xrCamera);

    const targetCount = Math.round(Number(this.targets.spider_count ?? 1));
    const targetScale = Number(this.targets.spider_scale ?? 0.5);
    const targetSpeed = Number(this.targets.movement_speed ?? 0.0);
    const targetMinDist = Number(this.targets.min_distance ?? 3.0);
    const targetRealism = this.targets.realism_level || 'cartoon';

    this.curScale = this.lerp(this.curScale, targetScale, 3.5, dt);
    this.curMinDist = this.lerp(this.curMinDist, targetMinDist, 3.5, dt);

    if (targetRealism !== this.curRealism) {
      this.#applyRealism(targetRealism);
    }

    if (xrCamera) {
      xrCamera.getWorldPosition(this.camWorldPos);
    } else {
      this.camWorldPos.set(0, 1.65, 0);
    }

    // Mettre à jour le cercle visuel de sécurité centré sur le patient
    this.safetyRing.position.x = this.camWorldPos.x;
    this.safetyRing.position.z = this.camWorldPos.z;
    this.safetyRing.scale.setScalar(this.curMinDist);

    for (let i = 0; i < this.spiders.length; i++) {
      const sp = this.spiders[i];
      sp.group.visible = i < targetCount;
      if (!sp.group.visible) continue;

      sp.group.scale.setScalar(this.curScale);

      if (targetSpeed > 0.01) {
        const moveDist = targetSpeed * 1.15 * dt;
        sp.heading += Math.sin(this.elapsed * 0.9 + sp.phase) * 1.4 * dt;
        sp.group.position.x += Math.sin(sp.heading) * moveDist;
        sp.group.position.z += Math.cos(sp.heading) * moveDist;

        // Bornes de pièce ou de table
        if (sp.onTable) {
          if (Math.abs(sp.group.position.x) > 0.95) sp.heading += Math.PI;
          if (sp.group.position.z < -2.9 || sp.group.position.z > -1.9) sp.heading += Math.PI;
          sp.group.position.x = THREE.MathUtils.clamp(sp.group.position.x, -0.95, 0.95);
          sp.group.position.z = THREE.MathUtils.clamp(sp.group.position.z, -2.9, -1.9);
          sp.group.position.y = 0.82;
        } else {
          if (Math.abs(sp.group.position.x) > 4.0) sp.heading += Math.PI;
          if (Math.abs(sp.group.position.z) > 4.0) sp.heading += Math.PI;
          sp.group.position.x = THREE.MathUtils.clamp(sp.group.position.x, -4.0, 4.0);
          sp.group.position.z = THREE.MathUtils.clamp(sp.group.position.z, -4.0, 4.0);
          sp.group.position.y = 0;
        }
      }

      // Respect strict du rayon de sécurité XZ autour du patient
      const dx = sp.group.position.x - this.camWorldPos.x;
      const dz = sp.group.position.z - this.camWorldPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < this.curMinDist * this.curMinDist) {
        const dist = Math.sqrt(distSq) || 0.001;
        const nx = dx / dist;
        const nz = dz / dist;
        sp.group.position.x = this.camWorldPos.x + nx * this.curMinDist;
        sp.group.position.z = this.camWorldPos.z + nz * this.curMinDist;
        sp.heading = Math.atan2(nx, nz);
      }

      sp.group.rotation.y = sp.heading + Math.PI;

      // Animation des 8 pattes proportionnelle à la vitesse
      const legFreq = targetSpeed > 0.01 ? 8 + targetSpeed * 18 : 1.5;
      const legAmp = targetSpeed > 0.01 ? 0.25 : 0.03;
      for (const leg of sp.legs) {
        const alt = (leg.j % 2 === 0 ? 1 : -1) * leg.side;
        leg.pivot.rotation.y = Math.sin(this.elapsed * legFreq + sp.phase) * legAmp * alt;
      }
    }
  }
}
