import type { SongAnalysis, WaveformPeaks } from "../audio/analysis";
import { audioBufferChannels, decodeAudio, isSupportedImport, isVideoFile, strippedAudioName } from "../audio/decode";
import { SongPlayer } from "../audio/player";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import type { StoredAudio } from "../storage/projectStore";

export interface SongSession {
  buffer: AudioBuffer;
  analysis: SongAnalysis;
  peaks: WaveformPeaks;
  player: SongPlayer;
}

export interface ImportedSong {
  audio: Omit<StoredAudio, "projectId">;
  session: SongSession;
  strippedFromVideo: boolean;
}

let sharedContext: AudioContext | null = null;

export function audioContext(): AudioContext {
  sharedContext ??= new AudioContext();
  return sharedContext;
}

export async function openSession(bytes: ArrayBuffer, fileName: string, worker: AudioWorkerClient): Promise<SongSession> {
  const context = audioContext();
  const buffer = await decodeAudio(context, bytes, fileName);
  const { analysis, peaks } = await worker.analyse(audioBufferChannels(buffer), buffer.sampleRate);
  return { buffer, analysis, peaks, player: new SongPlayer(context, buffer) };
}

export async function importSongFile(file: File, worker: AudioWorkerClient): Promise<ImportedSong> {
  if (!isSupportedImport(file.name, file.type)) throw new Error(`"${file.name}" is not an audio or video file this app can read.`);
  const bytes = await file.arrayBuffer();
  const session = await openSession(bytes, file.name, worker);
  if (!isVideoFile(file.name, file.type)) {
    return { audio: { fileName: file.name, mimeType: file.type || "application/octet-stream", bytes }, session, strippedFromVideo: false };
  }
  const ogg = await worker.encodeOgg(audioBufferChannels(session.buffer), session.buffer.sampleRate);
  const oggBytes = ogg.buffer.slice(ogg.byteOffset, ogg.byteOffset + ogg.byteLength) as ArrayBuffer;
  return { audio: { fileName: strippedAudioName(file.name), mimeType: "audio/ogg", bytes: oggBytes }, session, strippedFromVideo: true };
}

export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[_]+/g, " ").trim();
}
