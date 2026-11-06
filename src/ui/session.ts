import type { SongAnalysis, WaveformPeaks } from "../audio/analysis";
import { SongPlayer } from "../audio/player";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import { decodeAndAnalyse, type DecodedSong, readSongFile } from "../import/songImport";
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

function sessionFrom(context: AudioContext, decoded: DecodedSong): SongSession {
  return { buffer: decoded.buffer, analysis: decoded.analysis, peaks: decoded.peaks, player: new SongPlayer(context, decoded.buffer) };
}

export async function openSession(bytes: ArrayBuffer, fileName: string, worker: AudioWorkerClient): Promise<SongSession> {
  const context = audioContext();
  return sessionFrom(context, await decodeAndAnalyse(context, bytes, fileName, worker));
}

export async function importSongFile(file: File, worker: AudioWorkerClient): Promise<ImportedSong> {
  const context = audioContext();
  const read = await readSongFile(file, context, worker);
  return { audio: read.audio, session: sessionFrom(context, read), strippedFromVideo: read.strippedFromVideo };
}
