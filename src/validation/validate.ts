import { allObjects, BEAT_EPSILON, type ChartObject, MAX_WALL_HEIGHT, objectEndBeat } from "../core/edit";
import {
  type Chart,
  chartObjectCount,
  type CutDirection,
  DIFFICULTIES,
  difficultyLabel,
  type Difficulty,
  type DifficultySettings,
  GRID_COLUMNS,
  GRID_ROWS,
  type Note,
  type Project,
  type Wall,
} from "../core/model";
import { beatToSeconds, validateBpm } from "../core/timing";
import { DIFFICULTY_PROFILES } from "../generator/profiles";

export type Severity = "error" | "warning";

export interface Issue {
  code: string;
  severity: Severity;
  difficulty: Difficulty | null;
  beat: number | null;
  message: string;
  objectIds: string[];
}

const MIN_NOTE_JUMP_SPEED = 1;
const MAX_NOTE_JUMP_SPEED = 30;
const MIN_CHAIN_SEGMENTS = 2;
const FAST_GAP_FACTOR = 0.5;
const EARLY_OBJECT_SECONDS = 1;
export const DRIFT_WARNING_MS = 25;

const DOWN_SWINGS: ReadonlySet<CutDirection> = new Set(["down", "downLeft", "downRight"]);
const UP_SWINGS: ReadonlySet<CutDirection> = new Set(["up", "upLeft", "upRight"]);

function issue(code: string, severity: Severity, difficulty: Difficulty | null, beat: number | null, message: string, objectIds: string[] = []): Issue {
  return { code, severity, difficulty, beat, message, objectIds };
}

function formatBeat(beat: number): string {
  return Number.isInteger(beat) ? String(beat) : beat.toFixed(3).replace(/0+$/, "");
}

