import { zipSync } from "fflate";
import type { Project } from "../core/model";
import { buildDifficulty, buildInfo, difficultyFileName, exportedDifficulties, SONG_FILE_NAME } from "./beatmap";

export interface CoverImage {
  fileName: string;
  bytes: Uint8Array;
}

export type MapFiles = Record<string, Uint8Array>;

const JSON_INDENT = 2;

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, JSON_INDENT));
}

export function coverFileNameFor(original: string): string {
  return original.toLowerCase().endsWith(".jpg") || original.toLowerCase().endsWith(".jpeg") ? "cover.jpg" : "cover.png";
}

export function buildMapFiles(project: Project, song: Uint8Array, cover: CoverImage): MapFiles {
  const difficulties = exportedDifficulties(project);
  if (difficulties.length === 0) throw new Error("there is nothing to export: every difficulty is empty");
  const files: MapFiles = {
    "Info.dat": jsonBytes(buildInfo(project, cover.fileName)),
    [SONG_FILE_NAME]: song,
    [cover.fileName]: cover.bytes,
  };
  for (const difficulty of difficulties) files[difficultyFileName(difficulty)] = jsonBytes(buildDifficulty(project.charts[difficulty], project.timing));
  return files;
}

export function zipMapFiles(files: MapFiles): Uint8Array {
  return zipSync(files, { level: 6 });
}
