import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

/**
 * Scène Claustrophobie — Ascenseur.
 * Paramètres : cabin_size, light_level, crowd_count, door_state, incident_flicker, incident_stop.
 */
export class ElevatorScene extends BaseScene {
  constructor(renderer, soundEngine) {
    super(renderer, soundEngine);
    this.cabinGroup = new THREE.Group();
    this.leftWall = null;
    this.rightWall = null;
    this.backWall = null;
    this.ceiling = null;
    this.neonStrip = null;
    this.leftDoor = null;
    this.rightDoor = null;
    this.cabinLight = null;
    this.ambientLight = null;
    this.avatars = [];
    this.hallwayGroup = null;

    this.curCabinSize = 1.2;
    this.curLightLevel = 1.0;
    this.curDoorOpen = 1.0;
    this.stopShakeTimer = 0;
    this.prevIncidentStop = false;

    this.#build();
  }

  #build() {
    this.scene.background = new THREE.Color('#0f172a');

    this.ambientLight = new THREE.AmbientLight('#cbd5e1', 0.45);
    this.scene.add(this.ambientLight);

    this.cabinLight = new THREE.PointLight('#f8fafc', 2.4, 8);
    this.cabinLight.position.set(0, 2.35, 0);
    this.scene.add(this.cabinLight);

    this.scene.add(this.cabinGroup);

    const wallMat = new THREE.MeshStandardMaterial({
      color: '#64748b',
      roughness: 0.45,
      metalness: 0.35,
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.7,
      metalness: 0.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.25,
      metalness: 0.75,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.3,
      metalness: 0.65,
    });

    // Sol de base (dimensionné dynamiquement)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.4), floorMat);
    floor.position.y = -0.05;
    this.cabinGroup.add(floor);
    this.floorMesh = floor;

