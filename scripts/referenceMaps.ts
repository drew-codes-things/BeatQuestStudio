import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUT_DIRECTIONS, DIFFICULTIES, type Difficulty, type Note, type NoteColor } from "../src/core/model";

export interface ReferenceMap {
  folder: string;
  bpm: number;
  songPath: string | null;
  hasTempoChanges: boolean;
  charts: Partial<Record<Difficulty, Note[]>>;
}

interface RawNote {
  beat: number;
  x: number;
  y: number;
  colorCode: number;
  directionCode: number;
}

const COLORS: Record<number, NoteColor> = { 0: "red", 1: "blue" };
const GRID_LIMITS = { maxX: 3, maxY: 2, maxDirection: CUT_DIRECTIONS.length - 1 };

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
}

function rawNotes(chart: Record<string, unknown>): RawNote[] {
  if (Array.isArray(chart.colorNotes)) {
    return (chart.colorNotes as Record<string, number>[]).map((note) => ({
      beat: note.b ?? 0, x: note.x ?? 0, y: note.y ?? 0, colorCode: note.c ?? 0, directionCode: note.d ?? 0,
    }));
  }
  if (Array.isArray(chart._notes)) {
    return (chart._notes as Record<string, number>[]).map((note) => ({
      beat: note._time ?? 0, x: note._lineIndex ?? 0, y: note._lineLayer ?? 0, colorCode: note._type ?? -1, directionCode: note._cutDirection ?? 0,
    }));
  }
  return [];
}

function isPlayable(note: RawNote): boolean {
  return note.colorCode in COLORS
    && note.x >= 0 && note.x <= GRID_LIMITS.maxX
    && note.y >= 0 && note.y <= GRID_LIMITS.maxY
    && note.directionCode >= 0 && note.directionCode <= GRID_LIMITS.maxDirection;
}

function toNotes(chart: Record<string, unknown>): Note[] {
  return rawNotes(chart).filter(isPlayable).map((note, index) => ({
    id: `n${index}`,
    beat: note.beat,
    x: note.x,
    y: note.y,
    color: COLORS[note.colorCode]!,
    direction: CUT_DIRECTIONS[note.directionCode]!,
  })).sort((left, right) => left.beat - right.beat);
}

function hasTempoChanges(chart: Record<string, unknown>): boolean {
  const v3Changes = Array.isArray(chart.bpmEvents) && chart.bpmEvents.length > 1;
  const v2Changes = Array.isArray(chart._BPMChanges) && chart._BPMChanges.length > 0;
  return v3Changes || v2Changes;
}

function findFile(files: readonly string[], name: string): string | undefined {
  return files.find((file) => file.toLowerCase() === name.toLowerCase());
}

export function readReferenceMap(folder: string): ReferenceMap | null {
  const files = readdirSync(folder);
  const infoFile = findFile(files, "Info.dat");
  if (!infoFile) return null;
  const info = readJson(join(folder, infoFile));
  const songFile = typeof info._songFilename === "string" ? findFile(files, info._songFilename) : undefined;
  const sets = (info._difficultyBeatmapSets ?? []) as { _beatmapCharacteristicName: string; _difficultyBeatmaps: { _difficulty: string; _beatmapFilename: string }[] }[];
  const standard = sets.find((set) => set._beatmapCharacteristicName === "Standard");
  if (!standard) return null;
  const charts: Partial<Record<Difficulty, Note[]>> = {};
  let tempoChanges = false;
  for (const entry of standard._difficultyBeatmaps) {
    const difficulty = DIFFICULTIES.find((name) => name === entry._difficulty);
    const chartFile = findFile(files, entry._beatmapFilename);
    if (!difficulty || !chartFile) continue;
    try {
      const chart = readJson(join(folder, chartFile));
      charts[difficulty] = toNotes(chart);
      tempoChanges ||= hasTempoChanges(chart);
    } catch (cause) {
      throw new Error(`could not read ${chartFile} in ${folder}: ${(cause as Error).message}`);
    }
  }
  return {
    folder,
    bpm: Number(info._beatsPerMinute),
    songPath: songFile ? join(folder, songFile) : null,
    hasTempoChanges: tempoChanges,
    charts,
  };
}

export function readReferenceMaps(root: string): ReferenceMap[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readReferenceMap(join(root, entry.name)))
    .filter((map): map is ReferenceMap => map !== null);
}
