import { audioBufferChannels } from "../audio/decode";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import type { Project } from "../core/model";
import type { ProjectStore, StoredAudio } from "../storage/projectStore";
import { isOggVorbis } from "./audio";
import { generateCoverPng } from "./cover";
import { buildMapFiles, coverFileNameFor, type MapFiles } from "./package";

export type SongBufferLoader = (stored: StoredAudio) => Promise<AudioBuffer>;

export async function prepareMapFiles(project: Project, store: ProjectStore, loadSongBuffer: SongBufferLoader, worker: AudioWorkerClient): Promise<MapFiles> {
  if (!project.song) throw new Error("import a song before exporting");
  const stored = await store.loadAudio(project.id);
  if (!stored) throw new Error("the song file for this project is missing; import it again");
  const original = new Uint8Array(stored.bytes);
  let song = original;
  if (!isOggVorbis(original)) {
    const buffer = await loadSongBuffer(stored);
    song = await worker.encodeOgg(audioBufferChannels(buffer), buffer.sampleRate);
  }
  const storedCover = await store.loadCover(project.id);
  const cover = storedCover
    ? { fileName: coverFileNameFor(storedCover.fileName), bytes: new Uint8Array(storedCover.bytes) }
    : { fileName: "cover.png", bytes: await generateCoverPng(project.song.title || project.name, project.song.artist) };
  return buildMapFiles(project, song, cover);
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
