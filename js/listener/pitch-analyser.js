/**
 * pitch-analyser.js
 *
 * Progressive multi-stage offline pitch detection.
 *
 * Three stages of increasing depth — each returns a complete result that
 * can be displayed immediately. The UI shows Stage 1 fast, then refines
 * with Stage 2 and 3 as they complete in the background.
 *
 * Stage 1 — Quick (~50ms)
 *   Single FFT snapshot of the loudest part of the buffer.
 *   Gets a rough answer on screen fast.
 *
 * Stage 2 — Full (~200-400ms)
 *   Multi-resolution YIN + FFT across all frames at two window sizes.
 *   Much more accurate, catches notes YIN misses and vice versa.
 *
 * Stage 3 — Deep (~400-800ms)
 *   Harmonic Product Spectrum + Chroma/HPCP + spectral whitening +
 *   cross-method consensus voting. Notes must be confirmed by 2+ methods.
 *   Produces the highest-confidence result.
 *
 * Signal conditioning applied to all stages:
 *   - Pre-emphasis filter: y[n] = x[n] - 0.97*x[n-1]
 *     Compensates for 6dB/octave bass rolloff through phone mics
 *   - Spectral whitening: normalizes FFT bins by local spectral average
 *     so bass strings don't dominate over treble
 *   - Chroma/HPCP: maps FFT spectrum into 12 pitch-class bins with
 *     harmonic weighting — industry standard for chord detection
 */

import { yin } from './yin.js';

export class PitchAnalyser {
  /** @param {number} sampleRate */
  constructor(sampleRate) {
    this.sampleRate = sampleRate;

    // ── Config ────────────────────────────────────────────────
    this.MIN_FREQUENCY  = 75;
    this.MAX_FREQUENCY  = 1500;
    this.YIN_THRESHOLD  = 0.15;
    this.YIN_MIN_CONF   = 0.50;
    this.FFT_PEAK_DB    = 16;
    this.HPS_ORDER      = 5;
    this.PRE_EMPHASIS    = 0.97;

    // Chroma/HPCP config
    this.CHROMA_HARMONICS = 6;        // number of harmonics to fold
    this.CHROMA_HARMONIC_DECAY = 0.6;  // weight decay per harmonic

    // Spectral whitening config
    this.WHITEN_BANDWIDTH = 10; // bins either side for local average
  }

  // ── Stage 1: Quick snapshot ─────────────────────────────────
  analyseQuick(buffer) {
    const { samples } = buffer;
    const fftSize = 4096;
    if (samples.length < fftSize) return _emptyResult();

    // Apply pre-emphasis to full buffer
    const emphasized = preEmphasis(samples, this.PRE_EMPHASIS);

    // Find the loudest 4096-sample window
    const frame = _findLoudestFrame(emphasized, fftSize);
    const windowed = hannWindow(frame);

    // FFT peaks with spectral whitening
    const peaks = fftPeaksWhitened(
      windowed, this.sampleRate, fftSize,
      this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.FFT_PEAK_DB,
      this.WHITEN_BANDWIDTH
    );

    const hitCounts = new Array(12).fill(0);
    const confSums  = new Array(12).fill(0);
    const freqSums  = new Array(12).fill(0);

    for (const peak of peaks) {
      const pc = ((peak.midi % 12) + 12) % 12;
      hitCounts[pc]++;
      confSums[pc] += 0.65;
      freqSums[pc] += peak.frequency;
    }

    // YIN on this one frame
    const yinResult = yin(windowed, this.sampleRate, this.YIN_THRESHOLD);
    if (yinResult &&
        yinResult.frequency >= this.MIN_FREQUENCY &&
        yinResult.frequency <= this.MAX_FREQUENCY &&
        yinResult.confidence >= this.YIN_MIN_CONF) {
      const midi = Math.round(12 * Math.log2(yinResult.frequency / 440) + 69);
      const pc = ((midi % 12) + 12) % 12;
      hitCounts[pc]++;
      confSums[pc] += yinResult.confidence;
      freqSums[pc] += yinResult.frequency;
    }

    // Quick chroma pass on the same frame
    const chroma = chromaHPCP(
      windowed, this.sampleRate, fftSize,
      this.MIN_FREQUENCY, this.MAX_FREQUENCY,
      this.CHROMA_HARMONICS, this.CHROMA_HARMONIC_DECAY,
      this.WHITEN_BANDWIDTH
    );
    for (let pc = 0; pc < 12; pc++) {
      if (chroma[pc] > 0.25) { // threshold: 25% of max energy
        hitCounts[pc]++;
        confSums[pc] += chroma[pc] * 0.70;
        freqSums[pc] += _pcToRepresentativeFreq(pc);
      }
    }

    return _buildResult(hitCounts, confSums, freqSums, 1);
  }

