import { describe, expect, it } from "vitest";
import {
  addNote,
  copySelection,
  copyToChart,
  findObjectAt,
  idsInBeatRange,
  keepExistingIds,
  mirrorObjects,
  moveObjects,
  pasteClipboard,
  recolorObjects,
  removeObjects,
  setDirection,
} from "./edit";
import { HISTORY_LIMIT, record, redo, startHistory, undo } from "./history";
import { type Chart, emptyChart, type Note } from "./model";

function note(id: string, beat: number, x: number, y: number, color: Note["color"] = "red"): Note {
  return { id, beat, x, y, color, direction: "down" };
}

function counter(prefix: string) {
  let next = 0;
  return () => `${prefix}${next++}`;
}

function sample(): Chart {
  let chart = emptyChart();
  chart = addNote(chart, note("b", 2, 2, 0, "blue"));
  chart = addNote(chart, note("a", 1, 1, 0));
  chart.walls.push({ id: "w", beat: 3, x: 0, y: 0, durationBeats: 2, width: 1, height: 5 });
  chart.bombs.push({ id: "bomb", beat: 4, x: 3, y: 2 });
  return chart;
}

describe("placing and removing", () => {
  it("keeps notes sorted by beat", () => {
    expect(sample().notes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("removes only the chosen objects across kinds", () => {
    const chart = removeObjects(sample(), new Set(["a", "w"]));
    expect(chart.notes.map((n) => n.id)).toEqual(["b"]);
    expect(chart.walls).toEqual([]);
    expect(chart.bombs).toHaveLength(1);
  });

  it("finds an object by beat and cell", () => {
    expect(findObjectAt(sample(), 2.0004, 2, 0)?.id).toBe("b");
    expect(findObjectAt(sample(), 2, 1, 0)).toBeUndefined();
  });
});

describe("moving", () => {
  it("moves in time and grid", () => {
    const chart = moveObjects(sample(), new Set(["a"]), { beats: 0.5, columns: 1, rows: 2 });
    expect(chart.notes[0]).toMatchObject({ id: "a", beat: 1.5, x: 2, y: 2 });
  });

  it("refuses the part of a move that would leave the grid", () => {
    const chart = moveObjects(sample(), new Set(["a", "b"]), { beats: 1, columns: 2, rows: 0 });
    expect(chart.notes.map((n) => [n.beat, n.x])).toEqual([[2, 1], [3, 2]]);
  });

  it("will not move objects before the song start", () => {
    const original = sample();
    expect(moveObjects(original, new Set(["a"]), { beats: -2, columns: 0, rows: 0 })).toBe(original);
  });

  it("keeps a wall's width inside the grid", () => {
    const chart = moveObjects(sample(), new Set(["w"]), { beats: 0, columns: 3, rows: 0 });
    expect(chart.walls[0]?.x).toBe(3);
    const tooFar = moveObjects(chart, new Set(["w"]), { beats: 0, columns: 1, rows: 0 });
    expect(tooFar.walls[0]?.x).toBe(3);
  });
});

describe("changing notes", () => {
  it("sets colour or swaps it", () => {
    expect(recolorObjects(sample(), new Set(["a"]), "blue").notes[0]?.color).toBe("blue");
    expect(recolorObjects(sample(), new Set(["a", "b"]), "swap").notes.map((n) => n.color)).toEqual(["blue", "red"]);
  });

  it("sets the cut direction", () => {
    expect(setDirection(sample(), new Set(["b"]), "upLeft").notes[1]?.direction).toBe("upLeft");
  });

  it("mirrors position, colour and direction", () => {
    let chart = setDirection(sample(), new Set(["a"]), "downLeft");
    chart = mirrorObjects(chart, new Set(["a", "w"]));
    const mirrored = chart.notes.find((n) => n.id === "a");
    expect(mirrored).toMatchObject({ x: 2, color: "blue", direction: "downRight" });
    expect(chart.walls[0]?.x).toBe(3);
  });
});

describe("copy and paste", () => {
  it("pastes at the cursor with new ids and leaves the source alone", () => {
    const chart = sample();
    const clipboard = copySelection(chart, new Set(["a", "b"]));
    expect(clipboard).not.toBeNull();
    const result = pasteClipboard(chart, clipboard!, 10, counter("p"));
    expect([...result.ids]).toEqual(["p0", "p1"]);
    expect(result.chart.notes.map((n) => [n.id, n.beat])).toEqual([["a", 1], ["b", 2], ["p0", 10], ["p1", 11]]);
    expect(chart.notes).toHaveLength(2);
  });

  it("returns nothing to copy for an empty selection", () => {
    expect(copySelection(sample(), new Set())).toBeNull();
  });

  it("copies a pattern into another difficulty at the same beats", () => {
    const expert = sample();
    const { chart: easy, ids } = copyToChart(expert, new Set(["b", "bomb"]), emptyChart(), counter("e"));
    expect(easy.notes.map((n) => [n.beat, n.x, n.color])).toEqual([[2, 2, "blue"]]);
    expect(easy.bombs.map((b) => b.beat)).toEqual([4]);
    expect(ids.size).toBe(2);
    expect(expert.notes).toHaveLength(2);
  });

  it("selects everything in a beat range", () => {
    expect([...idsInBeatRange(sample(), 1.5, 3)].sort()).toEqual(["b", "w"]);
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit clears redo", () => {
    let history = startHistory(1);
    history = record(history, 2);
    history = record(history, 3);
    history = undo(history);
    expect(history.present).toBe(2);
    history = redo(history);
    expect(history.present).toBe(3);
    history = undo(record(undo(history), 9));
    expect(history.present).toBe(2);
    expect(history.future).toEqual([9]);
    expect(redo(redo(history)).present).toBe(9);
  });

  it("does nothing past either end and caps its size", () => {
    expect(undo(startHistory("x")).present).toBe("x");
    expect(redo(startHistory("x")).present).toBe("x");
    let history = startHistory(0);
    for (let step = 1; step <= HISTORY_LIMIT + 50; step += 1) history = record(history, step);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("selection after undo", () => {
  it("drops ids that are no longer in the chart", () => {
    const chart = sample();
    expect([...keepExistingIds(new Set(["a", "gone", "w"]), chart)].sort()).toEqual(["a", "w"]);
  });

  it("returns the same set when every id still exists", () => {
    const selection = new Set(["a", "bomb"]);
    expect(keepExistingIds(selection, sample())).toBe(selection);
  });
});
