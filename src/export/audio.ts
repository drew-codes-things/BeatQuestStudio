import { mixToMono } from "../audio/analysis";

export const OGG_QUALITY = 5;
const ENCODE_CHUNK_FRAMES = 1 << 16;
const HEADER_SCAN_BYTES = 128;
const OGG_MAGIC = "OggS";
const VORBIS_MARKER = "vorbis";

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function isOggVorbis(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_SCAN_BYTES || asciiAt(bytes, 0, OGG_MAGIC.length) !== OGG_MAGIC) return false;
  return asciiAt(bytes, 0, HEADER_SCAN_BYTES).includes(VORBIS_MARKER);
}

function toEncoderChannels(channels: readonly Float32Array[]): Float32Array[] {
  if (channels.length === 0) throw new Error("audio has no channels to encode");
  if (channels.length <= 2) return [...channels];
  const mono = mixToMono(channels);
  return [mono, mono];
}

export async function encodeOggVorbis(channels: readonly Float32Array[], sampleRate: number): Promise<Uint8Array> {
  const { createOggEncoder } = await import("wasm-media-encoders");
  const encoder = await createOggEncoder();
  const input = toEncoderChannels(channels);
  encoder.configure({ channels: input.length as 1 | 2, sampleRate, vbrQuality: OGG_QUALITY });
  const parts: Uint8Array[] = [];
  const frames = input[0]!.length;
  for (let start = 0; start < frames; start += ENCODE_CHUNK_FRAMES) {
    const end = Math.min(frames, start + ENCODE_CHUNK_FRAMES);
    parts.push(encoder.encode(input.map((channel) => channel.subarray(start, end))).slice());
  }
  parts.push(encoder.finalize().slice());
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
