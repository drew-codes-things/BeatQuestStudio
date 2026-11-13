import type { Chart, CutDirection, Difficulty, NoteColor, Project, Timing } from "../core/model";
import { DIFFICULTIES, chartObjectCount, isHexColor } from "../core/model";
import { secondsPerBeat } from "../core/timing";

export const INFO_VERSION = "2.1.0";
export const DIFFICULTY_VERSION = "3.3.0";
export const CHARACTERISTIC = "Standard";
export const SONG_FILE_NAME = "song.egg";
export const ENVIRONMENT = "DefaultEnvironment";
const ALL_DIRECTIONS_ENVIRONMENT = "GlassDesertEnvironment";
const BEAT_PRECISION = 10000;
const DEFAULT_SHUFFLE_PERIOD = 0.5;
const BEATS_PER_BAR = 4;
export const COLOR_SCHEME_ID = "BeatQuest Studio";
const CHANNEL_MAX = 255;

export const DIFFICULTY_RANKS: Record<Difficulty, number> = { Easy: 1, Normal: 3, Hard: 5, Expert: 7, ExpertPlus: 9 };

const CUT_DIRECTION_CODES: Record<CutDirection, number> = {
  up: 0,
  down: 1,
  left: 2,
  right: 3,
  upLeft: 4,
  upRight: 5,
  downLeft: 6,
  downRight: 7,
  any: 8,
};

const COLOR_CODES: Record<NoteColor, number> = { red: 0, blue: 1 };

const LIGHT_BACK_LASERS = 0;
const LIGHT_RING = 1;
const LIGHT_LEFT_LASERS = 2;
const LIGHT_RIGHT_LASERS = 3;
const LIGHT_CENTER = 4;
const LIGHT_BLUE_ON = 1;
const LIGHT_BLUE_FLASH = 2;
const LIGHT_RED_ON = 5;
const LIGHT_RED_FLASH = 6;

export function difficultyFileName(difficulty: Difficulty): string {
  return `${difficulty}${CHARACTERISTIC}.dat`;
}

export function exportBeat(beat: number, timing: Timing): number {
  return Math.round((beat + timing.offsetSeconds / secondsPerBeat(timing)) * BEAT_PRECISION) / BEAT_PRECISION;
}

interface BasicEvent {
  b: number;
  et: number;
  i: number;
  f: number;
}

function lightShow(chart: Chart, timing: Timing): BasicEvent[] {
  const events: BasicEvent[] = [
    { b: 0, et: LIGHT_CENTER, i: LIGHT_BLUE_ON, f: 1 },
    { b: 0, et: LIGHT_RING, i: LIGHT_RED_ON, f: 1 },
  ];
  const bars = new Set(chart.notes.map((note) => Math.floor(note.beat / BEATS_PER_BAR)));
  for (const bar of [...bars].sort((left, right) => left - right)) {
    const beat = exportBeat(bar * BEATS_PER_BAR, timing);
    const red = bar % 2 === 0;
    events.push({ b: beat, et: LIGHT_BACK_LASERS, i: red ? LIGHT_RED_FLASH : LIGHT_BLUE_FLASH, f: 1 });
    events.push({ b: beat, et: red ? LIGHT_LEFT_LASERS : LIGHT_RIGHT_LASERS, i: red ? LIGHT_RED_ON : LIGHT_BLUE_ON, f: 1 });
  }
  return events.sort((left, right) => left.b - right.b);
}

export function buildDifficulty(chart: Chart, timing: Timing): Record<string, unknown> {
  const at = (beat: number) => exportBeat(beat, timing);
  return {
    version: DIFFICULTY_VERSION,
    bpmEvents: [],
    rotationEvents: [],
    colorNotes: chart.notes.map((note) => ({ b: at(note.beat), x: note.x, y: note.y, a: 0, c: COLOR_CODES[note.color], d: CUT_DIRECTION_CODES[note.direction] })),
    bombNotes: chart.bombs.map((bomb) => ({ b: at(bomb.beat), x: bomb.x, y: bomb.y })),
    obstacles: chart.walls.map((wall) => ({ b: at(wall.beat), x: wall.x, y: wall.y, d: wall.durationBeats, w: wall.width, h: wall.height })),
    sliders: chart.arcs.map((arc) => ({
      b: at(arc.beat), c: COLOR_CODES[arc.color], x: arc.x, y: arc.y, d: CUT_DIRECTION_CODES[arc.direction], mu: arc.headMultiplier,
      tb: at(arc.tailBeat), tx: arc.tailX, ty: arc.tailY, tc: CUT_DIRECTION_CODES[arc.tailDirection], tmu: arc.tailMultiplier, m: 0,
    })),
    burstSliders: chart.chains.map((chain) => ({
      b: at(chain.beat), c: COLOR_CODES[chain.color], x: chain.x, y: chain.y, d: CUT_DIRECTION_CODES[chain.direction],
      tb: at(chain.tailBeat), tx: chain.tailX, ty: chain.tailY, sc: chain.segments, s: chain.squish,
    })),
    waypoints: [],
    basicBeatmapEvents: lightShow(chart, timing),
    colorBoostBeatmapEvents: [],
    lightColorEventBoxGroups: [],
    lightRotationEventBoxGroups: [],
    lightTranslationEventBoxGroups: [],
    vfxEventBoxGroups: [],
    _fxEventsCollection: { _fl: [], _il: [] },
    basicEventTypesWithKeywords: { d: [] },
    useNormalEventsAsCompatibleEvents: true,
  };
}

