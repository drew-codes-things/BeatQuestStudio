import { isSupportedImport } from "../audio/decode";

const MEGABYTE = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;

export const MAX_IMPORT_BYTES = 256 * MEGABYTE;
export const MAX_SONG_SECONDS = 15 * SECONDS_PER_MINUTE;
export const STORAGE_HEADROOM_BYTES = 100 * MEGABYTE;
export const MAX_ZIP_PART_BYTES = 256 * MEGABYTE;
export const BATCH_ITEM_TIMEOUT_MS = 3 * SECONDS_PER_MINUTE * 1000;
export const BATCH_REST_MS = 150;

export interface ImportCandidate {
  name: string;
  type: string;
  size: number;
}

export interface StorageEstimateLike {
  usage?: number;
  quota?: number;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / MEGABYTE);
}

export function importRejection(file: ImportCandidate): string | null {
  if (!isSupportedImport(file.name, file.type)) return `"${file.name}" is not an audio or video file this app can read`;
  if (file.size === 0) return `"${file.name}" is empty`;
  if (file.size > MAX_IMPORT_BYTES) {
    return `"${file.name}" is ${megabytes(file.size)} MB; the limit is ${megabytes(MAX_IMPORT_BYTES)} MB per file so the browser does not run out of memory. Trim it, or save just the audio.`;
  }
  return null;
}

export function songLengthRejection(fileName: string, durationSeconds: number): string | null {
  if (durationSeconds <= MAX_SONG_SECONDS) return null;
  const minutes = Math.round(durationSeconds / SECONDS_PER_MINUTE);
  return `"${fileName}" is ${minutes} minutes long; songs are limited to ${MAX_SONG_SECONDS / SECONDS_PER_MINUTE} minutes.`;
}

export function hasStorageRoom(estimate: StorageEstimateLike, bytesNeeded: number): boolean {
  if (estimate.quota === undefined) return true;
  const free = estimate.quota - (estimate.usage ?? 0);
  return free >= bytesNeeded + STORAGE_HEADROOM_BYTES;
}
