/**
 * YIN fundamental frequency estimation algorithm.
 * Based on de Cheveigne & Kawahara (2002).
 *
 * Detects pitch from a time-domain audio buffer by finding the
 * period (lag) that minimises a cumulative mean normalised
 * difference function, then refines with parabolic interpolation.
 */

/**
 * Estimate the fundamental frequency of an audio buffer.
 *
 * @param {Float32Array} buffer  - Time-domain samples (from analyser.getFloatTimeDomainData)
 * @param {number}       sampleRate - Audio context sample rate in Hz
 * @param {number}       threshold  - Absolute threshold on d'(tau) (lower = stricter)
 * @returns {{ frequency: number, confidence: number } | null}
 */
export function yin(buffer, sampleRate, threshold = 0.15) {
  const halfLen = Math.floor(buffer.length / 2);

  // Lag search bounds (tau in samples)
  const tauMin = Math.floor(sampleRate / 2000); // ~2000 Hz upper limit
  const tauMax = Math.min(Math.floor(sampleRate / 75), halfLen); // ~75 Hz lower limit

  if (tauMax <= tauMin) return null;

  // --- Step 1: Difference function d(tau) ---
  // d(tau) = sum of squared differences between sample pairs separated by tau
  const diff = new Float32Array(tauMax + 1);

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // --- Step 2: Cumulative mean normalised difference d'(tau) ---
  // d'(0) = 1 by definition; for tau >= 1 normalise by running average
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau <= tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum === 0 ? 1 : diff[tau] * tau / runningSum;
  }

  // --- Step 3: Absolute threshold ---
  // Find the first tau (within search range) where d'(tau) dips below threshold
  let bestTau = -1;

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      // Walk forward while the value keeps decreasing (find the local minimum)
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  // No periodic signal found
  if (bestTau === -1) return null;

  // --- Step 4: Parabolic interpolation for sub-sample accuracy ---
  let interpolatedTau = bestTau;

  if (bestTau > 0 && bestTau < tauMax) {
    const a = cmnd[bestTau - 1];
    const b = cmnd[bestTau];
    const c = cmnd[bestTau + 1];
    const shift = (a - c) / (2 * (a - 2 * b + c));

    if (isFinite(shift)) {
      interpolatedTau = bestTau + shift;
    }
  }

  // --- Step 5 & 6: Frequency and confidence ---
  const frequency = sampleRate / interpolatedTau;
  const confidence = 1 - cmnd[bestTau];

  return { frequency, confidence };
}