export function exportedDifficulties(project: Project): Difficulty[] {
  return DIFFICULTIES.filter((difficulty) => chartObjectCount(project.charts[difficulty]) > 0);
}

interface GameColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function gameColor(hex: string): GameColor {
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / CHANNEL_MAX;
  return { r: channel(1), g: channel(3), b: channel(5), a: 1 };
}

export function colorSchemes(project: Project): unknown[] {
  const colors = project.saberColors;
  if (!colors || !isHexColor(colors.left) || !isHexColor(colors.right)) return [];
  const left = gameColor(colors.left);
  const right = gameColor(colors.right);
  return [{
    useOverride: true,
    colorScheme: {
      colorSchemeId: COLOR_SCHEME_ID,
      saberAColor: left,
      saberBColor: right,
      environmentColor0: left,
      environmentColor1: right,
      obstaclesColor: left,
      environmentColor0Boost: left,
      environmentColor1Boost: right,
    },
  }];
}

export function buildInfo(project: Project, coverFileName: string): Record<string, unknown> {
  if (!project.song) throw new Error("cannot build Info.dat without a song");
  const song = project.song;
  return {
    _version: INFO_VERSION,
    _songName: song.title.trim() || project.name,
    _songSubName: song.subTitle,
    _songAuthorName: song.artist,
    _levelAuthorName: song.mapper,
    _beatsPerMinute: project.timing.bpm,
    _songTimeOffset: 0,
    _shuffle: 0,
    _shufflePeriod: DEFAULT_SHUFFLE_PERIOD,
    _previewStartTime: song.previewStartSeconds,
    _previewDuration: song.previewDurationSeconds,
    _songFilename: SONG_FILE_NAME,
    _coverImageFilename: coverFileName,
    _environmentName: ENVIRONMENT,
    _allDirectionsEnvironmentName: ALL_DIRECTIONS_ENVIRONMENT,
    _environmentNames: [ENVIRONMENT],
    _colorSchemes: colorSchemes(project),
    _difficultyBeatmapSets: [{
      _beatmapCharacteristicName: CHARACTERISTIC,
      _difficultyBeatmaps: exportedDifficulties(project).map((difficulty) => ({
        _difficulty: difficulty,
        _difficultyRank: DIFFICULTY_RANKS[difficulty],
        _beatmapFilename: difficultyFileName(difficulty),
        _noteJumpMovementSpeed: project.settings[difficulty].noteJumpSpeed,
        _noteJumpStartBeatOffset: project.settings[difficulty].noteJumpOffset,
        _beatmapColorSchemeIdx: 0,
        _environmentNameIdx: 0,
      })),
    }],
  };
}

const UNSAFE_FOLDER_CHARACTERS = /[^\p{L}\p{N} ()._,&+!-]/gu;
const MAX_FOLDER_PART_LENGTH = 60;
const MAX_FOLDER_NAME_BYTES = 255;
const ENDS_WITH_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

function cutWithoutSplittingCharacters(text: string, maxLength: number): string {
  const cut = text.slice(0, maxLength);
  return ENDS_WITH_HIGH_SURROGATE.test(cut) ? cut.slice(0, -1) : cut;
}

function safePart(text: string, fallback: string): string {
  const cleaned = text.replace(UNSAFE_FOLDER_CHARACTERS, "").replace(/\s+/g, " ").trim();
  return cutWithoutSplittingCharacters(cleaned, MAX_FOLDER_PART_LENGTH).replace(/[. ]+$/, "") || fallback;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function withoutLastCharacter(text: string): string {
  return Array.from(text).slice(0, -1).join("");
}

export function mapFolderName(project: Project): string {
  const prefix = project.id.slice(0, 6);
  let title = safePart(project.song?.title || project.name, "Untitled");
  let mapper = safePart(project.song?.mapper ?? "", "Unknown");
  while (utf8Length(`${prefix} (${title} - ${mapper})`) > MAX_FOLDER_NAME_BYTES) {
    if (utf8Length(title) >= utf8Length(mapper)) title = withoutLastCharacter(title);
    else mapper = withoutLastCharacter(mapper);
  }
  return `${prefix} (${title} - ${mapper})`;
}
