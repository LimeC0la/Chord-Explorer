/**
 * mic-manager.js
 *
 * Handles microphone permissions, stream lifecycle, and AnalyserNode setup
 * using the Web Audio API directly.
 *
 * Uses a SEPARATE AudioContext from Tone.js playback to avoid conflicts
 * on Android where a shared context can cause silent mic input or
 * broken audio routing.
 *
 * No dependencies.
 */

export class MicManager {
  constructor() {
    /** @type {AudioContext|null} Dedicated mic AudioContext (not shared with Tone.js) */
    this.ctx = null;

    /** @type {AnalyserNode|null} */
    this.analyser = null;

    /** @type {MediaStream|null} Raw mic stream from getUserMedia */
    this.stream = null;

    /** @type {MediaStreamAudioSourceNode|null} */
    this.source = null;

    /** @type {boolean} Whether the mic pipeline is currently running */
    this.active = false;
  }

  /**
   * Request microphone access and wire up the analysis pipeline.
   *
   * Flow: mic stream → MediaStreamAudioSourceNode → AnalyserNode
   * The analyser is NOT connected to ctx.destination so the user
   * won't hear their own mic fed back through speakers.
   *
   * @throws {Error} Human-readable message on permission or hardware failure.
   */
  async start() {
    // Avoid double-starting
    if (this.active) return;

    try {
      // 1. Request mic permission with raw audio (no voice processing)
      //    Disabling echoCancellation, noiseSuppression, and autoGainControl
      //    gives us the unprocessed signal — critical for instrument detection
      //    because these filters are designed to isolate human voice and
      //    actively suppress everything else (like a guitar strum nearby).
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      // 2. Create a dedicated AudioContext for mic analysis
      this.ctx = new AudioContext();

      // 3. Create an AnalyserNode tuned for guitar pitch detection
      //    - fftSize 4096 → 2048 frequency bins, giving ~10.7 Hz resolution
      //      at 44100 Hz sample rate. Enough to distinguish low E2 (82 Hz)
      //      from nearby semitones.
      //    - smoothingTimeConstant 0.8 keeps the spectrum stable between frames
      //      without lagging too far behind quick note changes.
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.8;

      // 4. Connect: stream source → analyser (NOT to destination — no feedback)
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser);

      this.active = true;
    } catch (err) {
      // Clean up anything partially created before re-throwing
      this.stop();

      if (err.name === 'NotAllowedError') {
        throw new Error('Mic access denied \u2014 check your browser settings');
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No microphone found on this device');
      }
      throw new Error(err.message || 'Failed to start microphone');
    }
  }

  /**
   * Tear down the entire mic pipeline and release hardware.
   * Safe to call even if start() was never called or already stopped.
   */
  stop() {
    // Stop every track on the raw media stream (releases the mic LED)
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    // Disconnect the source node from the analyser
    if (this.source) {
      this.source.disconnect();
    }

    // Close the dedicated AudioContext to free system resources
    if (this.ctx) {
      this.ctx.close().catch(() => {
        // close() can reject if already closed — safe to ignore
      });
    }

    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.active = false;
  }

  /** @returns {AnalyserNode|null} The analyser for reading frequency/time-domain data. */
  getAnalyser() {
    return this.analyser;
  }

  /** @returns {number} Sample rate of the mic AudioContext, or 44100 as a sensible default. */
  getSampleRate() {
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  /** @returns {boolean} Whether the mic pipeline is currently active. */
  isActive() {
    return this.active;
  }
}
