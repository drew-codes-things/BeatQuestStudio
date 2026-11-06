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

export interface BandTrackOptions {
  bpm: number;
  firstDownbeatSeconds: number;
  durationSeconds: number;
  sampleRate: number;
  jitterMs: number;
  seed?: number;
  kickOnThree?: boolean;
}

const KICK_SECONDS = 0.25;
const SNARE_SECONDS = 0.18;
const HAT_SECONDS = 0.04;
const BASS_ROOTS_HZ = [55, 55, 73.42, 65.41];
const PAD_CHORDS_HZ = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]];

function addKick(samples: Float32Array, start: number, sampleRate: number): void {
  const length = Math.round(KICK_SECONDS * sampleRate);
  let phase = 0;
  for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
    const time = offset / sampleRate;
    phase += (2 * Math.PI * (50 + 110 * Math.exp(-time * 35))) / sampleRate;
    samples[start + offset]! += 0.8 * Math.exp(-time * 14) * Math.sin(phase);
  }
}

function addNoiseHit(samples: Float32Array, start: number, sampleRate: number, seconds: number, amplitude: number, decay: number, random: () => number, highPass: boolean): void {
  const length = Math.round(seconds * sampleRate);
  let previous = 0;
  for (let offset = 0; offset < length && start + offset < samples.length; offset += 1) {
    const noise = random() * 2 - 1;
    const shaped = highPass ? noise - previous : noise;
    previous = noise;
    samples[start + offset]! += amplitude * Math.exp(-(offset / sampleRate) * decay) * shaped;
  }
}

export function makeBandTrack(options: BandTrackOptions): Float32Array {
  const { sampleRate } = options;
  const samples = new Float32Array(Math.round(options.durationSeconds * sampleRate));
  const random = seededRandom(options.seed ?? 11);
  const period = 60 / options.bpm;
  const jitter = () => ((random() * 2 - 1) * options.jitterMs) / 1000;
  const indexOf = (seconds: number) => Math.round(seconds * sampleRate);
  for (let eighth = 0; ; eighth += 1) {
    const beatTime = options.firstDownbeatSeconds + (eighth / 2) * period;
    if (beatTime >= options.durationSeconds) break;
    const beatInBar = (eighth / 2) % 4;
    const kickOnThree = options.kickOnThree ?? true;
    if (beatInBar === 0 || (kickOnThree && beatInBar === 2)) addKick(samples, indexOf(beatTime + jitter()), sampleRate);
    if (beatInBar === 1 || beatInBar === 3) addNoiseHit(samples, indexOf(beatTime + jitter()), sampleRate, SNARE_SECONDS, 0.45, 22, random, false);
    addNoiseHit(samples, indexOf(beatTime + jitter()), sampleRate, HAT_SECONDS, eighth % 2 === 0 ? 0.12 : 0.08, 90, random, true);
  }
  for (let index = 0; index < samples.length; index += 1) {
    const seconds = index / sampleRate - options.firstDownbeatSeconds;
    if (seconds < 0) continue;
    const bar = Math.floor(seconds / (4 * period));
    const root = BASS_ROOTS_HZ[bar % BASS_ROOTS_HZ.length]!;
    const sinceBeat = seconds % period;
    samples[index]! += 0.25 * Math.exp(-sinceBeat * 6) * Math.sin(2 * Math.PI * root * seconds);
    for (const frequency of PAD_CHORDS_HZ[bar % PAD_CHORDS_HZ.length]!) samples[index]! += 0.03 * Math.sin(2 * Math.PI * frequency * seconds);
  }
  return samples;
}
