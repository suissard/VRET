import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { MSG_TYPES } from '/shared/protocol.js';
import { SCENES_SCHEMA } from '/shared/scenes-schema.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { SafeSpaceScene } from './scenes/SafeSpaceScene.js';
import { ElevatorScene } from './scenes/ElevatorScene.js';
import { AcrophobiaScene } from './scenes/AcrophobiaScene.js';
import { ArachnophobiaScene } from './scenes/ArachnophobiaScene.js';
import { LikertUI } from './core/LikertUI.js';
import { Locomotion } from './core/Locomotion.js';
import { VrNetworkClient } from './network/wsClient.js';

const canvas = document.getElementById('vr-canvas');
const lobbyOverlay = document.getElementById('lobby-overlay');
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const pinInput = document.getElementById('pin-input');
const btnConnect = document.getElementById('btn-connect');
const btnEnterVr = document.getElementById('btn-enter-vr');
const btnEnterSim = document.getElementById('btn-enter-sim');
const lobbySceneEl = document.getElementById('lobby-scene');
const xrSupportLabel = document.getElementById('xr-support-label');

const simHud = document.getElementById('sim-hud');
const simReticle = document.getElementById('sim-reticle');
const hudScenePill = document.getElementById('hud-scene-pill');
const hudSafePill = document.getElementById('hud-safe-pill');
const hudFpsPill = document.getElementById('hud-fps-pill');
const hudModePill = document.getElementById('hud-mode-pill');
const btnToggleGaze = document.getElementById('btn-toggle-gaze');
const btnExitSim = document.getElementById('btn-exit-sim');

// 1. Renderer WebGL + WebXR optimisé Quest/Pico
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.shadowMap.enabled = false; // Budget perf strict : zéro ombre temps réel

const soundEngine = new SoundEngine();

// 2. Rig Joueur & Caméra (pour room-scale, téléportation et simulation)
const playerRig = new THREE.Group();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 450);
camera.position.set(0, 1.65, 0);
playerRig.add(camera);

// Sphère noire attachée à la caméra pour le fondu Safe Space < 500 ms
const fadeSphereGeo = new THREE.SphereGeometry(0.42, 16, 12);
const fadeSphereMat = new THREE.MeshBasicMaterial({
  color: '#000000',
  side: THREE.BackSide,
  transparent: true,
  opacity: 0,
  depthTest: false,
});
const fadeSphere = new THREE.Mesh(fadeSphereGeo, fadeSphereMat);
fadeSphere.renderOrder = 1000;
fadeSphere.visible = false;
camera.add(fadeSphere);

// 3. Manettes WebXR + rayon laser visible
const controllers = [];
const controllerModelFactory = new XRControllerModelFactory();
const laserGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -5),
]);
const laserMat = new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.75 });

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const laser = new THREE.Line(laserGeo, laserMat);
  ctrl.add(laser);
  ctrl.visible = false;
  ctrl.addEventListener('connected', () => {
    ctrl.visible = true;
  });
  ctrl.addEventListener('disconnected', () => {
    ctrl.visible = false;
  });
  ctrl.addEventListener('selectstart', () => {
    if (likertUI.isVisible()) {
      likertUI.selectHovered();
    } else {
      locomotion.commitTeleport();
    }
  });
  ctrl.addEventListener('squeezestart', () => {
    ctrl.userData.teleportAiming = true;
  });
  ctrl.addEventListener('squeezeend', () => {
    ctrl.userData.teleportAiming = false;
    locomotion.commitTeleport();
  });
  playerRig.add(ctrl);
  controllers.push(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(controllerModelFactory.createControllerModel(grip));
  playerRig.add(grip);
}

// 4. Scène Safe Space préchargée en permanence en RAM
const safeSpaceScene = new SafeSpaceScene(renderer, soundEngine);
let currentTherapySceneId = null;
let currentTherapyScene = null;
let activeSceneWrapper = safeSpaceScene;
let isSafeSpaceActive = false;

// Transition Safe Space (< 500 ms : 150 ms fade-in + swap + 250 ms fade-out)
const transition = {
  active: false,
  phase: 'idle', // 'fade_in' | 'fade_out'
  elapsed: 0,
  targetSafeSpace: false,
  pendingSceneSwap: null,
};

