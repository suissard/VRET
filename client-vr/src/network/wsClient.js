import { MSG_TYPES, ROLES, createMessage, parseMessage } from '/shared/protocol.js';

/**
 * Client WebSocket VR avec reconnexion exponentielle (1s, 2s, 4s),
 * signalisation WebRTC (captureStream) et relais fallback JPEG basse résolution.
 */
export class VrNetworkClient {
  constructor({ onStatusChange, onStateSync, onError }) {
    this.onStatusChange = onStatusChange;
    this.onStateSync = onStateSync;
    this.onError = onError;

    this.ws = null;
    this.pin = '';
    this.authenticated = false;
    this.shouldReconnect = false;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;

    // WebRTC streaming
    this.pc = null;
    this.streamTargetRole = null;
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = 320;
    this.captureCanvas.height = 180;
    this.captureCtx = this.captureCanvas.getContext('2d');
    this.frameRelayInterval = null;
    this.sourceCanvas = null;
  }

  connect(pin) {
    this.pin = String(pin || '').trim();
    this.shouldReconnect = true;
    this.reconnectDelay = 1000;
    this.#openSocket();
  }

  #openSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    this.onStatusChange?.('connecting', 'Connexion au serveur...');

    const ws = new WebSocket(url);
    this.ws = ws;
    this.authenticated = false;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify(createMessage(MSG_TYPES.AUTH, { role: ROLES.VR, pin: this.pin })));
    });

    ws.addEventListener('message', (ev) => {
      const msg = parseMessage(ev.data);
      if (!msg) return;

      switch (msg.type) {
        case MSG_TYPES.AUTH_OK:
          this.authenticated = true;
          this.reconnectDelay = 1000;
          this.onStatusChange?.('connected', 'Connecté au serveur clinique');
          break;
        case MSG_TYPES.AUTH_ERROR:
          this.shouldReconnect = false;
          this.onStatusChange?.('error', msg.payload.message || 'PIN invalide');
          this.onError?.(msg.payload.message);
          break;
        case MSG_TYPES.STATE_SYNC:
          this.onStateSync?.(msg.payload);
          break;
        case MSG_TYPES.RTC_SIGNAL:
          this.#handleRtcSignal(msg.payload);
          break;
        case MSG_TYPES.ERROR:
          this.onError?.(msg.payload.message);
          break;
        default:
          break;
      }
    });

    ws.addEventListener('close', () => {
      this.authenticated = false;
      this.stopStreaming();
      if (this.shouldReconnect) {
        this.onStatusChange?.('reconnecting', `Reconnexion dans ${this.reconnectDelay / 1000}s...`);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(8000, this.reconnectDelay * 2);
          this.#openSocket();
        }, this.reconnectDelay);
      } else {
        this.onStatusChange?.('disconnected', 'Déconnecté');
      }
    });
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify(createMessage(type, payload)));
    }
  }

  setStreamingActive(active, sourceCanvas) {
    this.sourceCanvas = sourceCanvas;
    if (active) {
      this.#startFrameRelay();
    } else {
      this.stopStreaming();
    }
  }

  #startFrameRelay() {
    if (this.frameRelayInterval) return;
    // Relais JPEG léger 320x180 à 8 FPS (impact GPU minimal, fonctionne sur tout réseau LAN)
    this.frameRelayInterval = setInterval(() => {
      if (!this.authenticated || !this.sourceCanvas) return;
      try {
        this.captureCtx.drawImage(this.sourceCanvas, 0, 0, 320, 180);
        const dataUrl = this.captureCanvas.toDataURL('image/jpeg', 0.55);
        this.send(MSG_TYPES.VIDEO_FRAME, { dataUrl, width: 320, height: 180 });
      } catch {
        // Ignorer si le canvas WebXR n'est pas lisible sur un frame isolé
      }
    }, 125);
  }

  async #handleRtcSignal(payload) {
    const { from, signal } = payload || {};
    if (!signal || !this.sourceCanvas) return;

    if (signal.type === 'request-offer') {
      await this.#createPeerAndSendOffer(from);
      return;
    }

    if (this.pc) {
      if (signal.type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  }

  async #createPeerAndSendOffer(targetRole) {
    if (typeof RTCPeerConnection === 'undefined' || !this.sourceCanvas?.captureStream) {
      return;
    }
    if (this.pc) {
      this.pc.close();
    }
    this.streamTargetRole = targetRole;
    this.pc = new RTCPeerConnection({ iceServers: [] });

    const stream = this.sourceCanvas.captureStream(20);
    for (const track of stream.getTracks()) {
      this.pc.addTrack(track, stream);
    }

    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.send(MSG_TYPES.RTC_SIGNAL, {
          target: targetRole,
          signal: { candidate: ev.candidate },
        });
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.send(MSG_TYPES.RTC_SIGNAL, {
      target: targetRole,
      signal: offer,
    });
  }

  stopStreaming() {
    if (this.frameRelayInterval) {
      clearInterval(this.frameRelayInterval);
      this.frameRelayInterval = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch {}
      this.pc = null;
    }
  }
}