    // Plafond & néon
    this.ceiling = new THREE.Group();
    const ceilingSlab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 2.4), wallMat);
    ceilingSlab.position.y = 0.05;
    this.ceiling.add(ceilingSlab);

    const neonMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
    this.neonStrip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.28), neonMat);
    this.neonStrip.position.y = -0.02;
    this.ceiling.add(this.neonStrip);
    this.ceiling.position.y = 2.55;
    this.cabinGroup.add(this.ceiling);

    // Murs gauche, droit, arrière
    const sideWallGeo = new THREE.BoxGeometry(0.1, 2.6, 2.4);
    this.leftWall = new THREE.Mesh(sideWallGeo, wallMat);
    this.leftWall.position.set(-1.1, 1.3, 0);
    this.cabinGroup.add(this.leftWall);

    this.rightWall = new THREE.Mesh(sideWallGeo, wallMat);
    this.rightWall.position.set(1.1, 1.3, 0);
    this.cabinGroup.add(this.rightWall);

    // Main courante sur mur arrière
    this.backWall = new THREE.Group();
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 0.1), wallMat);
    backPanel.position.y = 1.3;
    this.backWall.add(backPanel);
    const handrail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 12), trimMat);
    handrail.rotation.z = Math.PI / 2;
    handrail.position.set(0, 0.95, -0.09);
    this.backWall.add(handrail);
    this.backWall.position.z = 1.1;
    this.cabinGroup.add(this.backWall);

    // Façade avant avec encadrement et 2 portes coulissantes (en Z négatif devant le patient)
    this.frontFrame = new THREE.Group();
    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.12), trimMat);
    leftPillar.position.set(-0.98, 1.3, 0);
    const rightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.12), trimMat);
    rightPillar.position.set(0.98, 1.3, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.12), trimMat);
    lintel.position.set(0, 2.4, 0);
    this.frontFrame.add(leftPillar, rightPillar, lintel);

    // Panneau de boutons à droite
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.04), new THREE.MeshBasicMaterial({ color: '#1e293b' }));
    panel.position.set(0.84, 1.22, 0.08);
    this.frontFrame.add(panel);
    for (let b = 0; b < 5; b++) {
      const btn = new THREE.Mesh(
        new THREE.CircleGeometry(0.018, 12),
        new THREE.MeshBasicMaterial({ color: b === 2 ? '#fbbf24' : '#94a3b8' })
      );
      btn.position.set(0.84, 1.05 + b * 0.08, 0.105);
      this.frontFrame.add(btn);
    }

    const doorGeo = new THREE.BoxGeometry(0.82, 2.2, 0.06);
    this.leftDoor = new THREE.Mesh(doorGeo, doorMat);
    this.leftDoor.position.set(-0.41, 1.1, 0);
    this.rightDoor = new THREE.Mesh(doorGeo, doorMat);
    this.rightDoor.position.set(0.41, 1.1, 0);
    this.frontFrame.add(this.leftDoor, this.rightDoor);

    this.frontFrame.position.z = -1.1;
    this.cabinGroup.add(this.frontFrame);

    // Hall extérieur visible quand la porte s'ouvre
    this.hallwayGroup = new THREE.Group();
    const hallFloor = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.1, 4), new THREE.MeshLambertMaterial({ color: '#475569' }));
    hallFloor.position.set(0, -0.05, -3.2);
    const hallBack = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3.0, 0.1), new THREE.MeshLambertMaterial({ color: '#e2e8f0' }));
    hallBack.position.set(0, 1.5, -5.0);
    const hallLight = new THREE.PointLight('#fef3c7', 1.2, 7);
    hallLight.position.set(0, 2.4, -3.2);
    this.hallwayGroup.add(hallFloor, hallBack, hallLight);
    this.scene.add(this.hallwayGroup);

    // Pool de 6 avatars low-poly
    const avatarPositions = [
      [-0.58, -0.42, 0.2],
      [0.58, -0.42, -0.2],
      [-0.56, 0.48, 2.7],
      [0.56, 0.48, 3.4],
      [0.0, 0.62, 3.1],
      [-0.3, -0.6, 0.6],
    ];
    const jacketColors = ['#1e40af', '#475569', '#0f766e', '#7c2d12', '#312e81', '#3f6212'];
    for (let i = 0; i < 6; i++) {
      const av = this.#createAvatar(jacketColors[i]);
      const [ax, az, rot] = avatarPositions[i];
      av.position.set(ax, 0, az);
      av.rotation.y = rot;
      av.visible = false;
      this.cabinGroup.add(av);
      this.avatars.push(av);
    }
  }

  #createAvatar(coatColor) {
    const group = new THREE.Group();
    const torsoMat = new THREE.MeshLambertMaterial({ color: coatColor });
    const headMat = new THREE.MeshLambertMaterial({ color: '#e2b89b' });
    const legMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.13, 0.85, 10), legMat);
    legs.position.y = 0.425;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 0.65, 12), torsoMat);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), headMat);
    head.position.y = 1.62;

    group.add(legs, torso, head);
    return group;
  }

  getNavBounds() {
    const half = Math.max(0.35, this.curCabinSize * 0.72);
    return { minX: -half, maxX: half, minZ: -half, maxZ: half, y: 0 };
  }

  onEnter(initialParams = {}) {
    super.onEnter({
      cabin_size: 1.2,
      light_level: 1.0,
      crowd_count: 0,
      door_state: 'open',
      incident_flicker: false,
      incident_stop: false,
      ...initialParams,
    });
    this.curCabinSize = Number(this.targets.cabin_size ?? 1.2);
    this.curLightLevel = Number(this.targets.light_level ?? 1.0);
    this.prevIncidentStop = Boolean(this.targets.incident_stop);
    this.soundEngine?.startElevatorHum();
  }

  onExit() {
    this.soundEngine?.stopElevatorHum();
    this.soundEngine?.playNeonBuzz(false);
  }

  update(dt, xrCamera) {
    super.update(dt, xrCamera);

    // 1. Taille cabine interpolée
    const targetSize = Number(this.targets.cabin_size ?? 1.2);
    this.curCabinSize = this.lerp(this.curCabinSize, targetSize, 2.5, dt);
    const halfSpan = this.curCabinSize * 0.92;
    this.leftWall.position.x = -halfSpan;
    this.rightWall.position.x = halfSpan;
    this.backWall.position.z = halfSpan;
    this.frontFrame.position.z = -halfSpan;
    this.ceiling.position.y = 2.0 + this.curCabinSize * 0.45;
    this.floorMesh.scale.set(this.curCabinSize, 1, this.curCabinSize);
    this.ceiling.scale.set(this.curCabinSize, 1, this.curCabinSize);

    // 2. Portes
    const doorState = this.targets.door_state || 'open';
    const targetDoorOpen = doorState === 'open' ? 1.0 : doorState === 'stuck' ? 0.14 : 0.0;
    this.curDoorOpen = this.lerp(this.curDoorOpen, targetDoorOpen, 3.0, dt);
    const stuckJitter = doorState === 'stuck' ? Math.sin(this.elapsed * 42) * 0.008 : 0;
    const offset = 0.41 + this.curDoorOpen * 0.56 + stuckJitter;
    this.leftDoor.position.x = -offset;
    this.rightDoor.position.x = offset;

    // 3. Luminosité & Clignotement néon
    const targetLight = Number(this.targets.light_level ?? 1.0);
    this.curLightLevel = this.lerp(this.curLightLevel, targetLight, 4.0, dt);
    const flicker = Boolean(this.targets.incident_flicker);
    this.soundEngine?.playNeonBuzz(flicker);

    let effectiveLight = this.curLightLevel;
    if (flicker) {
      const wave = Math.sin(this.elapsed * 37) * Math.sin(this.elapsed * 19);
      effectiveLight *= wave > -0.2 ? 0.95 : 0.12;
    }
    this.cabinLight.intensity = 0.15 + effectiveLight * 2.5;
    this.ambientLight.intensity = 0.1 + effectiveLight * 0.45;
    const neonTone = Math.max(0.08, effectiveLight);
    this.neonStrip.material.color.setRGB(neonTone, neonTone, neonTone * 0.98);

    // 4. Foule (crowd_count 0..6)
    const count = Math.round(Number(this.targets.crowd_count ?? 0));
    for (let i = 0; i < this.avatars.length; i++) {
      const av = this.avatars[i];
      av.visible = i < count;
      if (av.visible) {
        // Ajuster pour rester dans la cabine si elle rétrécit
        const maxPos = Math.max(0.32, halfSpan - 0.25);
        av.position.x = THREE.MathUtils.clamp(av.position.x, -maxPos, maxPos);
        av.position.z = THREE.MathUtils.clamp(av.position.z, -maxPos + 0.15, maxPos);
        av.position.y = Math.sin(this.elapsed * 2 + i) * 0.006;
      }
    }

    // 5. Incident arrêt mécanique
    const stopActive = Boolean(this.targets.incident_stop);
    if (stopActive && !this.prevIncidentStop) {
      this.stopShakeTimer = 0.65;
      this.soundEngine?.playMechanicalStop();
    }
    this.prevIncidentStop = stopActive;

    if (this.stopShakeTimer > 0) {
      this.stopShakeTimer = Math.max(0, this.stopShakeTimer - dt);
      this.cabinGroup.position.y = Math.sin(this.elapsed * 55) * 0.025 * this.stopShakeTimer;
    } else {
      this.cabinGroup.position.y = stopActive ? 0 : Math.sin(this.elapsed * 6) * 0.002;
    }

    this.soundEngine?.setElevatorHumLevel(stopActive ? 0.0 : 0.05);
  }
}