function attachRigAndCoreToScene(sceneObj) {
  sceneObj.scene.add(playerRig);
  sceneObj.scene.add(likertUI.group);
  sceneObj.scene.add(locomotion.group);
}

const locomotion = new Locomotion(playerRig, camera);
const likertUI = new LikertUI(renderer, soundEngine, (response) => {
  net.send(MSG_TYPES.LIKERT_RESPONSE, response);
});

function instantiateTherapyScene(sceneId) {
  switch (sceneId) {
    case 'acrophobia':
      return new AcrophobiaScene(renderer, soundEngine);
    case 'arachnophobia':
      return new ArachnophobiaScene(renderer, soundEngine);
    case 'elevator':
    default:
      return new ElevatorScene(renderer, soundEngine);
  }
}

async function switchTherapyScene(sceneId, params = {}) {
  if (currentTherapySceneId === sceneId && currentTherapyScene) {
    for (const [k, v] of Object.entries(params)) {
      currentTherapyScene.setParam(k, v);
    }
    return;
  }

  const nextScene = instantiateTherapyScene(sceneId);
  await nextScene.preload();

  if (currentTherapyScene) {
    currentTherapyScene.dispose();
  }
  currentTherapyScene = nextScene;
  currentTherapySceneId = sceneId;
  currentTherapyScene.onEnter(params);

  playerRig.position.set(0, 0, 0);
  if (!isSafeSpaceActive) {
    activeSceneWrapper = currentTherapyScene;
    attachRigAndCoreToScene(activeSceneWrapper);
  }

  lobbySceneEl.textContent = SCENES_SCHEMA[sceneId]?.shortLabel || sceneId;
  hudScenePill.textContent = SCENES_SCHEMA[sceneId]?.shortLabel || sceneId;
  net.send(MSG_TYPES.SCENE_READY, { sceneId });
}

function triggerSafeSpaceTransition(active) {
  if (active === isSafeSpaceActive && !transition.active) return;
  transition.active = true;
  transition.phase = 'fade_in';
  transition.elapsed = 0;
  transition.targetSafeSpace = active;
  fadeSphere.visible = true;
}

function executeSafeSpaceSwap(active) {
  isSafeSpaceActive = active;
  if (active) {
    currentTherapyScene?.onExit();
    safeSpaceScene.onEnter(latestState?.safeSpaceParams || {});
    activeSceneWrapper = safeSpaceScene;
    playerRig.position.set(0, 0, 0);
  } else {
    safeSpaceScene.onExit();
    if (currentTherapyScene) {
      currentTherapyScene.onEnter(latestState?.params || {});
      activeSceneWrapper = currentTherapyScene;
      playerRig.position.set(0, 0, 0);
    }
  }
  attachRigAndCoreToScene(activeSceneWrapper);
  hudSafePill.classList.toggle('hidden', !active);
}

// 5. Réseau WebSocket & Synchronisation d'État
let latestState = null;

const net = new VrNetworkClient({
  onStatusChange: (status, text) => {
    connLabel.textContent = text;
    connDot.classList.remove('ok', 'err');
    if (status === 'connected') connDot.classList.add('ok');
    if (status === 'error') connDot.classList.add('err');
  },
  onStateSync: async (state) => {
    latestState = state;

    if (state.sceneId && state.sceneId !== currentTherapySceneId) {
      await switchTherapyScene(state.sceneId, state.params || {});
    } else if (currentTherapyScene && state.params) {
      for (const [k, v] of Object.entries(state.params)) {
        currentTherapyScene.setParam(k, v);
      }
    }

    if (state.safeSpaceParams) {
      for (const [k, v] of Object.entries(state.safeSpaceParams)) {
        safeSpaceScene.setParam(k, v);
      }
    }

    if (typeof state.safeSpace === 'boolean' && state.safeSpace !== isSafeSpaceActive) {
      triggerSafeSpaceTransition(state.safeSpace);
    }

    if (state.activeLikert) {
      if (!likertUI.isVisible() || likertUI.activePrompt?.promptId !== state.activeLikert.promptId) {
        likertUI.show(state.activeLikert, camera);
      }
    } else if (likertUI.isVisible()) {
      likertUI.hide();
    }

    net.setStreamingActive(Boolean(state.videoStreamActive), canvas);
  },
});

