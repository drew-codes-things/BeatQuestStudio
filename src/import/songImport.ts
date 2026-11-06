import type { SongAnalysis, WaveformPeaks } from "../audio/analysis";
import { audioBufferChannels, decodeAudio, isVideoFile, strippedAudioName } from "../audio/decode";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import { importRejection, songLengthRejection } from "../batch/limits";
import type { Project } from "../core/model";
import type { StoredAudio } from "../storage/projectStore";

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
}

export interface ImportedSongDetails {
  storedFileName: string;
  sourceName: string;
  analysis: SongAnalysis;
}

export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[_]+/g, " ").trim();
}

export async function decodeAndAnalyse(context: BaseAudioContext, bytes: ArrayBuffer, fileName: string, worker: AudioWorkerClient): Promise<DecodedSong> {
  const buffer = await decodeAudio(context, bytes, fileName);
  const { analysis, peaks } = await worker.analyse(audioBufferChannels(buffer), buffer.sampleRate);
  return { buffer, analysis, peaks };
}

export async function readSongFile(file: File, context: BaseAudioContext, worker: AudioWorkerClient): Promise<ReadSong> {
  const rejection = importRejection(file);
  if (rejection) throw new Error(rejection);
  const bytes = await file.arrayBuffer();
  const buffer = await decodeAudio(context, bytes, file.name);
  const tooLong = songLengthRejection(file.name, buffer.duration);
  if (tooLong) throw new Error(tooLong);
  const { analysis, peaks } = await worker.analyse(audioBufferChannels(buffer), buffer.sampleRate);
  if (!isVideoFile(file.name, file.type)) {
    return { buffer, analysis, peaks, audio: { fileName: file.name, mimeType: file.type || UNKNOWN_MIME_TYPE, bytes }, strippedFromVideo: false };
  }
  const ogg = await worker.encodeOgg(audioBufferChannels(buffer), buffer.sampleRate);
  const oggBytes = ogg.buffer.slice(ogg.byteOffset, ogg.byteOffset + ogg.byteLength) as ArrayBuffer;
  return { buffer, analysis, peaks, audio: { fileName: strippedAudioName(file.name), mimeType: OGG_MIME_TYPE, bytes: oggBytes }, strippedFromVideo: true };
}

export function withImportedSong(project: Project, details: ImportedSongDetails, now: number): Project {
  const { analysis } = details;
  return {
    ...project,
    updatedAt: now,
    timing: { bpm: analysis.tempo.bpm, offsetSeconds: analysis.tempo.offsetSeconds },
    song: {
      title: project.song?.title || titleFromFileName(details.sourceName),
      subTitle: project.song?.subTitle ?? "",
      artist: project.song?.artist ?? "",
      mapper: project.song?.mapper ?? "",
      fileName: details.storedFileName,
      durationSeconds: analysis.durationSeconds,
      previewStartSeconds: Math.round(analysis.durationSeconds * PREVIEW_POSITION),
      previewDurationSeconds: DEFAULT_PREVIEW_SECONDS,
      beatDriftMs: analysis.tempo.driftMs,
    },
  };
}
