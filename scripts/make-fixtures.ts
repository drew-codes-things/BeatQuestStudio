import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeBandTrack } from "../src/audio/testSignals";

export const FIXTURE_BPM = 128;
export const FIXTURE_DOWNBEAT_SECONDS = 0.437;
const SAMPLE_RATE = 44100;
const DURATION_SECONDS = 45;
const STEREO = 2;

function wavBytes(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * STEREO * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(STEREO, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * STEREO * 2, 28);
  buffer.writeUInt16LE(STEREO * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  const peak = samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0) || 1;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.round((samples[index]! / peak) * 0.9 * 32767);
    buffer.writeInt16LE(value, 44 + index * 4);
    buffer.writeInt16LE(value, 46 + index * 4);
  }
  return buffer;
}

const FORMATS: Record<string, string[]> = {
  "song.mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
  "song.m4a": ["-c:a", "aac", "-b:a", "192k"],
  "song.opus": ["-c:a", "libopus", "-b:a", "128k"],
  "song.ogg": ["-c:a", "libvorbis", "-q:a", "5"],
  "song.flac": ["-c:a", "flac"],
  "clip.mp4": ["-f", "lavfi", "-i", `color=c=red:s=320x240:d=${DURATION_SECONDS}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
  "clip.webm": ["-f", "lavfi", "-i", `color=c=blue:s=320x240:d=${DURATION_SECONDS}`, "-shortest", "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-b:a", "128k"],
  "clip.mov": ["-f", "lavfi", "-i", `color=c=green:s=320x240:d=${DURATION_SECONDS}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"],
};

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("usage: vite-node scripts/make-fixtures.ts <output directory>");
mkdirSync(outputDirectory, { recursive: true });
const wavPath = join(outputDirectory, "song.wav");
writeFileSync(wavPath, wavBytes(makeBandTrack({ bpm: FIXTURE_BPM, firstDownbeatSeconds: FIXTURE_DOWNBEAT_SECONDS, durationSeconds: DURATION_SECONDS, sampleRate: SAMPLE_RATE, jitterMs: 5 }), SAMPLE_RATE));
for (const [name, args] of Object.entries(FORMATS)) {
  const videoInput = args[0] === "-f";
  const inputs = videoInput ? ["-i", wavPath, ...args.slice(0, 4)] : ["-i", wavPath];
  const codecArgs = videoInput ? args.slice(4) : args;
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, ...codecArgs, join(outputDirectory, name)]);
}
console.log(JSON.stringify({ bpm: FIXTURE_BPM, downbeatSeconds: FIXTURE_DOWNBEAT_SECONDS, files: ["song.wav", ...Object.keys(FORMATS)] }));
