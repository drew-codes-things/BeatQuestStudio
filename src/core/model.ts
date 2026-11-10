export const DIFFICULTIES = ["Easy", "Normal", "Hard", "Expert", "ExpertPlus"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

const DIFFICULTY_LABELS: Record<Difficulty, string> = { Easy: "Easy", Normal: "Normal", Hard: "Hard", Expert: "Expert", ExpertPlus: "Expert+" };

export function difficultyLabel(difficulty: Difficulty): string {
  return DIFFICULTY_LABELS[difficulty];
}

export const GRID_COLUMNS = 4;
export const GRID_ROWS = 3;

export type NoteColor = "red" | "blue";

export const CUT_DIRECTIONS = ["up", "down", "left", "right", "upLeft", "upRight", "downLeft", "downRight", "any"] as const;
export type CutDirection = (typeof CUT_DIRECTIONS)[number];

export interface GridPosition {
  x: number;
  y: number;
}

export interface Note extends GridPosition {
  id: string;
  beat: number;
  color: NoteColor;
  direction: CutDirection;
}

export interface Bomb extends GridPosition {
  id: string;
  beat: number;
}

export interface Wall extends GridPosition {
  id: string;
  beat: number;
  durationBeats: number;
  width: number;
  height: number;
}

export interface Arc extends GridPosition {
  id: string;
  beat: number;
  color: NoteColor;
  direction: CutDirection;
  headMultiplier: number;
  tailBeat: number;
  tailX: number;
  tailY: number;
  tailDirection: CutDirection;
  tailMultiplier: number;
}

export interface Chain extends GridPosition {
  id: string;
  beat: number;
  color: NoteColor;
  direction: CutDirection;
  tailBeat: number;
  tailX: number;
  tailY: number;
  segments: number;
  squish: number;
}

export interface Chart {
  notes: Note[];
  bombs: Bomb[];
  walls: Wall[];
  arcs: Arc[];
  chains: Chain[];
}

export interface DifficultySettings {
  noteJumpSpeed: number;
  noteJumpOffset: number;
}

export interface Timing {
  bpm: number;
  offsetSeconds: number;
}

export interface SongInfo {
  title: string;
  subTitle: string;
  artist: string;
  mapper: string;
  fileName: string;
  durationSeconds: number;
  previewStartSeconds: number;
  previewDurationSeconds: number;
  beatDriftMs: number | null;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  song: SongInfo | null;
  timing: Timing;
  charts: Record<Difficulty, Chart>;
  settings: Record<Difficulty, DifficultySettings>;
}

export const DEFAULT_BPM = 120;
export const DEFAULT_PROJECT_NAME = "Untitled map";

export const DEFAULT_SETTINGS: Record<Difficulty, DifficultySettings> = {
  Easy: { noteJumpSpeed: 10, noteJumpOffset: 0 },
  Normal: { noteJumpSpeed: 12, noteJumpOffset: 0 },
  Hard: { noteJumpSpeed: 14, noteJumpOffset: 0 },
  Expert: { noteJumpSpeed: 16, noteJumpOffset: 0 },
  ExpertPlus: { noteJumpSpeed: 18, noteJumpOffset: 0 },
};

export function emptyChart(): Chart {
  return { notes: [], bombs: [], walls: [], arcs: [], chains: [] };
}

export function emptyCharts(): Record<Difficulty, Chart> {
  return Object.fromEntries(DIFFICULTIES.map((difficulty) => [difficulty, emptyChart()])) as Record<Difficulty, Chart>;
}

export function withEveryDifficulty(project: Project): Project {
  const missing = DIFFICULTIES.filter((difficulty) => !project.charts[difficulty] || !project.settings[difficulty]);
  if (missing.length === 0) return project;
  const charts = { ...project.charts };
  const settings = { ...project.settings };
  for (const difficulty of missing) {
    charts[difficulty] ??= emptyChart();
    settings[difficulty] ??= { ...DEFAULT_SETTINGS[difficulty] };
  }
  return { ...project, charts, settings };
}

export function newProject(id: string, name: string, now: number): Project {
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    song: null,
    timing: { bpm: DEFAULT_BPM, offsetSeconds: 0 },
    charts: emptyCharts(),
    settings: structuredClone(DEFAULT_SETTINGS),
  };
}

export function isOnGrid(position: GridPosition): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y) &&
    position.x >= 0 && position.x < GRID_COLUMNS && position.y >= 0 && position.y < GRID_ROWS;
}

export function chartObjectCount(chart: Chart): number {
  return chart.notes.length + chart.bombs.length + chart.walls.length + chart.arcs.length + chart.chains.length;
}
