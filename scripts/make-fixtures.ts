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

export const TAGGED_TITLE = "Neon Skyline";
export const TAGGED_ARTIST = "Fixture Band";
export const MESSY_VIDEO_NAME = "03_Test_Artist_-_Night_Drive_(Official_Video)_[HD].mp4";

interface Fixture {
  extraInputs: string[];
  codec: string[];
}

const videoInput = (color: string) => ["-f", "lavfi", "-i", `color=c=${color}:s=320x240:d=${DURATION_SECONDS}`];

const FIXTURES: Record<string, Fixture> = {
  "song.mp3": {
    extraInputs: ["-i", "art.png"],
    codec: ["-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-b:a", "192k", "-c:v", "mjpeg", "-disposition:v", "attached_pic", "-id3v2_version", "3",
      "-metadata", `title=${TAGGED_TITLE}`, "-metadata", `artist=${TAGGED_ARTIST}`],
  },
  "song.m4a": { extraInputs: [], codec: ["-c:a", "aac", "-b:a", "192k"] },
  "song.opus": { extraInputs: [], codec: ["-c:a", "libopus", "-b:a", "128k"] },
  "song.ogg": { extraInputs: [], codec: ["-c:a", "libvorbis", "-q:a", "5"] },
  "song.flac": { extraInputs: [], codec: ["-c:a", "flac"] },
  "clip.mp4": { extraInputs: videoInput("red"), codec: ["-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"] },
  "clip.webm": { extraInputs: videoInput("blue"), codec: ["-shortest", "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-b:a", "128k"] },
  "clip.mov": { extraInputs: videoInput("green"), codec: ["-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"] },
  [MESSY_VIDEO_NAME]: { extraInputs: videoInput("purple"), codec: ["-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k"] },
};

const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("usage: vite-node scripts/make-fixtures.ts <output directory>");
mkdirSync(outputDirectory, { recursive: true });
const ffmpeg = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd: outputDirectory });
writeFileSync(join(outputDirectory, "song.wav"), wavBytes(makeBandTrack({ bpm: FIXTURE_BPM, firstDownbeatSeconds: FIXTURE_DOWNBEAT_SECONDS, durationSeconds: DURATION_SECONDS, sampleRate: SAMPLE_RATE, jitterMs: 5 }), SAMPLE_RATE));
ffmpeg(["-f", "lavfi", "-i", "gradients=s=400x400:c0=0x2a1a6e:c1=0xf2b134:x0=0:y0=0:x1=400:y1=400:d=1", "-frames:v", "1", "art.png"]);
for (const [name, fixture] of Object.entries(FIXTURES)) ffmpeg(["-i", "song.wav", ...fixture.extraInputs, ...fixture.codec, name]);
console.log(JSON.stringify({
  bpm: FIXTURE_BPM,
  downbeatSeconds: FIXTURE_DOWNBEAT_SECONDS,
  tagged: { file: "song.mp3", title: TAGGED_TITLE, artist: TAGGED_ARTIST },
  messyVideo: { file: MESSY_VIDEO_NAME, title: "Night Drive", artist: "Test Artist" },
  files: ["song.wav", ...Object.keys(FIXTURES)],
}));