// Pré-charger Ascenseur par défaut
await switchTherapyScene('elevator', {});

// Auto-remplir PIN depuis ?pin=
const urlParams = new URLSearchParams(location.search);
const urlPin = urlParams.get('pin');
if (urlPin) {
  pinInput.value = urlPin;
  net.connect(urlPin);
}

btnConnect.addEventListener('click', () => {
  net.connect(pinInput.value);
});

// 6. Contrôles WebXR + Simulateur Desktop
let simActive = false;
let forceGaze = false;
let yaw = 0;
let pitch = 0;
let isDragging = false;
const keysPressed = new Set();
const pointerNdc = new THREE.Vector2(0, 0);
let pointerActive = false;

async function checkXrSupport() {
  if ('xr' in navigator) {
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-vr');
      xrSupportLabel.textContent = supported ? 'Casque WebXR détecté' : 'Navigateur non-VR (Simulateur OK)';
      btnEnterVr.disabled = !supported;
    } catch {
      xrSupportLabel.textContent = 'WebXR indisponible';
      btnEnterVr.disabled = true;
    }
  } else {
    xrSupportLabel.textContent = 'HTTP/Navigateur sans WebXR';
    btnEnterVr.disabled = true;
  }
}
checkXrSupport();

let xrPaused = false;
let currentXrSession = null;

btnEnterVr.addEventListener('click', async () => {
  soundEngine.unlock();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    currentXrSession = session;
    session.addEventListener('visibilitychange', () => {
      xrPaused = session.visibilityState !== 'visible';
      soundEngine.setPaused(xrPaused);
      sendTelemetry(true);
    });
    session.addEventListener('end', () => {
      currentXrSession = null;
      xrPaused = false;
      soundEngine.setPaused(false);
      lobbyOverlay.classList.remove('hidden');
      sendTelemetry(false);
    });
    await renderer.xr.setSession(session);
    lobbyOverlay.classList.add('hidden');
    simHud.classList.add('hidden');
    simReticle.classList.add('hidden');
  } catch (err) {
    connLabel.textContent = `Erreur WebXR: ${err.message}`;
  }
});

btnEnterSim.addEventListener('click', () => {
  soundEngine.unlock();
  simActive = true;
  lobbyOverlay.classList.add('hidden');
  simHud.classList.remove('hidden');
  simReticle.classList.remove('hidden');
  forceGaze = true;
  hudModePill.textContent = 'Mode : Gaze + Souris';
});

btnExitSim.addEventListener('click', () => {
  simActive = false;
  lobbyOverlay.classList.remove('hidden');
  simHud.classList.add('hidden');
  simReticle.classList.add('hidden');
});

btnToggleGaze.addEventListener('click', () => {
  forceGaze = !forceGaze;
  simReticle.classList.toggle('hidden', !forceGaze);
  hudModePill.textContent = forceGaze ? 'Mode : Gaze + Souris' : 'Mode : Pointeur Souris';
});

// Interactions souris/clavier en mode Simulateur
canvas.addEventListener('pointerdown', (e) => {
  if (!simActive) return;
  isDragging = true;
  if (likertUI.isVisible()) {
    pointerNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    pointerActive = true;
    likertUI.update(0, { xrCamera: camera, forceGaze: false, pointerNdc });
    likertUI.selectHovered();
  }
});
window.addEventListener('pointerup', () => { isDragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!simActive) return;
  pointerNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  pointerActive = true;
  if (isDragging) {
    yaw -= e.movementX * 0.0035;
    pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0035, -1.35, 1.35);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }
});

window.addEventListener('keydown', (e) => {
  keysPressed.add(e.code);
  if (e.key === 'g' || e.key === 'G') {
    if (simActive) btnToggleGaze.click();
  }
  if (likertUI.isVisible() && e.key >= '0' && e.key <= '9') {
    const val = Number(e.key);
    likertUI.selectValueDirect(val);
  }
});
window.addEventListener('keyup', (e) => keysPressed.delete(e.code));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 7. Télémétrie & Batterie toutes les 2 secondes
let frameCount = 0;
let fpsMeasure = 0;
let lastFpsTime = performance.now();
let batteryLevel = null;

