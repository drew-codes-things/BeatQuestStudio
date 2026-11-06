export interface ClickTrackOptions {
  bpm: number;
  offsetSeconds: number;
  durationSeconds: number;
  sampleRate: number;
  accentEvery?: number;
  noiseLevel?: number;
}

const CLICK_SECONDS = 0.03;
const CLICK_FREQUENCY_HZ = 1800;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function makeClickTrack(options: ClickTrackOptions): Float32Array {
  const samples = new Float32Array(Math.round(options.durationSeconds * options.sampleRate));
  const random = seededRandom(7);
  const noiseLevel = options.noiseLevel ?? 0;
  for (let index = 0; index < samples.length; index += 1) samples[index] = (random() * 2 - 1) * noiseLevel;
  const period = 60 / options.bpm;
  const clickLength = Math.round(CLICK_SECONDS * options.sampleRate);
  for (let beat = 0; ; beat += 1) {
    const start = Math.round((options.offsetSeconds + beat * period) * options.sampleRate);
    if (start >= samples.length) break;
    const accented = options.accentEvery !== undefined && beat % options.accentEvery === 0;
    const amplitude = accented ? 0.9 : 0.5;
    for (let offset = 0; offset < clickLength && start + offset < samples.length; offset += 1) {
      const time = offset / options.sampleRate;
      const decay = Math.exp(-time * 120);
      samples[start + offset]! += amplitude * decay * Math.sin(2 * Math.PI * CLICK_FREQUENCY_HZ * time);
    }
  }
  return samples;
}
