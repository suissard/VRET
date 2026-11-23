import * as THREE from 'three';
import { BaseScene } from './BaseScene.js';

/**
 * Scène Acrophobie — Immeuble avec refuge intérieur, terrasse / planche modulable et environnement urbain à l'échelle.
 * Paramètres :
 * - height_floor (1..40)
 * - railing_opacity (0..1)
 * - floor_opacity (0..1)
 * - platform_width (0.4..6.0 m) — permet le mode planche
 * - platform_length (1.5..10.0 m)
 * - wind_intensity (0..1)
 * - weather (clear|fog|night)
 */
export class AcrophobiaScene extends BaseScene {
  constructor(renderer, soundEngine) {
    super(renderer, soundEngine);
    this.platformGroup = new THREE.Group();
    this.floorMesh = null;
    this.floorMat = null;
    this.leftBeam = null;
    this.rightBeam = null;
    this.frontBeam = null;
    this.railFront = null;
    this.railLeft = null;
    this.railRight = null;
    this.railingMat = null;
    this.windParticles = null;
    this.hemiLight = null;
    this.sunLight = null;
    this.interiorLight = null;

    this.curFloor = 2;
    this.curRailingOpacity = 1.0;
    this.curFloorOpacity = 1.0;
    this.curWidth = 4.2;
    this.curLength = 5.0;
    this.curWind = 0.1;
    this.prevY = 6;
    this.verticalSpeed = 0;

    this.solidFloorColor = new THREE.Color('#64748b');
    this.glassFloorColor = new THREE.Color('#bae6fd');

    this.#build();
  }

  #createBuildingWindowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, 128, 256);

