import { escapeArg, LinuxFileType } from "@yume-chan/adb";
import { CUSTOM_LEVELS_PATH, listCustomLevelsIfPresent, type QuestConnection } from "./usb";

const INFO_FILE_NAME = "info.dat";
const MAX_INFO_BYTES = 1024 * 1024;
const BYTE_ORDER_MARK = /^﻿/;
const UNSAFE_FOLDER_CHARACTER = /[/\0]/;
const DIFFICULTY_ORDER = ["Easy", "Normal", "Hard", "Expert", "ExpertPlus"];
const DIFFICULTY_LABELS: Record<string, string> = { ExpertPlus: "Expert+" };
const STUDIO_ID_LENGTH = 6;

type HeadsetSync = Awaited<ReturnType<QuestConnection["adb"]["sync"]>>;

export interface ParsedInfo {
  title: string;
  subTitle: string;
  artist: string;
  mapper: string;
  bpm: number | null;
  difficulties: string[];
}

export interface InstalledSong extends ParsedInfo {
  folder: string;
  sizeBytes: number;
  problem: string | null;
}

export interface ReadProgress {
  done: number;
  total: number;
}

export interface ReadSongsOptions {
  onProgress: (progress: ReadProgress) => void;
  shouldStop: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function sortedDifficulties(names: Iterable<string>): string[] {
  const unique = [...new Set(names)].filter((name) => name !== "");
  const rank = (name: string) => (DIFFICULTY_ORDER.includes(name) ? DIFFICULTY_ORDER.indexOf(name) : DIFFICULTY_ORDER.length);
  return unique.sort((left, right) => rank(left) - rank(right)).map((name) => DIFFICULTY_LABELS[name] ?? name);
}

function parseOlderLayout(info: Record<string, unknown>): ParsedInfo | null {
  const title = asText(info._songName);
  if (title === "") return null;
  const names = asRecords(info._difficultyBeatmapSets).flatMap((set) => asRecords(set._difficultyBeatmaps).map((beatmap) => asText(beatmap._difficulty)));
  return { title, subTitle: asText(info._songSubName), artist: asText(info._songAuthorName), mapper: asText(info._levelAuthorName), bpm: asNumber(info._beatsPerMinute), difficulties: sortedDifficulties(names) };
}

function parseNewerLayout(info: Record<string, unknown>): ParsedInfo | null {
  const song = isRecord(info.song) ? info.song : null;
  const title = song ? asText(song.title) : "";
  if (!song || title === "") return null;
  const beatmaps = asRecords(info.difficultyBeatmaps);
  const mappers = beatmaps.flatMap((beatmap) => (isRecord(beatmap.beatmapAuthors) && Array.isArray(beatmap.beatmapAuthors.mappers) ? beatmap.beatmapAuthors.mappers.map(asText) : []));
  const audio = isRecord(info.audio) ? info.audio : {};
  return {
    title,
    subTitle: asText(song.subTitle),
    artist: asText(song.author),
    mapper: [...new Set(mappers.filter((name) => name !== ""))].join(", "),
    bpm: asNumber(audio.bpm),
    difficulties: sortedDifficulties(beatmaps.map((beatmap) => asText(beatmap.difficulty))),
  };
}

export function parseInfoDat(text: string): ParsedInfo | null {
  let info: unknown;
  try {
    info = JSON.parse(text.replace(BYTE_ORDER_MARK, ""));
  } catch {
    return null;
  }
  return isRecord(info) ? parseOlderLayout(info) ?? parseNewerLayout(info) : null;
}

async function readText(sync: HeadsetSync, path: string): Promise<string> {
  const reader = sync.read(path).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    total += chunk.value.length;
    if (total > MAX_INFO_BYTES) throw new Error("Info.dat is too large to be a map description");
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function withoutDetails(folder: string, sizeBytes: number, problem: string): InstalledSong {
  return { folder, title: folder, subTitle: "", artist: "", mapper: "", bpm: null, difficulties: [], sizeBytes, problem };
}

async function foldersIfCustomLevelsExists(sync: HeadsetSync): Promise<string[]> {
  try {
    const entries = await sync.readdir(CUSTOM_LEVELS_PATH);
    return entries.filter((entry) => entry.type === LinuxFileType.Directory && entry.name !== "." && entry.name !== "..").map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function readFolder(sync: HeadsetSync, folder: string): Promise<InstalledSong> {
  const path = `${CUSTOM_LEVELS_PATH}/${folder}`;
  let files;
  try {
    files = await sync.readdir(path);
  } catch (cause) {
    return withoutDetails(folder, 0, `its files could not be listed (${reasonOf(cause)})`);
  }
  const sizeBytes = files.filter((file) => file.type === LinuxFileType.File).reduce((total, file) => total + Number(file.size), 0);
  const info = files.find((file) => file.name.toLowerCase() === INFO_FILE_NAME);
  if (!info) return withoutDetails(folder, sizeBytes, "no Info.dat in this folder");
  try {
    const parsed = parseInfoDat(await readText(sync, `${path}/${info.name}`));
    return parsed ? { ...parsed, folder, sizeBytes, problem: null } : withoutDetails(folder, sizeBytes, "Info.dat could not be read as a map description");
  } catch (cause) {
    return withoutDetails(folder, sizeBytes, `Info.dat could not be read (${reasonOf(cause)})`);
  }
}

export async function readInstalledSongs(connection: QuestConnection, options: ReadSongsOptions): Promise<InstalledSong[]> {
  const sync = await connection.adb.sync();
  try {
    const folders = await foldersIfCustomLevelsExists(sync);
    const songs: InstalledSong[] = [];
    for (const [index, folder] of folders.entries()) {
      if (options.shouldStop()) break;
      songs.push(await readFolder(sync, folder));
      options.onProgress({ done: index + 1, total: folders.length });
    }
    return songs;
  } finally {
    await sync.dispose();
  }
}

function assertSafeFolderName(folder: string): void {
  if (folder === "" || folder === "." || folder === ".." || UNSAFE_FOLDER_CHARACTER.test(folder)) {
    throw new Error(`"${folder}" is not a safe folder name to delete from CustomLevels`);
  }
}

export async function deleteInstalledSong(connection: QuestConnection, folder: string): Promise<void> {
  assertSafeFolderName(folder);
  await connection.adb.subprocess.noneProtocol.spawnWaitText(["rm", "-r", escapeArg(`${CUSTOM_LEVELS_PATH}/${folder}`)]);
  if ((await listCustomLevelsIfPresent(connection)).includes(folder)) throw new Error(`"${folder}" is still on the headset after deleting it`);
}

export function matchStudioProject<T extends { id: string }>(folder: string, projects: readonly T[]): T | null {
  return projects.find((project) => folder.startsWith(`${project.id.slice(0, STUDIO_ID_LENGTH)} (`)) ?? null;
}
