import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

/**
 * Sanctuaire de sécurité ("Safe Space") configurable :
 * - Environnements : Plage (beach), Forêt (forest), Prairie (meadow), Lac alpin (mountain)
 * - Ambiance lumineuse : Jour doux (day), Coucher de soleil (sunset), Ciel étoilé (starlight)
 * - Orbe de cohérence cardiaque activable/désactivable (cycle 10s)
 */
export class SafeSpaceScene extends BaseScene {
  constructor(renderer, soundEngine) {
    super(renderer, soundEngine);
    this.hemiLight = null;
    this.sunLight = null;
    this.sunDisc = null;
    this.starField = null;
    this.ocean = null;
    this.alpineLake = null;
    this.breathOrb = null;
    this.breathHalo = null;
    this.zenMat = null;

    this.envGroups = {};
    this.activeEnv = 'beach';
    this.activeMood = 'day';

    this.#build();
  }

  #build() {
    this.scene.background = new THREE.Color('#c7e9f5');
    this.scene.fog = new THREE.FogExp2('#d8eff7', 0.008);

    this.hemiLight = new THREE.HemisphereLight('#fff7ed', '#7dd3fc', 1.15);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff1d6', 0.85);
    this.sunLight.position.set(14, 22, -24);
    this.scene.add(this.sunLight);