    // Rangées de fenêtres régulières (donnent une lecture immédiate des étages)
    const cols = 4;
    const rows = 10;
    const padX = 6;
    const padY = 5;
    const cellW = 128 / cols;
    const cellH = 256 / rows;

    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, r * cellH, 128, 2);
      for (let c = 0; c < cols; c++) {
        const lit = ((r * 7 + c * 13) % 5) === 0;
        ctx.fillStyle = lit ? '#fef08a' : '#334155';
        ctx.fillRect(
          c * cellW + padX,
          r * cellH + padY,
          cellW - padX * 2,
          cellH - padY * 2
        );
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  #build() {
    this.scene.background = new THREE.Color('#87ceeb');
    this.scene.fog = new THREE.FogExp2('#b6dff2', 0.0032);

    this.hemiLight = new THREE.HemisphereLight('#ffffff', '#475569', 0.95);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff7ed', 0.9);
    this.sunLight.position.set(45, 130, 35);
    this.scene.add(this.sunLight);

    // 1. Sol urbain général (niveau 0)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(460, 460),
      new THREE.MeshLambertMaterial({ color: '#475569' })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // 2. Parc urbain au pied de l'immeuble pour repère d'échelle immédiat
    const parkGrass = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 44),
      new THREE.MeshLambertMaterial({ color: '#4d7c0f' })
    );
    parkGrass.rotation.x = -Math.PI / 2;
    parkGrass.position.set(0, 0.012, -26);
    this.scene.add(parkGrass);

    const plazaMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1' });
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), plazaMat);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(0, 0.018, -3);
    this.scene.add(plaza);

    // 3. Réseau routier (avenues en grille entre les îlots de 24 m)
    const roadMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });
    const roadPositions = [-108, -84, -60, -36, -12, 12, 36, 60, 84, 108];
    const roadCount = roadPositions.length * 2;
    const roadInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), roadMat, roadCount);
    const dummy = new THREE.Object3D();
    let rIdx = 0;

    for (const pos of roadPositions) {
      // Axe Nord-Sud (longueur 320 m, largeur 7.2 m)
      dummy.position.set(pos, 0.015, 0);
      dummy.scale.set(7.2, 1, 320);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      roadInst.setMatrixAt(rIdx++, dummy.matrix);

      // Axe Est-Ouest
      dummy.position.set(0, 0.016, pos);
      dummy.scale.set(320, 1, 7.2);
      dummy.updateMatrix();
      roadInst.setMatrixAt(rIdx++, dummy.matrix);
    }
    roadInst.instanceMatrix.needsUpdate = true;
    this.scene.add(roadInst);

    // Marquages routiers blancs (pointillés centraux + passages piétons) en 1 seul InstancedMesh
    const stripeMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
    const stripePositions = [];
    for (const rPos of [-36, -12, 12, 36]) {
      for (let d = -120; d <= 120; d += 7) {
        if (Math.abs(d % 24) === 12) continue; // éviter le milieu des carrefours
        stripePositions.push({ x: rPos, z: d, sx: 0.22, sz: 2.6 });
        stripePositions.push({ x: d, z: rPos, sx: 2.6, sz: 0.22 });
      }
    }
    // Passages piétons autour du carrefour central devant l'immeuble
    for (const cx of [-12, 12]) {
      for (const cz of [-12, 12, -36]) {
        for (let k = -2.4; k <= 2.4; k += 0.8) {
          stripePositions.push({ x: cx + k, z: cz - 4.4, sx: 0.35, sz: 1.6 });
          stripePositions.push({ x: cx - 4.4, z: cz + k, sx: 1.6, sz: 0.35 });
        }
      }
    }
    const stripesInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 0.01, 1),
      stripeMat,
      stripePositions.length
    );
    stripePositions.forEach((s, i) => {
      dummy.position.set(s.x, 0.028, s.z);
      dummy.scale.set(s.sx, 1, s.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      stripesInst.setMatrixAt(i, dummy.matrix);
    });
    stripesInst.instanceMatrix.needsUpdate = true;
    this.scene.add(stripesInst);

    // Voitures stylisées sur les routes (repères métriques ~4.2 m)
    const carColors = ['#ef4444', '#3b82f6', '#f59e0b', '#e2e8f0', '#10b981', '#6366f1'];
    const carMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const carsData = [];
    for (let i = 0; i < 36; i++) {
      const alongNS = i % 2 === 0;
      const lane = [-36, -12, 12, 36][i % 4] + (i % 3 === 0 ? 1.8 : -1.8);
      const dist = -82 + ((i * 19) % 164);
      carsData.push({
        x: alongNS ? lane : dist,
        z: alongNS ? dist : lane,
        ry: alongNS ? 0 : Math.PI / 2,
        color: carColors[i % carColors.length],
      });
    }
    const carsInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1.75, 1.35, 4.1), carMat, carsData.length);
    const tmpColor = new THREE.Color();
    carsData.forEach((c, i) => {
      dummy.position.set(c.x, 0.7, c.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, c.ry, 0);
      dummy.updateMatrix();
      carsInst.setMatrixAt(i, dummy.matrix);
      tmpColor.set(c.color);
      carsInst.setColorAt(i, tmpColor);
    });
    carsInst.instanceMatrix.needsUpdate = true;
    if (carsInst.instanceColor) carsInst.instanceColor.needsUpdate = true;
    this.scene.add(carsInst);

    // 4. Arbres urbains & parc (2 InstancedMesh : troncs + houppiers)
    const treeCoords = [];
    // Alignement d'arbres le long des boulevards visibles depuis la terrasse
    for (let d = -68; d <= 52; d += 10) {
      if (Math.abs(d + 12) < 5 || Math.abs(d - 12) < 5 || Math.abs(d + 36) < 5) continue;
      treeCoords.push({ x: -7.2, z: d, s: 0.9 + ((Math.abs(d) % 3) * 0.15) });
      treeCoords.push({ x: 7.2, z: d, s: 0.95 + ((Math.abs(d) % 4) * 0.12) });
      treeCoords.push({ x: -16.8, z: d, s: 1.0 });
      treeCoords.push({ x: 16.8, z: d, s: 1.05 });
    }
    // Bosquets dans le parc central devant l'immeuble
    const parkTrees = [
      [-5, -18], [5, -19], [-3, -24], [4, -27], [-6, -30], [2, -33],
      [-18, -18], [18, -21], [-20, -29], [19, -31], [-4, -44], [5, -45],
      [-28, -6], [28, -8], [-30, -24], [30, -25],
    ];
    for (const [tx, tz] of parkTrees) {
      treeCoords.push({ x: tx, z: tz, s: 1.05 + ((Math.abs(tx + tz) % 4) * 0.14) });
    }

    const trunkInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.28, 2.4, 7),
      new THREE.MeshLambertMaterial({ color: '#78350f' }),
      treeCoords.length
    );
    const crownInst = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.65, 1),
      new THREE.MeshLambertMaterial({ color: '#ffffff' }),
      treeCoords.length
    );
    const foliagePalette = ['#15803d', '#166534', '#22c55e', '#4d7c0f'];

    treeCoords.forEach((t, i) => {
      dummy.position.set(t.x, 1.2 * t.s, t.z);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.rotation.set(0, i * 0.7, 0);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(t.x, 3.4 * t.s, t.z);
      dummy.scale.set(t.s * 1.1, t.s * 1.25, t.s * 1.1);
      dummy.updateMatrix();
      crownInst.setMatrixAt(i, dummy.matrix);

      tmpColor.set(foliagePalette[i % foliagePalette.length]);
      crownInst.setColorAt(i, tmpColor);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    if (crownInst.instanceColor) crownInst.instanceColor.needsUpdate = true;
    this.scene.add(trunkInst, crownInst);

    // Lampadaires le long de l'avenue principale (hauteur 5 m)
    const poleCoords = [];
    for (let z = -54; z <= 30; z += 14) {
      if (Math.abs(z + 12) < 4 || Math.abs(z - 12) < 4) continue;
      poleCoords.push([-8.2, z], [8.2, z]);
    }
    const poleInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.1, 4.8, 6),
      new THREE.MeshLambertMaterial({ color: '#334155' }),
      poleCoords.length
    );
    const lampHeadInst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.45, 0.14, 0.25),
      new THREE.MeshBasicMaterial({ color: '#fef08a' }),
      poleCoords.length
    );
    poleCoords.forEach(([px, pz], i) => {
      dummy.position.set(px, 2.4, pz);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(px + (px < 0 ? 0.2 : -0.2), 4.85, pz);
      dummy.updateMatrix();
      lampHeadInst.setMatrixAt(i, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    lampHeadInst.instanceMatrix.needsUpdate = true;
    this.scene.add(poleInst, lampHeadInst);

    // 5. Ville procédurale texturée avec fenêtres sur les façades et toit uniforme (sans fenêtres)
    const windowTex = this.#createBuildingWindowTexture();
    const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
    const buildingSideMat = new THREE.MeshLambertMaterial({ color: '#cbd5e1', map: windowTex });
    const buildingRoofMat = new THREE.MeshLambertMaterial({ color: '#94a3b8' });
    const buildingMats = [
      buildingSideMat,
      buildingSideMat,
      buildingRoofMat,
      buildingRoofMat,
      buildingSideMat,
      buildingSideMat,
    ];
    const maxBuildings = 150;
    const buildings = new THREE.InstancedMesh(buildingGeo, buildingMats, maxBuildings);

    let idx = 0;
    for (let gx = -5; gx <= 5 && idx < maxBuildings; gx++) {
      for (let gz = -5; gz <= 5 && idx < maxBuildings; gz++) {
        // Dégager l'îlot de la tour du patient et le parc juste devant (gx=0, gz=-1..0)
        if (gx === 0 && (gz === 0 || gz === -1)) continue;
        const w = 10 + ((Math.abs(gx * 7 + gz * 13)) % 6);
        const d = 10 + ((Math.abs(gx * 11 + gz * 5)) % 6);
        const h = 15 + ((Math.abs(gx * 17 + gz * 23)) % 85);
        dummy.position.set(gx * 24, h * 0.5, gz * 24);
        dummy.scale.set(w, h, d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        buildings.setMatrixAt(idx, dummy.matrix);
        const shade = 0.65 + ((idx % 4) * 0.08);
        tmpColor.setRGB(shade, shade + 0.02, shade + 0.06);
        buildings.setColorAt(idx, tmpColor);
        idx++;
      }
    }
    buildings.count = idx;
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    this.scene.add(buildings);

    // 6. Tour support derrière le refuge intérieur (z = 5.4 .. 10.2, de y=0 à y=136)
    const coreSideMat = new THREE.MeshLambertMaterial({ color: '#64748b', map: windowTex });
    const coreRoofMat = new THREE.MeshLambertMaterial({ color: '#475569' });
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(5.0, 136, 4.8),
      [coreSideMat, coreSideMat, coreRoofMat, coreRoofMat, coreSideMat, coreSideMat]
    );
    core.position.set(0, 68, 7.8);
    this.scene.add(core);

    // 7. Plateforme mobile (Refuge intérieur + Terrasse/Planche extérieure)
    this.#buildInteriorRefuge();
    this.#buildExteriorPlatform();

    // Particules de vent attachées à la plateforme
    const partCount = 120;
    const positions = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 16;
      positions[i * 3 + 1] = Math.random() * 5 - 1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const partGeo = new THREE.BufferGeometry();
    partGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const partMat = new THREE.PointsMaterial({ color: '#f8fafc', size: 0.08, transparent: true, opacity: 0.4 });
    this.windParticles = new THREE.Points(partGeo, partMat);
    this.platformGroup.add(this.windParticles);

    this.scene.add(this.platformGroup);
  }

  #buildInteriorRefuge() {
    const interior = new THREE.Group();

    const woodFloorMat = new THREE.MeshStandardMaterial({ color: '#8b6946', roughness: 0.72 });
    const innerWallMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.85 });
    const outerWallMat = new THREE.MeshLambertMaterial({ color: '#475569' });
    const trimMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });

    // Sol intérieur toujours opaque et rassurant (z = 1.2 à 5.4, largeur 4.6 m)
    const roomFloor = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.16, 4.2), woodFloorMat);
    roomFloor.position.set(0, -0.08, 3.3);
    interior.add(roomFloor);

    // Tapis d'accueil chaleureux devant la sortie
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.02, 1.8),
      new THREE.MeshLambertMaterial({ color: '#94a3b8' })
    );
    rug.position.set(0, 0.01, 2.7);
    interior.add(rug);

    // Plafond & panneau lumineux rassurant
    const ceiling = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.18, 4.4), innerWallMat);
    ceiling.position.set(0, 2.95, 3.3);
    interior.add(ceiling);

    const lightPanel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ color: '#fef3c7' })
    );
    lightPanel.rotation.x = Math.PI / 2;
    lightPanel.position.set(0, 2.85, 3.3);
    interior.add(lightPanel);

    this.interiorLight = new THREE.PointLight('#fffbeb', 1.15, 9);
    this.interiorLight.position.set(0, 2.55, 3.3);
    interior.add(this.interiorLight);

    // Murs gauche, droit, fond (double peau intérieure / extérieure)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.9, 0.18), innerWallMat);
    backWall.position.set(0, 1.45, 5.35);
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.9, 4.2), innerWallMat);
    leftWall.position.set(-2.3, 1.45, 3.3);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.9, 4.2), innerWallMat);
    rightWall.position.set(2.3, 1.45, 3.3);
    interior.add(backWall, leftWall, rightWall);

    // Enveloppe extérieure du module refuge
    const leftClad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.1, 4.3), outerWallMat);
    leftClad.position.set(-2.42, 1.45, 3.3);
    const rightClad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.1, 4.3), outerWallMat);
    rightClad.position.set(2.42, 1.45, 3.3);
    interior.add(leftClad, rightClad);

    // Façade avant à z = 1.2 avec large porte d'accès (ouverture x = -1.2 .. +1.2, hauteur 2.35 m)
    const frontLeftWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.9, 0.18), innerWallMat);
    frontLeftWall.position.set(-1.825, 1.45, 1.2);
    const frontRightWall = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.9, 0.18), innerWallMat);
    frontRightWall.position.set(1.825, 1.45, 1.2);
    const frontLintel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.55, 0.18), innerWallMat);
    frontLintel.position.set(0, 2.625, 1.2);
    interior.add(frontLeftWall, frontRightWall, frontLintel);

    // Encadrement de porte sombre pour bien délimiter le seuil intérieur/extérieur
    const doorFrameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.35, 0.24), trimMat);
    doorFrameLeft.position.set(-1.2, 1.175, 1.2);
    const doorFrameRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.35, 0.24), trimMat);
    doorFrameRight.position.set(1.2, 1.175, 1.2);
    const doorFrameTop = new THREE.Mesh(new THREE.BoxGeometry(2.48, 0.08, 0.24), trimMat);
    doorFrameTop.position.set(0, 2.35, 1.2);
    interior.add(doorFrameLeft, doorFrameRight, doorFrameTop);

    // Portes d'ascenseur décoratives sur le mur du fond (repère d'évacuation sécurisant)
    const elevMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.5, roughness: 0.35 });
    const elevDoors = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.15, 0.06), elevMat);
    elevDoors.position.set(0, 1.075, 5.24);
    const elevSeam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.15, 0.08), trimMat);
    elevSeam.position.set(0, 1.075, 5.24);
    interior.add(elevDoors, elevSeam);

    // Banc / banquette confortable à gauche pour s'asseoir/se reposer
    const sofaMat = new THREE.MeshLambertMaterial({ color: '#0369a1' });
    const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 1.7), sofaMat);
    sofaSeat.position.set(-1.75, 0.21, 3.5);
    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 1.7), sofaMat);
    sofaBack.position.set(-2.05, 0.65, 3.5);
    interior.add(sofaSeat, sofaBack);

    // Plante verte décorative à droite
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.18, 0.42, 10),
      new THREE.MeshLambertMaterial({ color: '#b45309' })
    );
    pot.position.set(1.75, 0.21, 4.5);
    const plant = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.36, 0),
      new THREE.MeshLambertMaterial({ color: '#16a34a' })
    );
    plant.position.set(1.75, 0.68, 4.5);
    interior.add(pot, plant);

    this.platformGroup.add(interior);
  }

  #buildExteriorPlatform() {
    // Plancher modulable en opacité (0..1) et en dimensions (width x length)
    this.floorMat = new THREE.MeshPhysicalMaterial({
      color: '#64748b',
      transparent: false,
      opacity: 1.0,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });

    this.floorMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 1), this.floorMat);
    this.platformGroup.add(this.floorMesh);

    // Cadre métallique autour de la plateforme/planche (repère spatial permanent)
    const beamMat = new THREE.MeshLambertMaterial({ color: '#1e293b' });
    this.leftBeam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1), beamMat);
    this.rightBeam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 1), beamMat);
    this.frontBeam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 0.1), beamMat);
    this.platformGroup.add(this.leftBeam, this.rightBeam, this.frontBeam);

    // Garde-corps périphérique à opacité modulable
    this.railingMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      transparent: true,
      opacity: 1.0,
      roughness: 0.3,
    });
    this.railFront = new THREE.Mesh(new THREE.BoxGeometry(1, 1.05, 0.08), this.railingMat);
    this.railLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1), this.railingMat);
    this.railRight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 1), this.railingMat);
    this.platformGroup.add(this.railFront, this.railLeft, this.railRight);

    this.#applyPlatformGeometry(this.curWidth, this.curLength);
  }

  #applyPlatformGeometry(w, l) {
    const centerZ = 1.2 - l * 0.5;
    const frontZ = 1.2 - l;

    this.floorMesh.scale.set(w, 1, l);
    this.floorMesh.position.set(0, -0.07, centerZ);

    this.leftBeam.scale.set(1, 1, l);
    this.leftBeam.position.set(-w * 0.5, -0.07, centerZ);

    this.rightBeam.scale.set(1, 1, l);
    this.rightBeam.position.set(w * 0.5, -0.07, centerZ);

    this.frontBeam.scale.set(w + 0.1, 1, 1);
    this.frontBeam.position.set(0, -0.07, frontZ);

    this.railFront.scale.set(w, 1, 1);
    this.railFront.position.set(0, 0.525, frontZ + 0.04);

    this.railLeft.scale.set(1, 1, l);
    this.railLeft.position.set(-w * 0.5 + 0.04, 0.525, centerZ);

    this.railRight.scale.set(1, 1, l);
    this.railRight.position.set(w * 0.5 - 0.04, 0.525, centerZ);
  }

  getNavBounds() {
    const minZ = 1.2 - this.curLength + 0.25;
    const halfExtW = Math.max(0.12, this.curWidth * 0.5 - 0.14);
    const maxHalfW = Math.max(1.85, halfExtW);
    return { minX: -maxHalfW, maxX: maxHalfW, minZ, maxZ: 4.75, y: this.platformGroup.position.y };
  }

  /**
   * Contraint la position à la forme en T (refuge intérieur large + terrasse/planche extérieure).
   */
  clampPosition(x, z, prevX = x, prevZ = z) {
    const minExtZ = 1.2 - this.curLength + 0.25;
    const clampedZ = THREE.MathUtils.clamp(z, minExtZ, 4.75);
    const extHalfW = Math.max(0.1, this.curWidth * 0.5 - 0.14);
    const intHalfW = 1.85;

    if (clampedZ >= 1.15) {
      // Dans le refuge intérieur de l'immeuble
      return {
        x: THREE.MathUtils.clamp(x, -intHalfW, intHalfW),
        z: clampedZ,
      };
    }

    // Sur la terrasse ou planche extérieure : bloquer le passage au mur de façade si hors largeur de planche
    if (prevZ >= 1.15 && Math.abs(x) > Math.min(1.05, extHalfW)) {
      return {
        x: THREE.MathUtils.clamp(x, -intHalfW, intHalfW),
        z: 1.15,
      };
    }

    return {
      x: THREE.MathUtils.clamp(x, -extHalfW, extHalfW),
      z: clampedZ,
    };
  }

  getMotionIntensity() {
    return Math.min(1, Math.abs(this.verticalSpeed) * 0.25);
  }

  onEnter(initialParams = {}) {
    const normalized = { ...initialParams };
    if (normalized.floor_opacity === undefined && normalized.floor_glass !== undefined) {
      normalized.floor_opacity = normalized.floor_glass ? 0.24 : 1.0;
    }
    super.onEnter({
      height_floor: 2,
      railing_opacity: 1.0,
      floor_opacity: 1.0,
      platform_width: 4.2,
      platform_length: 5.0,
      wind_intensity: 0.1,
      weather: 'clear',
      ...normalized,
    });
    this.curFloor = Number(this.targets.height_floor ?? 2);
    this.curFloorOpacity = Number(this.targets.floor_opacity ?? 1.0);
    this.curWidth = Number(this.targets.platform_width ?? 4.2);
    this.curLength = Number(this.targets.platform_length ?? 5.0);
    this.#applyPlatformGeometry(this.curWidth, this.curLength);
    this.platformGroup.position.y = this.curFloor * 3.0;
    this.prevY = this.platformGroup.position.y;
    this.soundEngine?.startWind();
  }

  onExit() {
    this.soundEngine?.stopWind();
  }

  update(dt, xrCamera, playerRig) {
    super.update(dt, xrCamera, playerRig);

    // 1. Hauteur (3 m par étage)
    const targetFloor = Number(this.targets.height_floor ?? 2);
    this.curFloor = this.lerp(this.curFloor, targetFloor, 1.8, dt);
    const newY = this.curFloor * 3.0;
    this.verticalSpeed = dt > 0 ? (newY - this.prevY) / dt : 0;
    this.prevY = newY;
    this.platformGroup.position.y = newY;

    // 2. Dimensions de la plateforme / mode planche
    const targetW = Number(this.targets.platform_width ?? 4.2);
    const targetL = Number(this.targets.platform_length ?? 5.0);
    this.curWidth = this.lerp(this.curWidth, targetW, 4.0, dt);
    this.curLength = this.lerp(this.curLength, targetL, 4.0, dt);
    this.#applyPlatformGeometry(this.curWidth, this.curLength);

    if (playerRig) {
      playerRig.position.y = newY;
      const safePos = this.clampPosition(playerRig.position.x, playerRig.position.z);
      playerRig.position.x = safePos.x;
      playerRig.position.z = safePos.z;
    }

    // 3. Garde-corps
    const targetRail = Number(this.targets.railing_opacity ?? 1.0);
    this.curRailingOpacity = this.lerp(this.curRailingOpacity, targetRail, 4.0, dt);
    this.railingMat.opacity = this.curRailingOpacity;
    this.railingMat.visible = this.curRailingOpacity > 0.02;

    // 4. Transparence modulable du plancher (0 = invisible, 1 = béton plein)
    const targetFloorOp = Number(
      this.targets.floor_opacity ?? (this.targets.floor_glass ? 0.24 : 1.0)
    );
    this.curFloorOpacity = this.lerp(this.curFloorOpacity, targetFloorOp, 4.5, dt);
    const op = THREE.MathUtils.clamp(this.curFloorOpacity, 0, 1);
    const isTranslucent = op < 0.985;
    this.floorMesh.visible = op > 0.015;
    if (this.floorMat.transparent !== isTranslucent) {
      this.floorMat.transparent = isTranslucent;
      this.floorMat.depthWrite = !isTranslucent;
      this.floorMat.needsUpdate = true;
    }
    this.floorMat.opacity = op;
    this.floorMat.roughness = isTranslucent ? 0.12 : 0.68;
    const glassBlend = isTranslucent ? THREE.MathUtils.clamp((0.985 - op) / 0.35, 0, 1) : 0;
    this.floorMat.color.copy(this.solidFloorColor).lerp(this.glassFloorColor, glassBlend);

    // 5. Vent & particules (atténué si le patient est dans le refuge intérieur)
    const targetWind = Number(this.targets.wind_intensity ?? 0.1);
    this.curWind = this.lerp(this.curWind, targetWind, 3.0, dt);
    const insideRefuge = Boolean(playerRig && playerRig.position.z > 1.2);
    this.soundEngine?.setWindIntensity(insideRefuge ? this.curWind * 0.25 : this.curWind);

    const posAttr = this.windParticles.geometry.getAttribute('position');
    const speed = 1.5 + this.curWind * 14.0;
    for (let i = 0; i < posAttr.count; i++) {
      let x = posAttr.getX(i) + speed * dt;
      if (x > 8) x = -8;
      posAttr.setX(i, x);
    }
    posAttr.needsUpdate = true;
    this.windParticles.material.opacity = 0.1 + this.curWind * 0.65;

    // 6. Météo (clear / fog / night)
    const weather = this.targets.weather || 'clear';
    if (weather === 'night') {
      this.scene.background.set('#0b132b');
      this.scene.fog.color.set('#0f172a');
      this.scene.fog.density = 0.0085;
      this.hemiLight.intensity = 0.35;
      this.sunLight.intensity = 0.25;
    } else if (weather === 'fog') {
      this.scene.background.set('#cbd5e1');
      this.scene.fog.color.set('#cbd5e1');
      this.scene.fog.density = 0.022;
      this.hemiLight.intensity = 0.8;
      this.sunLight.intensity = 0.45;
    } else {
      this.scene.background.set('#87ceeb');
      this.scene.fog.color.set('#b6dff2');
      this.scene.fog.density = 0.0032;
      this.hemiLight.intensity = 0.95;
      this.sunLight.intensity = 0.9;
    }
  }
}
