import * as THREE from 'three';

/**
 * Locomotion confortable :
 * - Téléportation parabolique contrainte aux bornes NavMesh de chaque scène
 * - Vignettage périphérique dynamique anti-cybercinétose
 */
export class Locomotion {
  constructor(playerRig, camera) {
    this.playerRig = playerRig;
    this.camera = camera;

    // Anneau cible au sol
    const markerGeo = new THREE.RingGeometry(0.18, 0.24, 24);
    markerGeo.rotateX(-Math.PI / 2);
    const markerMat = new THREE.MeshBasicMaterial({
      color: '#38bdf8',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.targetMarker = new THREE.Mesh(markerGeo, markerMat);
    this.targetMarker.visible = false;

    // Courbe parabolique de prévisualisation
    const arcGeo = new THREE.BufferGeometry();
    const arcPositions = new Float32Array(20 * 3);
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.8 });
    this.arcLine = new THREE.Line(arcGeo, arcMat);
    this.arcLine.visible = false;

    this.group = new THREE.Group();
    this.group.add(this.targetMarker, this.arcLine);

    // Vignette périphérique attachée à la caméra pour les mouvements verticaux / téléportations
    const vigGeo = new THREE.RingGeometry(0.32, 0.9, 32);
    const vigMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.0,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.vignetteMesh = new THREE.Mesh(vigGeo, vigMat);
    this.vignetteMesh.position.set(0, 0, -0.35);
    this.vignetteMesh.renderOrder = 997;
    if (this.camera) {
      this.camera.add(this.vignetteMesh);
    }

    this.teleportCandidate = null;
    this.tempOrigin = new THREE.Vector3();
    this.tempDir = new THREE.Vector3();
    this.tempMat = new THREE.Matrix4();
  }

  previewFromController(controller, sceneOrBounds) {
    if (!controller || !controller.visible || !sceneOrBounds) {
      this.clearPreview();
      return;
    }

    const navBounds = typeof sceneOrBounds.getNavBounds === 'function'
      ? sceneOrBounds.getNavBounds()
      : sceneOrBounds;
    const clampFn = typeof sceneOrBounds.clampPosition === 'function'
      ? (x, z) => sceneOrBounds.clampPosition(x, z)
      : (x, z) => ({
          x: THREE.MathUtils.clamp(x, navBounds.minX, navBounds.maxX),
          z: THREE.MathUtils.clamp(z, navBounds.minZ, navBounds.maxZ),
        });

    this.tempMat.identity().extractRotation(controller.matrixWorld);
    this.tempOrigin.setFromMatrixPosition(controller.matrixWorld);
    this.tempDir.set(0, 0, -1).applyMatrix4(this.tempMat).normalize();

    const v0 = this.tempDir.clone().multiplyScalar(7.5);
    const g = -9.8;
    const groundY = navBounds.y ?? 0;

    const posAttr = this.arcLine.geometry.getAttribute('position');
    let hitPoint = null;

    for (let i = 0; i < 20; i++) {
      const t = i * 0.08;
      const x = this.tempOrigin.x + v0.x * t;
      const y = this.tempOrigin.y + v0.y * t + 0.5 * g * t * t;
      const z = this.tempOrigin.z + v0.z * t;
      posAttr.setXYZ(i, x, Math.max(groundY, y), z);
      if (!hitPoint && y <= groundY) {
        const clamped = clampFn(x, z);
        hitPoint = new THREE.Vector3(clamped.x, groundY, clamped.z);
      }
    }
    posAttr.needsUpdate = true;

    if (hitPoint) {
      this.teleportCandidate = hitPoint;
      this.targetMarker.position.set(hitPoint.x, hitPoint.y + 0.015, hitPoint.z);
      this.targetMarker.visible = true;
      this.arcLine.visible = true;
    } else {
      this.clearPreview();
    }
  }

  commitTeleport() {
    if (!this.teleportCandidate) return false;
    this.playerRig.position.x = this.teleportCandidate.x;
    this.playerRig.position.z = this.teleportCandidate.z;
    this.clearPreview();
    return true;
  }

  clearPreview() {
    this.teleportCandidate = null;
    this.targetMarker.visible = false;
    this.arcLine.visible = false;
  }

  updateVignette(motionIntensity, dt) {
    const targetOp = THREE.MathUtils.clamp(motionIntensity * 0.65, 0, 0.72);
    const cur = this.vignetteMesh.material.opacity;
    this.vignetteMesh.material.opacity = THREE.MathUtils.lerp(cur, targetOp, 1 - Math.exp(-8 * dt));
    this.vignetteMesh.visible = this.vignetteMesh.material.opacity > 0.01;
  }
}