  // ── Stage 2: Full multi-resolution ──────────────────────────
  analyseFull(buffer) {
    const { samples } = buffer;

    // Apply pre-emphasis
    const emphasized = preEmphasis(samples, this.PRE_EMPHASIS);

    const hitCounts = new Array(12).fill(0);
    const confSums  = new Array(12).fill(0);
    const freqSums  = new Array(12).fill(0);
    let totalFrames = 0;

    const passes = [
      [8192, 2048],
      [4096, 1024],
    ];

    for (const [fftSize, hopSize] of passes) {
      const frameCount = Math.floor((emphasized.length - fftSize) / hopSize) + 1;

      for (let f = 0; f < frameCount; f++) {
        const start = f * hopSize;
        const end   = start + fftSize;
        if (end > emphasized.length) break;

        const frame    = emphasized.slice(start, end);
        const windowed = hannWindow(frame);

        const energy = _frameEnergy(frame);
        if (energy < 0.0005) continue;

        totalFrames++;

        // YIN
        const yinResult = yin(windowed, this.sampleRate, this.YIN_THRESHOLD);
        if (yinResult &&
            yinResult.frequency >= this.MIN_FREQUENCY &&
            yinResult.frequency <= this.MAX_FREQUENCY &&
            yinResult.confidence >= this.YIN_MIN_CONF) {
          const midi = Math.round(12 * Math.log2(yinResult.frequency / 440) + 69);
          const pc = ((midi % 12) + 12) % 12;
          hitCounts[pc]++;
          confSums[pc] += yinResult.confidence;
          freqSums[pc] += yinResult.frequency;
        }

        // FFT peaks with whitening
        const peaks = fftPeaksWhitened(
          windowed, this.sampleRate, fftSize,
          this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.FFT_PEAK_DB,
          this.WHITEN_BANDWIDTH
        );
        for (const peak of peaks) {
          const pc = ((peak.midi % 12) + 12) % 12;
          hitCounts[pc]++;
          confSums[pc] += 0.70;
          freqSums[pc] += peak.frequency;
        }

        // Chroma/HPCP per frame (only for large window — fine resolution)
        if (fftSize >= 8192) {
          const chroma = chromaHPCP(
            windowed, this.sampleRate, fftSize,
            this.MIN_FREQUENCY, this.MAX_FREQUENCY,
            this.CHROMA_HARMONICS, this.CHROMA_HARMONIC_DECAY,
            this.WHITEN_BANDWIDTH
          );
          for (let pc = 0; pc < 12; pc++) {
            if (chroma[pc] > 0.20) {
              hitCounts[pc]++;
              confSums[pc] += chroma[pc] * 0.75;
              freqSums[pc] += _pcToRepresentativeFreq(pc);
            }
          }
        }
      }
    }

    const minHits = Math.max(2, Math.ceil(totalFrames * 0.08));
    return _buildResult(hitCounts, confSums, freqSums, minHits);
  }

