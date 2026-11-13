import type { SongAnalysis, WaveformPeaks } from "../audio/analysis";
import { audioBufferChannels, decodeAudio, isVideoFile, strippedAudioName } from "../audio/decode";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import { importRejection, songLengthRejection } from "../batch/limits";
import { DEFAULT_PROJECT_NAME, type Project } from "../core/model";
import { AUTO_COVER_FILE_NAME, makeAutoCover } from "../export/cover";
import type { ProjectStore, StoredAudio } from "../storage/projectStore";
import { readSongDurationSeconds, readSongTags, type SongIdentity, songIdentity, type SongTags } from "./songIdentity";

const DEFAULT_PREVIEW_SECONDS = 10;
const PREVIEW_POSITION = 0.4;
const OGG_MIME_TYPE = "audio/ogg";
const UNKNOWN_MIME_TYPE = "application/octet-stream";

export interface DecodedSong {
  buffer: AudioBuffer;
  analysis: SongAnalysis;
  peaks: WaveformPeaks;
}

export interface ReadSong extends DecodedSong {
  audio: Omit<StoredAudio, "projectId">;
  strippedFromVideo: boolean;
  tags: SongTags;
  identity: SongIdentity;
}

export interface ImportedSongDetails {
  storedFileName: string;
  identity: SongIdentity;
  analysis: SongAnalysis;
}

export async function decodeAndAnalyse(context: BaseAudioContext, bytes: ArrayBuffer, fileName: string, worker: AudioWorkerClient): Promise<DecodedSong> {
  const buffer = await decodeAudio(context, bytes, fileName);
  const { analysis, peaks } = await worker.analyse(audioBufferChannels(buffer), buffer.sampleRate);
  return { buffer, analysis, peaks };
}

async function lengthRejectionBeforeDecoding(file: File): Promise<string | null> {
  const declaredSeconds = await readSongDurationSeconds(file);
  return declaredSeconds === null ? null : songLengthRejection(file.name, declaredSeconds);
}

export async function readSongFile(file: File, context: BaseAudioContext, worker: AudioWorkerClient): Promise<ReadSong> {
  const rejection = importRejection(file) ?? (await lengthRejectionBeforeDecoding(file));
  if (rejection) throw new Error(rejection);
  const tags = await readSongTags(file);
  const identity = songIdentity(tags, file.name);
  const bytes = await file.arrayBuffer();
  const buffer = await decodeAudio(context, bytes, file.name);
  const tooLong = songLengthRejection(file.name, buffer.duration);
  if (tooLong) throw new Error(tooLong);
  const { analysis, peaks } = await worker.analyse(audioBufferChannels(buffer), buffer.sampleRate);
  if (!isVideoFile(file.name, file.type)) {
    return { buffer, analysis, peaks, tags, identity, audio: { fileName: file.name, mimeType: file.type || UNKNOWN_MIME_TYPE, bytes }, strippedFromVideo: false };
  }
  const ogg = await worker.encodeOgg(audioBufferChannels(buffer), buffer.sampleRate);
  const oggBytes = ogg.buffer.slice(ogg.byteOffset, ogg.byteOffset + ogg.byteLength) as ArrayBuffer;
  return { buffer, analysis, peaks, tags, identity, audio: { fileName: strippedAudioName(file.name), mimeType: OGG_MIME_TYPE, bytes: oggBytes }, strippedFromVideo: true };
}

export function withImportedSong(project: Project, details: ImportedSongDetails, now: number): Project {
  const { analysis, identity } = details;
  return {
    ...project,
    name: project.name === DEFAULT_PROJECT_NAME ? identity.title : project.name,
    updatedAt: now,
    timing: { bpm: analysis.tempo.bpm, offsetSeconds: analysis.tempo.offsetSeconds },
    song: {
      title: project.song?.title || identity.title,
      subTitle: project.song?.subTitle ?? "",
      artist: project.song?.artist || identity.artist,
      mapper: project.song?.mapper ?? "",
      fileName: details.storedFileName,
      durationSeconds: analysis.durationSeconds,
      previewStartSeconds: Math.round(analysis.durationSeconds * PREVIEW_POSITION),
      previewDurationSeconds: DEFAULT_PREVIEW_SECONDS,
      beatDriftMs: analysis.tempo.driftMs,
    },
  };
}

export async function storeAutoCover(store: ProjectStore, projectId: string, song: Pick<ReadSong, "tags" | "identity">): Promise<boolean> {
  const existing = await store.loadCover(projectId);
  if (existing && existing.fileName !== AUTO_COVER_FILE_NAME) return false;
  const bytes = await makeAutoCover(song.tags.picture, song.identity.title, song.identity.artist);
  await store.saveCover({ projectId, fileName: AUTO_COVER_FILE_NAME, mimeType: "image/png", bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  return true;
}