    // Dôme solaire pastel
    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 20, 16),
      new THREE.MeshBasicMaterial({ color: '#fde68a' })
    );
    this.sunDisc.position.set(16, 16, -55);
    this.scene.add(this.sunDisc);

    // Champ d'étoiles (visible en mode starlight)
    const starCount = 220;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.42;
      const r = 85;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = 8 + r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starField = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: '#f8fafc', size: 0.45, transparent: true, opacity: 0.85 })
    );
    this.starField.visible = false;
    this.scene.add(this.starField);

    // Coussin / tapis zen commun au centre
    this.zenMat = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.15, 0.05, 24),
      new THREE.MeshLambertMaterial({ color: '#e2e8f0' })
    );
    this.zenMat.position.set(0, 0.025, 0);
    this.scene.add(this.zenMat);

    // Orbe de cohérence cardiaque (5s inspiration / 5s expiration)
    this.breathOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 24, 18),
      new THREE.MeshBasicMaterial({ color: '#5eead4', transparent: true, opacity: 0.88 })
    );
    this.breathOrb.position.set(0, 1.45, -2.5);
    this.scene.add(this.breathOrb);

    this.breathHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.36, 32),
      new THREE.MeshBasicMaterial({
        color: '#99f6e4',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      })
    );
    this.breathHalo.position.copy(this.breathOrb.position);
    this.scene.add(this.breathHalo);

    // Construction des 4 environnements
    this.envGroups.beach = this.#buildBeach();
    this.envGroups.forest = this.#buildForest();
    this.envGroups.meadow = this.#buildMeadow();
    this.envGroups.mountain = this.#buildMountain();

    for (const [key, grp] of Object.entries(this.envGroups)) {
      grp.visible = key === this.activeEnv;
      this.scene.add(grp);
    }
  }

  #buildBeach() {
    const g = new THREE.Group();

    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(5.5, 7.0, 0.4, 32),
      new THREE.MeshLambertMaterial({ color: '#f3e1b8' })
    );
    island.position.y = -0.2;
    g.add(island);

    const oceanGeo = new THREE.CircleGeometry(120, 48);
    oceanGeo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(
      oceanGeo,
      new THREE.MeshLambertMaterial({ color: '#38bdf8' })
    );
    this.ocean.position.y = -0.18;
    g.add(this.ocean);

    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.45, 0),
      new THREE.MeshLambertMaterial({ color: '#cbd5e1' }),
      8
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.4;
      const dist = 4.6 + (i % 2) * 0.6;
      dummy.position.set(Math.cos(ang) * dist, 0.08, Math.sin(ang) * dist);
      dummy.scale.set(1 + (i % 3) * 0.35, 0.65, 0.9);
      dummy.rotation.y = ang;
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    g.add(rocks);
    return g;
  }

  #buildForest() {
    const g = new THREE.Group();

    // Sol de clairière moussue
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(100, 40),
      new THREE.MeshLambertMaterial({ color: '#3f6212' })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    g.add(ground);

    // Plateforme bois centrale douce
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 4.0, 0.1, 24),
      new THREE.MeshLambertMaterial({ color: '#a16207' })
    );
    deck.position.y = -0.04;
    g.add(deck);

    // Anneau de sapins / arbres apaisants (InstancedMesh)
    const treeCount = 48;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.28, 3.2, 7),
      new THREE.MeshLambertMaterial({ color: '#78350f' }),
      treeCount
    );
    const lowerCones = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.7, 3.8, 8),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      treeCount
    );
    const upperCones = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.25, 3.2, 8),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      treeCount
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const greens = ['#14532d', '#166534', '#15803d', '#1e4620'];

    for (let i = 0; i < treeCount; i++) {
      const ring = i < 18 ? 7.5 : i < 34 ? 13.5 : 21.0;
      const ang = (i / (i < 18 ? 18 : i < 34 ? 16 : 14)) * Math.PI * 2 + (i * 0.27);
      const dist = ring + (i % 3) * 1.4;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const s = 0.85 + (i % 4) * 0.22;

      dummy.position.set(x, 1.6 * s, z);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = ang;
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 3.8 * s, z);
      dummy.updateMatrix();
      lowerCones.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 5.5 * s, z);
      dummy.updateMatrix();
      upperCones.setMatrixAt(i, dummy.matrix);

      color.set(greens[i % greens.length]);
      lowerCones.setColorAt(i, color);
      upperCones.setColorAt(i, color);
    }
    lowerCones.instanceColor.needsUpdate = true;
    upperCones.instanceColor.needsUpdate = true;
    g.add(trunks, lowerCones, upperCones);
    return g;
  }

  #buildMeadow() {
    const g = new THREE.Group();

    // Prairie ouverte lumineuse
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(110, 48),
      new THREE.MeshLambertMaterial({ color: '#65a30d' })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    g.add(ground);

    // Collines douces à l'horizon
    const hills = new THREE.InstancedMesh(
      new THREE.SphereGeometry(14, 16, 10),
      new THREE.MeshLambertMaterial({ color: '#84cc16' }),
      10
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const dist = 56 + (i % 2) * 10;
      dummy.position.set(Math.cos(ang) * dist, -6.5, Math.sin(ang) * dist);
      dummy.scale.set(2.2, 0.75 + (i % 3) * 0.2, 1.6);
      dummy.rotation.y = ang;
      dummy.updateMatrix();
      hills.setMatrixAt(i, dummy.matrix);
    }
    g.add(hills);

    // Fleurs sauvages multicolores (1 InstancedMesh)
    const flowerCount = 160;
    const flowers = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      flowerCount
    );
    const palette = ['#fef08a', '#f9a8d4', '#ddd6fe', '#ffffff', '#fde047'];
    const color = new THREE.Color();
    for (let i = 0; i < flowerCount; i++) {
      const ang = i * 2.39996; // spirale d'or
      const dist = 2.6 + Math.sqrt(i) * 1.9;
      dummy.position.set(Math.cos(ang) * dist, 0.12, Math.sin(ang) * dist);
      const s = 0.75 + (i % 3) * 0.3;
      dummy.scale.set(s, s, s);
      dummy.rotation.y = ang;
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      color.set(palette[i % palette.length]);
      flowers.setColorAt(i, color);
    }
    flowers.instanceColor.needsUpdate = true;
    g.add(flowers);

    return g;
  }

  #buildMountain() {
    const g = new THREE.Group();

    // Ponton / rive herbeuse
    const bank = new THREE.Mesh(
      new THREE.CylinderGeometry(5.0, 6.2, 0.35, 28),
      new THREE.MeshLambertMaterial({ color: '#4d7c0f' })
    );
    bank.position.y = -0.18;
    g.add(bank);

    // Lac alpin calme
    const lakeGeo = new THREE.CircleGeometry(110, 48);
    lakeGeo.rotateX(-Math.PI / 2);
    this.alpineLake = new THREE.Mesh(
      lakeGeo,
      new THREE.MeshLambertMaterial({ color: '#0284c7' })
    );
    this.alpineLake.position.y = -0.16;
    g.add(this.alpineLake);

    // Sommets alpins en couronne
    const peakCount = 16;
    const peaks = new THREE.InstancedMesh(
      new THREE.ConeGeometry(14, 28, 6),
      new THREE.MeshLambertMaterial({ color: '#64748b' }),
      peakCount
    );
    const caps = new THREE.InstancedMesh(
      new THREE.ConeGeometry(5.5, 11, 6),
      new THREE.MeshLambertMaterial({ color: '#f1f5f9' }),
      peakCount
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < peakCount; i++) {
      const ang = (i / peakCount) * Math.PI * 2;
      const dist = 62 + (i % 3) * 8;
      const s = 0.85 + (i % 4) * 0.25;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;

      dummy.position.set(x, 12 * s, z);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = ang;
      dummy.updateMatrix();
      peaks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, 20.6 * s, z);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    }
    g.add(peaks, caps);
    return g;
  }

  #applyEnvironmentAndMood() {
    const env = this.targets.environment || 'beach';
    if (env !== this.activeEnv) {
      this.activeEnv = env;
      for (const [k, grp] of Object.entries(this.envGroups)) {
        grp.visible = k === env;
      }
      this.soundEngine?.setSafeSpaceEnvironment(env);
    }

    const mood = this.targets.lighting_mood || 'day';
    this.activeMood = mood;
    if (mood === 'sunset') {
      this.scene.background.set('#fdba74');
      this.scene.fog.color.set('#fed7aa');
      this.scene.fog.density = 0.009;
      this.hemiLight.color.set('#ffedd5');
      this.hemiLight.groundColor.set('#7c2d12');
      this.hemiLight.intensity = 1.0;
      this.sunLight.color.set('#fb923c');
      this.sunLight.intensity = 1.1;
      this.sunDisc.material.color.set('#fb923c');
      this.sunDisc.position.set(14, 6, -55);
      this.sunDisc.visible = true;
      this.starField.visible = false;
    } else if (mood === 'starlight') {
      this.scene.background.set('#1e1b4b');
      this.scene.fog.color.set('#1e1b4b');
      this.scene.fog.density = 0.011;
      this.hemiLight.color.set('#93c5fd');
      this.hemiLight.groundColor.set('#0f172a');
      this.hemiLight.intensity = 0.65;
      this.sunLight.color.set('#c7d2fe');
      this.sunLight.intensity = 0.45;
      this.sunDisc.material.color.set('#e2e8f0');
      this.sunDisc.position.set(-18, 24, -55);
      this.sunDisc.visible = true;
      this.starField.visible = true;
    } else {
      const bgColors = {
        beach: '#c7e9f5',
        forest: '#bbf7d0',
        meadow: '#dbeafe',
        mountain: '#bae6fd',
      };
      const fogColors = {
        beach: '#d8eff7',
        forest: '#dcfce7',
        meadow: '#e0f2fe',
        mountain: '#e0f2fe',
      };
      this.scene.background.set(bgColors[env] || '#c7e9f5');
      this.scene.fog.color.set(fogColors[env] || '#d8eff7');
      this.scene.fog.density = env === 'forest' ? 0.014 : 0.008;
      this.hemiLight.color.set('#fff7ed');
      this.hemiLight.groundColor.set('#7dd3fc');
      this.hemiLight.intensity = 1.15;
      this.sunLight.color.set('#fff1d6');
      this.sunLight.intensity = 0.85;
      this.sunDisc.material.color.set('#fde68a');
      this.sunDisc.position.set(16, 16, -55);
      this.sunDisc.visible = true;
      this.starField.visible = false;
    }

    const showOrb = this.targets.breathing_guide !== false;
    this.breathOrb.visible = showOrb;
    this.breathHalo.visible = showOrb;
  }

  getNavBounds() {
    return { minX: -3.2, maxX: 3.2, minZ: -3.2, maxZ: 3.2, y: 0 };
  }

  onEnter(initialParams = {}) {
    super.onEnter({
      environment: 'beach',
      lighting_mood: 'day',
      breathing_guide: true,
      ...initialParams,
    });
    this.#applyEnvironmentAndMood();
    this.soundEngine?.setSafeSpaceAudio(true, this.targets.environment || 'beach');
  }

  onExit() {
    this.soundEngine?.setSafeSpaceAudio(false);
  }

  update(dt, xrCamera) {
    super.update(dt, xrCamera);
    this.#applyEnvironmentAndMood();

    if (this.breathOrb.visible) {
      // Cycle respiratoire de 10 secondes (5s inspire, 5s expire)
      const breathPhase = (Math.sin((this.elapsed * Math.PI * 2) / 10) + 1) * 0.5;
      const scale = 0.68 + breathPhase * 0.62;
      this.breathOrb.scale.setScalar(scale);
      this.breathOrb.position.y = 1.42 + breathPhase * 0.14;

      this.breathHalo.scale.setScalar(scale * 1.15);
      this.breathHalo.position.y = this.breathOrb.position.y;
      if (xrCamera) {
        this.breathHalo.lookAt(xrCamera.position);
      }
    }

    // Respiration très douce du niveau marin / lac
    if (this.ocean && this.envGroups.beach.visible) {
      this.ocean.position.y = -0.18 + Math.sin(this.elapsed * 0.8) * 0.035;
    }
    if (this.alpineLake && this.envGroups.mountain.visible) {
      this.alpineLake.position.y = -0.16 + Math.sin(this.elapsed * 0.6) * 0.02;
    }
  }
}