  // ── Stage 3: Deep analysis with consensus ───────────────────
  analyseDeep(buffer) {
    const { samples } = buffer;

    // Apply pre-emphasis
    const emphasized = preEmphasis(samples, this.PRE_EMPHASIS);

    // Track hits per method independently for consensus voting
    const yinHits    = new Array(12).fill(0);
    const fftHits    = new Array(12).fill(0);
    const hpsHits    = new Array(12).fill(0);
    const chromaHits = new Array(12).fill(0);

    // Shared accumulators
    const confSums  = new Array(12).fill(0);
    const freqSums  = new Array(12).fill(0);
    const hitCounts = new Array(12).fill(0);
    let totalFrames = 0;

    // ── YIN + FFT at multiple resolutions ─────────────────────
    const passes = [
      [8192, 2048],
      [4096, 1024],
      [2048, 512],
    ];

    for (const [fftSize, hopSize] of passes) {
      if (emphasized.length < fftSize) continue;
      const frameCount = Math.floor((emphasized.length - fftSize) / hopSize) + 1;

      for (let f = 0; f < frameCount; f++) {
        const start = f * hopSize;
        const end   = start + fftSize;
        if (end > emphasized.length) break;

        const frame    = emphasized.slice(start, end);
        const windowed = hannWindow(frame);

        const energy = _frameEnergy(frame);
        if (energy < 0.0005) continue;

        totalFrames++;

        // YIN
        const yinResult = yin(windowed, this.sampleRate, this.YIN_THRESHOLD);
        if (yinResult &&
            yinResult.frequency >= this.MIN_FREQUENCY &&
            yinResult.frequency <= this.MAX_FREQUENCY &&
            yinResult.confidence >= this.YIN_MIN_CONF) {
          const midi = Math.round(12 * Math.log2(yinResult.frequency / 440) + 69);
          const pc = ((midi % 12) + 12) % 12;
          yinHits[pc]++;
          hitCounts[pc]++;
          confSums[pc] += yinResult.confidence;
          freqSums[pc] += yinResult.frequency;
        }

        // FFT peaks with whitening (skip for tiny 2048 window)
        if (fftSize >= 4096) {
          const peaks = fftPeaksWhitened(
            windowed, this.sampleRate, fftSize,
            this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.FFT_PEAK_DB,
            this.WHITEN_BANDWIDTH
          );
          for (const peak of peaks) {
            const pc = ((peak.midi % 12) + 12) % 12;
            fftHits[pc]++;
            hitCounts[pc]++;
            confSums[pc] += 0.70;
            freqSums[pc] += peak.frequency;
          }
        }

        // Chroma/HPCP (only for large windows — fine resolution needed)
        if (fftSize >= 4096) {
          const chroma = chromaHPCP(
            windowed, this.sampleRate, fftSize,
            this.MIN_FREQUENCY, this.MAX_FREQUENCY,
            this.CHROMA_HARMONICS, this.CHROMA_HARMONIC_DECAY,
            this.WHITEN_BANDWIDTH
          );
          for (let pc = 0; pc < 12; pc++) {
            if (chroma[pc] > 0.15) {
              chromaHits[pc]++;
              hitCounts[pc]++;
              confSums[pc] += chroma[pc] * 0.80;
              freqSums[pc] += _pcToRepresentativeFreq(pc);
            }
          }
        }
      }
    }

    // ── HPS pass ──────────────────────────────────────────────
    {
      const fftSize = 8192;
      const hopSize = 2048;
      if (emphasized.length >= fftSize) {
        const frameCount = Math.floor((emphasized.length - fftSize) / hopSize) + 1;

        for (let f = 0; f < frameCount; f++) {
          const start = f * hopSize;
          const end   = start + fftSize;
          if (end > emphasized.length) break;

          const frame    = emphasized.slice(start, end);
          const energy   = _frameEnergy(frame);
          if (energy < 0.0005) continue;

          const windowed = hannWindow(frame);
          totalFrames++;

          const peaks = harmonicProductSpectrum(
            windowed, this.sampleRate, fftSize,
            this.MIN_FREQUENCY, this.MAX_FREQUENCY, this.HPS_ORDER
          );

          for (const peak of peaks) {
            const pc = ((peak.midi % 12) + 12) % 12;
            hpsHits[pc]++;
            hitCounts[pc]++;
            confSums[pc] += 0.85;
            freqSums[pc] += peak.frequency;
          }
        }
      }
    }

    // ── Consensus voting ──────────────────────────────────────
    // A pitch class must be detected by at least 2 of 4 methods
    // (YIN, FFT, HPS, Chroma) to be included in the final result.
    const minHits = Math.max(2, Math.ceil(totalFrames * 0.06));

    const pitchClasses = new Map();
    for (let pc = 0; pc < 12; pc++) {
      if (hitCounts[pc] < minHits) continue;

      // Count how many methods detected this note
      let methodCount = 0;
      if (yinHits[pc] >= 2)    methodCount++;
      if (fftHits[pc] >= 2)    methodCount++;
      if (hpsHits[pc] >= 2)    methodCount++;
      if (chromaHits[pc] >= 2) methodCount++;

      // Must be confirmed by at least 2 methods
      if (methodCount < 2) continue;

      pitchClasses.set(pc, {
        hits:          hitCounts[pc],
        avgConfidence: confSums[pc] / hitCounts[pc],
        avgFrequency:  freqSums[pc] / hitCounts[pc],
        methods:       methodCount,
      });
    }

    // Harmonic cleanup — remove octave and 3× harmonics of stronger notes
    const toRemove = [];
    for (const [pc, data] of pitchClasses) {
      for (const [otherPc, otherData] of pitchClasses) {
        if (pc === otherPc) continue;
        const ratio = data.avgFrequency / otherData.avgFrequency;
        if (ratio > 1.85 && ratio < 2.15 && data.hits < otherData.hits * 0.4) {
          toRemove.push(pc); break;
        }
        if (ratio > 2.85 && ratio < 3.15 && data.hits < otherData.hits * 0.35) {
          toRemove.push(pc); break;
        }
      }
    }
    for (const pc of toRemove) pitchClasses.delete(pc);

    return _buildResultFromMap(pitchClasses);
  }
}