function isWholeIn(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

function cellsOf(object: ChartObject): [number, number][] {
  const cells: [number, number][] = [[object.x, object.y]];
  if ("tailX" in object) cells.push([object.tailX, object.tailY]);
  return cells;
}

function checkPositions(chart: Chart, difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  for (const object of allObjects(chart)) {
    if ("width" in object) continue;
    const offGrid = cellsOf(object).some(([x, y]) => !isWholeIn(x, 0, GRID_COLUMNS - 1) || !isWholeIn(y, 0, GRID_ROWS - 1));
    if (offGrid) issues.push(issue("off-grid", "error", difficulty, object.beat, `Object at beat ${formatBeat(object.beat)} is outside the 4 x 3 grid.`, [object.id]));
  }
  return issues;
}

function checkWalls(walls: readonly Wall[], difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  for (const wall of walls) {
    const at = `Wall at beat ${formatBeat(wall.beat)}`;
    if (!(wall.durationBeats > 0)) issues.push(issue("wall-duration", "error", difficulty, wall.beat, `${at} has no length.`, [wall.id]));
    const fitsAcross = isWholeIn(wall.x, 0, GRID_COLUMNS - 1) && isWholeIn(wall.width, 1, GRID_COLUMNS) && wall.x + wall.width <= GRID_COLUMNS;
    if (!fitsAcross) issues.push(issue("wall-width", "error", difficulty, wall.beat, `${at} does not fit across the grid.`, [wall.id]));
    const fitsUp = isWholeIn(wall.y, 0, GRID_ROWS - 1) && isWholeIn(wall.height, 1, MAX_WALL_HEIGHT);
    if (!fitsUp) issues.push(issue("wall-height", "error", difficulty, wall.beat, `${at} has an invalid row or height.`, [wall.id]));
  }
  return issues;
}

function checkSongBounds(chart: Chart, difficulty: Difficulty, project: Project): Issue[] {
  if (!project.song) return [];
  const issues: Issue[] = [];
  for (const object of allObjects(chart)) {
    const start = beatToSeconds(object.beat, project.timing);
    const end = beatToSeconds(objectEndBeat(object), project.timing);
    if (start < 0) issues.push(issue("before-song", "error", difficulty, object.beat, `Object at beat ${formatBeat(object.beat)} is before the song starts.`, [object.id]));
    else if (start < EARLY_OBJECT_SECONDS) issues.push(issue("too-early", "warning", difficulty, object.beat, `Object at beat ${formatBeat(object.beat)} arrives in the first second, before the player can react.`, [object.id]));
    else if (end > project.song.durationSeconds) issues.push(issue("after-song", "error", difficulty, object.beat, `Object at beat ${formatBeat(object.beat)} runs past the end of the song.`, [object.id]));
  }
  return issues;
}

function checkStacked(chart: Chart, difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, ChartObject>();
  for (const object of [...chart.notes, ...chart.bombs]) {
    const key = `${Math.round(object.beat / BEAT_EPSILON)}:${object.x}:${object.y}`;
    const earlier = seen.get(key);
    if (earlier) issues.push(issue("stacked", "error", difficulty, object.beat, `Two objects share column ${object.x + 1}, row ${object.y + 1} at beat ${formatBeat(object.beat)}.`, [earlier.id, object.id]));
    else seen.set(key, object);
  }
  return issues;
}

function wallCovers(wall: Wall, note: { beat: number; x: number; y: number }): boolean {
  const inTime = note.beat >= wall.beat - BEAT_EPSILON && note.beat <= wall.beat + wall.durationBeats + BEAT_EPSILON;
  const inColumns = note.x >= wall.x && note.x < wall.x + wall.width;
  const inRows = note.y >= wall.y && note.y < wall.y + wall.height;
  return inTime && inColumns && inRows;
}

function checkInsideWalls(chart: Chart, difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  for (const target of [...chart.notes, ...chart.bombs]) {
    const wall = chart.walls.find((candidate) => wallCovers(candidate, target));
    if (wall) issues.push(issue("inside-wall", "error", difficulty, target.beat, `Object at beat ${formatBeat(target.beat)} is inside a wall.`, [target.id, wall.id]));
  }
  return issues;
}

function checkVisionBlocks(notes: readonly Note[], difficulty: Difficulty): Issue[] {
  return notes
    .filter((note) => note.y === 1 && (note.x === 1 || note.x === 2))
    .map((note) => issue("vision-block", "warning", difficulty, note.beat, `Note at beat ${formatBeat(note.beat)} sits in the middle of the grid and can hide the notes behind it.`, [note.id]));
}

function checkCrossovers(notes: readonly Note[], difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  const reds = notes.filter((note) => note.color === "red");
  for (const blue of notes.filter((note) => note.color === "blue")) {
    const crossing = reds.find((red) => Math.abs(red.beat - blue.beat) < BEAT_EPSILON && red.x > blue.x);
    if (crossing) issues.push(issue("crossover", "warning", difficulty, blue.beat, `Red and blue notes cross over at beat ${formatBeat(blue.beat)}.`, [crossing.id, blue.id]));
  }
  return issues;
}

function swingOf(direction: CutDirection): "down" | "up" | null {
  if (DOWN_SWINGS.has(direction)) return "down";
  if (UP_SWINGS.has(direction)) return "up";
  return null;
}

function firstPerBeat(notes: readonly Note[]): Note[] {
  const result: Note[] = [];
  for (const note of notes) {
    const previous = result[result.length - 1];
    if (previous && Math.abs(previous.beat - note.beat) < BEAT_EPSILON) continue;
    result.push(note);
  }
  return result;
}

function checkHandFlow(notes: readonly Note[], difficulty: Difficulty): Issue[] {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const issues: Issue[] = [];
  for (const color of ["red", "blue"] as const) {
    const hand = firstPerBeat(notes.filter((note) => note.color === color));
    for (let index = 1; index < hand.length; index += 1) {
      const previous = hand[index - 1]!;
      const current = hand[index]!;
      const gap = current.beat - previous.beat;
      const previousSwing = swingOf(previous.direction);
      const currentSwing = swingOf(current.direction);
      if (previousSwing && previousSwing === currentSwing && gap < profile.restResetBeats) {
        issues.push(issue("parity", "warning", difficulty, current.beat, `${color === "red" ? "Red" : "Blue"} hand swings ${currentSwing} twice in a row at beat ${formatBeat(current.beat)} without time to reset.`, [previous.id, current.id]));
      }
      if (gap < profile.minSameHandGapBeats * FAST_GAP_FACTOR) {
        issues.push(issue("too-fast", "warning", difficulty, current.beat, `${color === "red" ? "Red" : "Blue"} notes ${formatBeat(gap)} beats apart at beat ${formatBeat(current.beat)} are very fast for ${difficultyLabel(difficulty)}.`, [previous.id, current.id]));
      }
    }
  }
  return issues;
}

function checkSliders(chart: Chart, difficulty: Difficulty): Issue[] {
  const issues: Issue[] = [];
  for (const arc of chart.arcs) {
    if (arc.tailBeat <= arc.beat) issues.push(issue("arc-length", "error", difficulty, arc.beat, `Arc at beat ${formatBeat(arc.beat)} must end after it starts.`, [arc.id]));
  }
  for (const chain of chart.chains) {
    if (chain.tailBeat < chain.beat) issues.push(issue("chain-length", "error", difficulty, chain.beat, `Chain at beat ${formatBeat(chain.beat)} ends before it starts.`, [chain.id]));
    if (!Number.isInteger(chain.segments) || chain.segments < MIN_CHAIN_SEGMENTS) issues.push(issue("chain-segments", "error", difficulty, chain.beat, `Chain at beat ${formatBeat(chain.beat)} needs at least ${MIN_CHAIN_SEGMENTS} segments.`, [chain.id]));
  }
  return issues;
}

function checkSettings(settings: DifficultySettings, difficulty: Difficulty): Issue[] {
  if (settings.noteJumpSpeed >= MIN_NOTE_JUMP_SPEED && settings.noteJumpSpeed <= MAX_NOTE_JUMP_SPEED) return [];
  return [issue("note-jump-speed", "warning", difficulty, null, `${difficultyLabel(difficulty)} note jump speed ${settings.noteJumpSpeed} is outside ${MIN_NOTE_JUMP_SPEED} to ${MAX_NOTE_JUMP_SPEED}.`)];
}

export function validateChart(project: Project, difficulty: Difficulty): Issue[] {
  const chart = project.charts[difficulty];
  return [
    ...checkPositions(chart, difficulty),
    ...checkWalls(chart.walls, difficulty),
    ...checkSongBounds(chart, difficulty, project),
    ...checkStacked(chart, difficulty),
    ...checkInsideWalls(chart, difficulty),
    ...checkVisionBlocks(chart.notes, difficulty),
    ...checkCrossovers(chart.notes, difficulty),
    ...checkHandFlow(chart.notes, difficulty),
    ...checkSliders(chart, difficulty),
    ...checkSettings(project.settings[difficulty], difficulty),
  ];
}

function hitCount(chart: Chart): number {
  return chart.notes.length + chart.arcs.length + chart.chains.length;
}

function checkDifficultySpread(project: Project): Issue[] {
  const issues: Issue[] = [];
  const filled = DIFFICULTIES.filter((difficulty) => hitCount(project.charts[difficulty]) > 0);
  for (let index = 1; index < filled.length; index += 1) {
    const easier = filled[index - 1]!;
    const harder = filled[index]!;
    if (hitCount(project.charts[easier]) > hitCount(project.charts[harder])) {
      issues.push(issue("difficulty-order", "warning", harder, null, `${easier} has more notes than ${harder}.`));
    }
  }
  return issues;
}

function checkProject(project: Project): Issue[] {
  const issues: Issue[] = [];
  if (!project.song) issues.push(issue("no-song", "error", null, null, "Import a song before exporting."));
  else if (!project.song.title.trim()) issues.push(issue("no-title", "warning", null, null, "The song has no title; the project name will be used."));
  const drift = project.song?.beatDriftMs ?? null;
  if (drift !== null && drift > DRIFT_WARNING_MS) {
    issues.push(issue("beat-drift", "warning", null, null, `The beat grid is up to ${Math.round(drift)} ms away from the music in places. The song's tempo may change; check the grid against the waveform before mapping.`));
  }
  const bpmProblem = validateBpm(project.timing.bpm);
  if (bpmProblem) issues.push(issue("bpm", "error", null, null, bpmProblem));
  const empty = DIFFICULTIES.filter((difficulty) => chartObjectCount(project.charts[difficulty]) === 0);
  if (empty.length === DIFFICULTIES.length) issues.push(issue("all-empty", "error", null, null, "Every difficulty is empty."));
  else for (const difficulty of empty) issues.push(issue("empty", "warning", difficulty, null, `${difficultyLabel(difficulty)} is empty and will be left out of the export.`));
  return issues;
}

export function validateProject(project: Project): Issue[] {
  return [
    ...checkProject(project),
    ...checkDifficultySpread(project),
    ...DIFFICULTIES.flatMap((difficulty) => validateChart(project, difficulty)),
  ];
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((found) => found.severity === "error");
}
