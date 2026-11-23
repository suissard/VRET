/**
 * Synthétiseur Web Audio API 100 % procédural pour le Client VR.
 * Zéro dépendance à des fichiers .mp3/.ogg externes : fonctionne immédiatement hors-ligne.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.therapyGain = null;
    this.safeGain = null;
    this.noiseBuffer = null;

    // Nœuds actifs par canal
    this.safeNodes = null;
    this.windNodes = null;
    this.elevatorNodes = null;
    this.flickerNodes = null;
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.75;
      this.masterGain.connect(this.ctx.destination);

      this.therapyGain = this.ctx.createGain();
      this.therapyGain.gain.value = 1.0;
      this.therapyGain.connect(this.masterGain);

      this.safeGain = this.ctx.createGain();
      this.safeGain.gain.value = 0.0;
      this.safeGain.connect(this.masterGain);

      this.noiseBuffer = this.#createPinkNoiseBuffer(4);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  #createPinkNoiseBuffer(seconds) {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * seconds;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  setPaused(paused) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(paused ? 0.0 : 0.75, now, 0.05);
  }

  /**
   * Coupe instantanément (< 20 ms) le canal thérapeutique et active le son apaisant du Safe Space.
   */
  setSafeSpaceAudio(active, env = 'beach') {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (active) {
      this.ensureSafeSpaceWaves();
      this.setSafeSpaceEnvironment(env);
      this.therapyGain.gain.setTargetAtTime(0.0, now, 0.015);
      this.safeGain.gain.setTargetAtTime(0.45, now, 0.15);
    } else {
      this.safeGain.gain.setTargetAtTime(0.0, now, 0.08);
      this.therapyGain.gain.setTargetAtTime(1.0, now, 0.12);
    }
  }

  setSafeSpaceEnvironment(env = 'beach') {
    if (!this.ctx || !this.safeNodes) return;
    const now = this.ctx.currentTime;
    const { lfo, lfoGain, filter } = this.safeNodes;
    if (env === 'forest') {
      filter.type = 'bandpass';
      filter.frequency.setTargetAtTime(680, now, 0.25);
      filter.Q.setTargetAtTime(0.9, now, 0.25);
      lfo.frequency.setTargetAtTime(0.18, now, 0.25);
      lfoGain.gain.setTargetAtTime(190, now, 0.25);
    } else if (env === 'meadow') {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(520, now, 0.25);
      filter.Q.setTargetAtTime(0.7, now, 0.25);
      lfo.frequency.setTargetAtTime(0.15, now, 0.25);
      lfoGain.gain.setTargetAtTime(150, now, 0.25);
    } else if (env === 'mountain') {
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(300, now, 0.25);
      filter.Q.setTargetAtTime(0.8, now, 0.25);
      lfo.frequency.setTargetAtTime(0.09, now, 0.25);
      lfoGain.gain.setTargetAtTime(110, now, 0.25);
    } else {
      // Plage : ressac doux
      filter.type = 'lowpass';
      filter.frequency.setTargetAtTime(380, now, 0.25);
      filter.Q.setTargetAtTime(0.7, now, 0.25);
      lfo.frequency.setTargetAtTime(0.12, now, 0.25);
      lfoGain.gain.setTargetAtTime(220, now, 0.25);
    }
  }

  ensureSafeSpaceWaves() {
    if (!this.ctx || this.safeNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;

    // LFO lent imitant le ressac des vagues ou la brise dans les feuillages
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    src.connect(filter);
    filter.connect(this.safeGain);

    src.start();
    lfo.start();
    this.safeNodes = { src, lfo, lfoGain, filter };
  }

  startWind() {
    if (!this.ctx || this.windNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 1.6;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.therapyGain);
    src.start();
    this.windNodes = { src, filter, gain };
  }

  setWindIntensity(intensity) {
    if (!this.ctx) return;
    if (!this.windNodes) this.startWind();
    if (!this.windNodes) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, intensity));
    this.windNodes.gain.gain.setTargetAtTime(clamped * 0.55, now, 0.15);
    this.windNodes.filter.frequency.setTargetAtTime(260 + clamped * 680, now, 0.2);
  }

  stopWind() {
    if (!this.windNodes) return;
    try { this.windNodes.src.stop(); } catch {}
    this.windNodes.src.disconnect();
    this.windNodes.gain.disconnect();
    this.windNodes = null;
  }

  startElevatorHum() {
    if (!this.ctx || this.elevatorNodes) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 62;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 140;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.therapyGain);
    osc.start();
    this.elevatorNodes = { osc, filter, gain };
  }

  setElevatorHumLevel(level) {
    if (!this.ctx) return;
    if (!this.elevatorNodes) this.startElevatorHum();
    if (!this.elevatorNodes) return;
    this.elevatorNodes.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.1);
  }

  stopElevatorHum() {
    if (!this.elevatorNodes) return;
    try { this.elevatorNodes.osc.stop(); } catch {}
    this.elevatorNodes.osc.disconnect();
    this.elevatorNodes.gain.disconnect();
    this.elevatorNodes = null;
  }

  playNeonBuzz(active) {
    if (!this.ctx) return;
    if (active && !this.flickerNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 100;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.025;
      osc.connect(gain);
      gain.connect(this.therapyGain);
      osc.start();
      this.flickerNodes = { osc, gain };
    } else if (!active && this.flickerNodes) {
      try { this.flickerNodes.osc.stop(); } catch {}
      this.flickerNodes.osc.disconnect();
      this.flickerNodes.gain.disconnect();
      this.flickerNodes = null;
    }
  }

  playMechanicalStop() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(115, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.35);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);

    osc.connect(gain);
    gain.connect(this.therapyGain);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  playLikertConfirm() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  stopAllTherapy() {
    this.stopWind();
    this.stopElevatorHum();
    this.playNeonBuzz(false);
  }
}