// ── Pre-emphasis filter ───────────────────────────────────────
// y[n] = x[n] - coeff * x[n-1]
// Boosts high frequencies to compensate for the natural 6dB/octave
// bass-heavy rolloff of guitars picked up through phone mics.

function preEmphasis(samples, coeff) {
  const out = new Float32Array(samples.length);
  out[0] = samples[0];
  for (let i = 1; i < samples.length; i++) {
    out[i] = samples[i] - coeff * samples[i - 1];
  }
  return out;
}

// ── Spectral whitening ────────────────────────────────────────
// Divides each magnitude bin by the local spectral average (within
// ±bandwidth bins). This equalizes energy across the spectrum so
// loud bass strings don't mask quieter treble strings.

function spectralWhiten(mags, bandwidth) {
  const N = mags.length;
  const whitened = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - bandwidth);
    const hi = Math.min(N - 1, i + bandwidth);
    for (let j = lo; j <= hi; j++) {
      sum += mags[j];
      count++;
    }
    const localAvg = sum / count;
    whitened[i] = localAvg > 1e-10 ? mags[i] / localAvg : 0;
  }
  return whitened;
}

// ── Chroma / HPCP ─────────────────────────────────────────────
// Maps the entire FFT magnitude spectrum into 12 pitch-class bins.
// For each bin, sums energy at the fundamental frequency and its
// harmonics (2f, 3f, ..., Nf) with decaying weights.
// Applies spectral whitening before folding.
// Returns a 12-element array normalized to [0, 1].

function chromaHPCP(windowed, sampleRate, fftSize, minFreq, maxFreq, numHarmonics, harmonicDecay, whitenBw) {
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  // Compute magnitudes
  const mags = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  // Apply spectral whitening
  const whitened = spectralWhiten(mags, whitenBw);

  const chroma = new Float32Array(12);

  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(binCount - 1, Math.floor(maxFreq / hzPerBin));

  // For each FFT bin in range, determine its pitch class and add
  // weighted energy to that bin. Also fold harmonics.
  for (let bin = minBin; bin <= maxBin; bin++) {
    const freq = bin * hzPerBin;
    if (freq < minFreq || freq > maxFreq) continue;

    const energy = whitened[bin] * whitened[bin]; // squared magnitude (power)

    // Map frequency to fractional MIDI, then to pitch class
    const midiFloat = 12 * Math.log2(freq / 440) + 69;
    const pc = ((Math.round(midiFloat) % 12) + 12) % 12;

    // Fundamental contributes full weight
    chroma[pc] += energy;

    // Check if this bin is a harmonic of a lower fundamental
    for (let h = 2; h <= numHarmonics; h++) {
      const fundamentalFreq = freq / h;
      if (fundamentalFreq < minFreq) break;

      const fundMidi = 12 * Math.log2(fundamentalFreq / 440) + 69;
      const fundPc = ((Math.round(fundMidi) % 12) + 12) % 12;

      // Decaying weight for higher harmonics
      const weight = Math.pow(harmonicDecay, h - 1);
      chroma[fundPc] += energy * weight;
    }
  }

  // Normalize to [0, 1]
  let maxVal = 0;
  for (let i = 0; i < 12; i++) {
    if (chroma[i] > maxVal) maxVal = chroma[i];
  }
  if (maxVal > 0) {
    for (let i = 0; i < 12; i++) {
      chroma[i] /= maxVal;
    }
  }

  return chroma;
}