if (navigator.getBattery) {
  navigator.getBattery().then((bat) => {
    batteryLevel = bat.level;
    bat.addEventListener('levelchange', () => { batteryLevel = bat.level; });
  }).catch(() => {});
}

function sendTelemetry(inXrOverride = null) {
  const inVR = inXrOverride !== null ? inXrOverride : Boolean(currentXrSession || simActive);
  const hasCtrl = controllers.some((c) => c.visible);
  net.send(MSG_TYPES.TELEMETRY, {
    inVR,
    fps: fpsMeasure,
    battery: batteryLevel,
    trackingLost: xrPaused,
    headPose: { y: Number((playerRig.position.y + camera.position.y).toFixed(2)) },
    interactionMode: hasCtrl && !forceGaze ? 'controller' : 'gaze',
  });
}

setInterval(() => {
  const now = performance.now();
  const elapsedSec = (now - lastFpsTime) / 1000;
  fpsMeasure = elapsedSec > 0 ? Math.round(frameCount / elapsedSec) : 0;
  frameCount = 0;
  lastFpsTime = now;
  hudFpsPill.textContent = `${fpsMeasure} FPS`;
  sendTelemetry();
}, 2000);

// 8. Boucle de rendu principale 72-90 Hz
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, clock.getDelta());
  frameCount++;

  // Mouvement simulateur clavier ZQSD / Flèches contraint aux bornes NavMesh
  if (simActive && !renderer.xr.isPresenting) {
    const speed = 2.0 * dt;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    const prevX = playerRig.position.x;
    const prevZ = playerRig.position.z;
    if (keysPressed.has('KeyW') || keysPressed.has('ArrowUp')) playerRig.position.addScaledVector(forward, speed);
    if (keysPressed.has('KeyS') || keysPressed.has('ArrowDown')) playerRig.position.addScaledVector(forward, -speed);
    if (keysPressed.has('KeyA') || keysPressed.has('ArrowLeft')) playerRig.position.addScaledVector(right, -speed);
    if (keysPressed.has('KeyD') || keysPressed.has('ArrowRight')) playerRig.position.addScaledVector(right, speed);

    const clamped = activeSceneWrapper.clampPosition(playerRig.position.x, playerRig.position.z, prevX, prevZ);
    playerRig.position.x = clamped.x;
    playerRig.position.z = clamped.z;
  }

  // Gestion transition Safe Space (< 500 ms : 150 ms fade-in -> swap -> 250 ms fade-out)
  if (transition.active) {
    transition.elapsed += dt;
    if (transition.phase === 'fade_in') {
      const p = Math.min(1, transition.elapsed / 0.15);
      fadeSphereMat.opacity = p;
      if (p >= 1) {
        executeSafeSpaceSwap(transition.targetSafeSpace);
        transition.phase = 'fade_out';
        transition.elapsed = 0;
      }
    } else if (transition.phase === 'fade_out') {
      const p = Math.min(1, transition.elapsed / 0.25);
      fadeSphereMat.opacity = 1 - p;
      if (p >= 1) {
        fadeSphereMat.opacity = 0;
        fadeSphere.visible = false;
        transition.active = false;
        transition.phase = 'idle';
      }
    }
  }

  if (!xrPaused) {
    activeSceneWrapper.update(dt, camera, playerRig);
  }

  // Prévisualisation téléportation parabolique si squeeze enfoncé
  const aimingCtrl = controllers.find((c) => c.visible && c.userData.teleportAiming);
  if (aimingCtrl && !likertUI.isVisible()) {
    locomotion.previewFromController(aimingCtrl, activeSceneWrapper);
  } else {
    locomotion.clearPreview();
  }

  locomotion.updateVignette(activeSceneWrapper.getMotionIntensity(), dt);

  likertUI.update(dt, {
    xrCamera: camera,
    controllers,
    forceGaze: forceGaze || !controllers.some((c) => c.visible),
    pointerNdc: simActive && !forceGaze && pointerActive ? pointerNdc : null,
  });

  renderer.render(activeSceneWrapper.scene, camera);
});
