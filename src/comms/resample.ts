// Tiny pure PCM helpers (Int16, linear interpolation). No dependencies.

/** Linear-interpolation resample of mono PCM. Same rate returns the input as is. */
export function resampleInt16(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const outLen = Math.max(1, Math.round((pcm.length * toRate) / fromRate));
  const out = new Int16Array(outLen);
  const step = fromRate / toRate;
  const last = pcm.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), last);
    const i1 = Math.min(i0 + 1, last);
    const frac = pos - i0;
    out[i] = Math.round(pcm[i0] * (1 - frac) + pcm[i1] * frac);
  }
  return out;
}

/** Average interleaved channels down to mono. One channel returns the input as is. */
export function stereoToMono(pcm: Int16Array, channels = 2): Int16Array {
  if (channels <= 1) return pcm;
  const n = Math.floor(pcm.length / channels);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm[i * channels + c];
    out[i] = Math.round(sum / channels);
  }
  return out;
}