// ── Result builders ───────────────────────────────────────────

function _emptyResult() {
  return {
    pitchClasses: new Map(),
    dominantFrequency: null,
    dominantNote: null,
    isSingleNote: false,
  };
}

function _buildResult(hitCounts, confSums, freqSums, minHits) {
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

  // Basic harmonic cleanup
  const toRemove = [];
  for (const [pc, data] of pitchClasses) {
    for (const [otherPc, otherData] of pitchClasses) {
      if (pc === otherPc) continue;
      const ratio = data.avgFrequency / otherData.avgFrequency;
      if (ratio > 1.85 && ratio < 2.15 && data.hits < otherData.hits * 0.45) {
        toRemove.push(pc); break;
      }
    }
  }
  for (const pc of toRemove) pitchClasses.delete(pc);

  return _buildResultFromMap(pitchClasses);
}

function _buildResultFromMap(pitchClasses) {
  let dominantPc   = -1;
  let dominantHits = 0;
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

  return {
    pitchClasses,
    dominantFrequency,
    dominantNote,
    isSingleNote: pitchClasses.size === 1,
  };
}

// ── Frame helpers ─────────────────────────────────────────────

function _findLoudestFrame(samples, frameSize) {
  let bestEnergy = -1;
  let bestStart  = 0;
  const hop = Math.floor(frameSize / 2);

  for (let i = 0; i + frameSize <= samples.length; i += hop) {
    let energy = 0;
    for (let j = i; j < i + frameSize; j++) {
      energy += samples[j] * samples[j];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart  = i;
    }
  }

  return samples.slice(bestStart, bestStart + frameSize);
}

function _frameEnergy(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    sum += frame[i] * frame[i];
  }
  return sum / frame.length;
}

