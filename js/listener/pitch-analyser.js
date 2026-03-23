/**
 * pitch-analyser.js
 *
 * Offline multi-frame pitch detection on a captured audio buffer.
 * Slices the buffer into overlapping Hann-windowed frames, runs YIN on each,
 * aggregates by pitch class, and returns a Map of confidently-detected notes.
 *
 * Unlike the real-time approach (single frame per rAF tick), running on the
 * complete 1.2s capture allows large FFT windows (8192) for fine frequency
 * resolution and enough overlapping frames to filter out transient harmonics.
 */

import { yin } from './yin.js';

export class PitchAnalyser {
  /** @param {number} sampleRate */
  constructor(sampleRate) {
    this.sampleRate = sampleRate;

    // ── Config ────────────────────────────────────────────────
    this.FFT_SIZE       = 8192;  // large window → fine Hz resolution offline
    this.HOP_SIZE       = 2048;  // 75% overlap between frames
    this.YIN_THRESHOLD  = 0.15;  // YIN d'(tau) cutoff — lower = stricter
    this.MIN_FREQUENCY  = 75;    // ~guitar low E with headroom
    this.MAX_FREQUENCY  = 1500;  // above highest guitar/uke fundamental
    this.MIN_CONFIDENCE = 0.80;  // reject weak YIN detections
    this.MIN_HIT_RATIO  = 0.15;  // note must appear in 15%+ of valid frames
  }

  /**
   * Analyse a captured audio buffer and return detected pitch classes.
   *
   * @param {{ samples: Float32Array, sampleRate: number }} buffer
   * @returns {{
   *   pitchClasses: Map<number, { hits: number, avgConfidence: number }>,
   *   dominantFrequency: number|null,
   *   dominantNote: { noteName: string, octave: number, cents: number }|null,
   *   isSingleNote: boolean
   * }}
   */
  analyse(buffer) {
    const { samples } = buffer;

    // ── Step 1: Slice into overlapping frames ─────────────────
    const frameCount = Math.max(
      1,
      Math.floor((samples.length - this.FFT_SIZE) / this.HOP_SIZE) + 1
    );

    // Per pitch class: total hits and sum of YIN confidence across valid frames
    const hitCounts = new Array(12).fill(0);
    const confSums  = new Array(12).fill(0);

    // For tuner mode: track raw frequencies per pitch class
    const freqSums  = new Array(12).fill(0);

    let validFrames = 0;

    for (let f = 0; f < frameCount; f++) {
      const start = f * this.HOP_SIZE;
      const end   = start + this.FFT_SIZE;
      if (end > samples.length) break;

      // ── Step 2: Apply Hann window then run YIN ────────────
      const frame    = samples.slice(start, end);
      const windowed = hannWindow(frame);

      const result = yin(windowed, this.sampleRate, this.YIN_THRESHOLD);
      if (!result) continue;

      const { frequency, confidence } = result;

      // Filter by frequency range and confidence
      if (
        frequency < this.MIN_FREQUENCY ||
        frequency > this.MAX_FREQUENCY ||
        confidence < this.MIN_CONFIDENCE
      ) {
        continue;
      }

      validFrames++;

      // ── Step 3: Convert to pitch class ────────────────────
      const midi       = Math.round(12 * Math.log2(frequency / 440) + 69);
      const pitchClass = ((midi % 12) + 12) % 12;

      hitCounts[pitchClass]++;
      confSums[pitchClass]  += confidence;
      freqSums[pitchClass]  += frequency;
    }

    // ── Step 4: Filter by hit ratio ──────────────────────────
    const minHits = Math.max(1, Math.ceil(validFrames * this.MIN_HIT_RATIO));

    const pitchClasses = new Map();

    for (let pc = 0; pc < 12; pc++) {
      if (hitCounts[pc] >= minHits) {
        pitchClasses.set(pc, {
          hits:          hitCounts[pc],
          avgConfidence: confSums[pc] / hitCounts[pc],
          avgFrequency:  freqSums[pc] / hitCounts[pc],
        });
      }
    }

    // ── Step 5: Harmonic verification ────────────────────────
    // If a pitch class appears only as a harmonic of a stronger candidate,
    // remove it. A "harmonic" here means its frequency is ~2× another detected
    // note's frequency AND its hit count is notably lower.
    for (const [pc, data] of pitchClasses) {
      for (const [otherPc, otherData] of pitchClasses) {
        if (pc === otherPc) continue;
        // Check if pc's freq ≈ 2× otherPc's freq
        const ratio = data.avgFrequency / otherData.avgFrequency;
        if (ratio > 1.85 && ratio < 2.15 && data.hits < otherData.hits * 0.6) {
          pitchClasses.delete(pc);
          break;
        }
      }
    }

    // ── Tuner data ───────────────────────────────────────────
    // Find the dominant pitch class (most hits)
    let dominantPc    = -1;
    let dominantHits  = 0;
    for (const [pc, data] of pitchClasses) {
      if (data.hits > dominantHits) {
        dominantHits = data.hits;
        dominantPc   = pc;
      }
    }

    let dominantFrequency = null;
    let dominantNote      = null;
    if (dominantPc !== -1) {
      dominantFrequency = pitchClasses.get(dominantPc).avgFrequency;
      dominantNote      = getNearestNote(dominantFrequency);
    }

    const isSingleNote = pitchClasses.size === 1;

    return { pitchClasses, dominantFrequency, dominantNote, isSingleNote };
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Apply a Hann window to a Float32Array frame.
 * Reduces spectral leakage at frame edges.
 * @param {Float32Array} buffer
 * @returns {Float32Array}
 */
function hannWindow(buffer) {
  const N = buffer.length;
  const windowed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    windowed[i] = buffer[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return windowed;
}

/** Note names for tuner display */
const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/**
 * Find the nearest equal-temperament note to a frequency and compute
 * the deviation in cents.
 * @param {number} frequency  Hz
 * @returns {{ noteName: string, octave: number, midi: number, cents: number, perfectFreq: number }}
 */
function getNearestNote(frequency) {
  const midiFloat   = 12 * Math.log2(frequency / 440) + 69;
  const midi        = Math.round(midiFloat);
  const noteName    = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave      = Math.floor(midi / 12) - 1;
  const perfectFreq = 440 * Math.pow(2, (midi - 69) / 12);
  const cents       = Math.round(1200 * Math.log2(frequency / perfectFreq));

  return { noteName, octave, midi, cents, perfectFreq };
}
