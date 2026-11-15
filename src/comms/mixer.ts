// Audio mixer for the single host audio track (spec 8.2). Pure PCM math:
// Int16Array, mono. A voice queue plus any number of overlapping sfx.
// While voice plays, sfx are ducked by 6 dB. `level` is the RMS of the voice part only.
//
// TO VERIFY ON THE REAL LINE: check that the 6 dB duck keeps sfx audible but not
// louder than the host voice on a real call.

export interface Mixer {
  addVoice(pcm: Int16Array): void;
  addSfx(pcm: Int16Array): void;
  clearVoice(): void;
  hasAudio(): boolean;
  voiceActive(): boolean;
  nextFrame(samples: number): { pcm: Int16Array; level: number };
}

const DUCK = 0.5; // -6 dB

interface Cursor { pcm: Int16Array; pos: number }

export function createMixer(): Mixer {
  let voice: Cursor[] = [];
  let sfx: Cursor[] = [];

  // Add up to `samples` samples from the cursors into `into`, dropping finished ones.
  function pull(list: Cursor[], samples: number, into: Float64Array): Cursor[] {
    for (const c of list) {
      const n = Math.min(samples, c.pcm.length - c.pos);
      for (let i = 0; i < n; i++) into[i] += c.pcm[c.pos + i];
      c.pos += n;
    }
    return list.filter((c) => c.pos < c.pcm.length);
  }

  return {
    addVoice(pcm) { if (pcm.length) voice.push({ pcm, pos: 0 }); },
    addSfx(pcm) { if (pcm.length) sfx.push({ pcm, pos: 0 }); },
    clearVoice() { voice = []; },
    hasAudio: () => voice.length > 0 || sfx.length > 0,
    voiceActive: () => voice.length > 0,
    nextFrame(samples) {
      const v = new Float64Array(samples);
      const s = new Float64Array(samples);
      voice = pull(voice, samples, v);
      sfx = pull(sfx, samples, s);
      // Duck sfx only when voice is actually in this frame.
      let sumSq = 0;
      for (let i = 0; i < samples; i++) sumSq += v[i] * v[i];
      const voiceHere = sumSq > 0;
      const out = new Int16Array(samples);
      for (let i = 0; i < samples; i++) {
        const m = v[i] + s[i] * (voiceHere ? DUCK : 1);
        out[i] = Math.max(-32768, Math.min(32767, Math.round(m)));
      }
      const level = samples > 0 ? Math.min(1, Math.sqrt(sumSq / samples) / 32768 * 2) : 0;
      return { pcm: out, level };
    },
  };
}