/** Convert pitch class (0-11) to a representative frequency in octave 4 */
function _pcToRepresentativeFreq(pc) {
  // C4 = MIDI 60, so pc 0 (C) → MIDI 60
  const midi = 60 + pc;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── FFT peak detection with spectral whitening ────────────────

function fftPeaksWhitened(windowed, sampleRate, fftSize, minFreq, maxFreq, peakDbAboveFloor, whitenBw) {
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(binCount - 2, Math.floor(maxFreq / hzPerBin));

  // Compute linear magnitudes
  const linMags = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    linMags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  // Apply spectral whitening
  const whitened = spectralWhiten(linMags, whitenBw);

  // Convert whitened magnitudes to dB for peak picking
  const mags = new Float32Array(binCount);
  for (let i = minBin; i <= maxBin; i++) {
    mags[i] = 20 * Math.log10(whitened[i] + 1e-10);
  }

  const sorted = [];
  for (let i = minBin; i <= maxBin; i++) sorted.push(mags[i]);
  sorted.sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const threshold  = noiseFloor + peakDbAboveFloor;

  const peaks = [];
  const seenPitchClasses = new Set();

  for (let i = minBin + 1; i < maxBin; i++) {
    if (mags[i] > mags[i - 1] && mags[i] > mags[i + 1] && mags[i] > threshold) {
      const a = mags[i - 1], b = mags[i], c = mags[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq  = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi < 28 || midi > 96) continue;

      const pc = ((midi % 12) + 12) % 12;
      if (seenPitchClasses.has(pc)) continue;
      seenPitchClasses.add(pc);

      peaks.push({ frequency: freq, midi, magnitude: mags[i] });
    }
  }

  return peaks;
}

// ── Harmonic Product Spectrum ─────────────────────────────────

function harmonicProductSpectrum(windowed, sampleRate, fftSize, minFreq, maxFreq, order) {
  const { re, im } = fft(windowed);
  const binCount = fftSize / 2;
  const hzPerBin = sampleRate / fftSize;

  const mags = new Float32Array(binCount);
  for (let i = 0; i < binCount; i++) {
    mags[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }

  const hpsLen = Math.floor(binCount / order);
  const hps    = new Float32Array(hpsLen);

  for (let i = 0; i < hpsLen; i++) {
    let product = mags[i];
    for (let h = 2; h <= order; h++) {
      const idx = i * h;
      if (idx >= binCount) { product *= 1e-10; continue; }
      product *= mags[idx] || 1e-10;
    }
    hps[i] = product;
  }

  const logHps = new Float32Array(hpsLen);
  for (let i = 0; i < hpsLen; i++) {
    logHps[i] = 20 * Math.log10(hps[i] + 1e-30);
  }

  const minBin = Math.max(1, Math.floor(minFreq / hzPerBin));
  const maxBin = Math.min(hpsLen - 2, Math.floor(maxFreq / hzPerBin));

  const sorted = [];
  for (let i = minBin; i <= maxBin; i++) sorted.push(logHps[i]);
  sorted.sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.5)];
  const threshold  = noiseFloor + 25;

  const peaks = [];
  const seenPitchClasses = new Set();

  for (let i = minBin + 1; i < maxBin; i++) {
    if (logHps[i] > logHps[i - 1] && logHps[i] > logHps[i + 1] && logHps[i] > threshold) {
      const a = logHps[i - 1], b = logHps[i], c = logHps[i + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c));
      const freq  = (i + (isFinite(shift) ? shift : 0)) * hzPerBin;

      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      if (midi < 28 || midi > 96) continue;

      const pc = ((midi % 12) + 12) % 12;
      if (seenPitchClasses.has(pc)) continue;
      seenPitchClasses.add(pc);

      peaks.push({ frequency: freq, midi });
    }
  }

  return peaks;
}

// ── Radix-2 FFT ───────────────────────────────────────────────

function fft(signal) {
  const N  = signal.length;
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    re[bitReverse(i, N)] = signal[i];
  }

  for (let size = 2; size <= N; size *= 2) {
    const half  = size / 2;
    const angle = -2 * Math.PI / size;
    const wRe   = Math.cos(angle);
    const wIm   = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let twRe = 1, twIm = 0;
      for (let j = 0; j < half; j++) {
        const evenIdx = i + j;
        const oddIdx  = i + j + half;

        const tRe = twRe * re[oddIdx] - twIm * im[oddIdx];
        const tIm = twRe * im[oddIdx] + twIm * re[oddIdx];

        re[oddIdx]  = re[evenIdx] - tRe;
        im[oddIdx]  = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;

        const nextRe = twRe * wRe - twIm * wIm;
        twIm = twRe * wIm + twIm * wRe;
        twRe = nextRe;
      }
    }
  }

  return { re, im };
}

function bitReverse(x, N) {
  const bits = Math.log2(N);
  let result = 0;
  for (let i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

// ── Hann window ───────────────────────────────────────────────

function hannWindow(buffer) {
  const N = buffer.length;
  const windowed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    windowed[i] = buffer[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return windowed;
}

// ── Tuner helpers ─────────────────────────────────────────────

const NOTE_NAMES_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function getNearestNote(frequency) {
  const midiFloat   = 12 * Math.log2(frequency / 440) + 69;
  const midi        = Math.round(midiFloat);
  const noteName    = NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
  const octave      = Math.floor(midi / 12) - 1;
  const perfectFreq = 440 * Math.pow(2, (midi - 69) / 12);
  const cents       = Math.round(1200 * Math.log2(frequency / perfectFreq));

  return { noteName, octave, midi, cents, perfectFreq };
}
