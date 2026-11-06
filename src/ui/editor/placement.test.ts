import { describe, expect, it } from "vitest";
import { emptyChart } from "../../core/model";
import { arcFromSelection, chainFromSelection, type PlacementSettings, placeAt, placeWall } from "./placement";

const settings: PlacementSettings = { tool: "red", direction: "down", wallWidth: 1, wallShape: "full" };

function counter() {
  let next = 0;
  return () => `id${next++}`;
}

describe("placing with a tool", () => {
  it("places a note with the chosen colour and direction", () => {
    const result = placeAt(emptyChart(), 4, { x: 1, y: 0 }, { ...settings, tool: "blue", direction: "upLeft" }, counter());
    expect(result?.chart.notes).toEqual([{ id: "id0", beat: 4, x: 1, y: 0, color: "blue", direction: "upLeft" }]);
  });

  it("replaces whatever was already in that cell at that beat", () => {
    const makeId = counter();
    const first = placeAt(emptyChart(), 4, { x: 1, y: 0 }, settings, makeId)!;
    const second = placeAt(first.chart, 4, { x: 1, y: 0 }, { ...settings, tool: "bomb" }, makeId)!;
    expect(second.chart.notes).toEqual([]);
    expect(second.chart.bombs).toEqual([{ id: "id1", beat: 4, x: 1, y: 0 }]);
  });

  it("places nothing with the select tool", () => {
    expect(placeAt(emptyChart(), 4, { x: 1, y: 0 }, { ...settings, tool: "select" }, counter())).toBeNull();
  });

  it("draws walls in either direction and keeps them inside the grid", () => {
    const result = placeWall(emptyChart(), 6, 4, 3, { ...settings, wallWidth: 2, wallShape: "crouch" }, counter());
    expect(result?.chart.walls).toEqual([{ id: "id0", beat: 4, durationBeats: 2, x: 2, width: 2, y: 2, height: 3 }]);
    expect(placeWall(emptyChart(), 4, 4, 0, settings, counter())).toBeNull();
  });
});

describe("arcs and chains from two notes", () => {
  function twoNotes() {
    const makeId = counter();
    let chart = placeAt(emptyChart(), 4, { x: 1, y: 0 }, settings, makeId)!.chart;
    chart = placeAt(chart, 5, { x: 1, y: 2 }, { ...settings, direction: "up" }, makeId)!.chart;
    return chart;
  }

  it("joins two same-colour notes with an arc and keeps both notes", () => {
    const result = arcFromSelection(twoNotes(), new Set(["id0", "id1"]), () => "arc");
    if ("error" in result) throw new Error(result.error);
    expect(result.chart.notes).toHaveLength(2);
    expect(result.chart.arcs[0]).toMatchObject({ beat: 4, x: 1, y: 0, direction: "down", tailBeat: 5, tailX: 1, tailY: 2, tailDirection: "up" });
  });

  it("turns the second note into the end of a chain", () => {
    const result = chainFromSelection(twoNotes(), new Set(["id0", "id1"]), () => "chain");
    if ("error" in result) throw new Error(result.error);
    expect(result.chart.notes.map((note) => note.id)).toEqual(["id0"]);
    expect(result.chart.chains[0]).toMatchObject({ beat: 4, tailBeat: 5, tailY: 2, segments: 5 });
  });

  it("explains what is wrong with the selection", () => {
    const chart = twoNotes();
    expect(arcFromSelection(chart, new Set(["id0"]), counter())).toEqual({ error: "Select exactly two notes: the start and the end." });
    const mixed = { ...chart, notes: chart.notes.map((note) => (note.id === "id1" ? { ...note, color: "blue" as const } : note)) };
    expect(chainFromSelection(mixed, new Set(["id0", "id1"]), counter())).toEqual({ error: "Both notes must be the same colour." });
  });
});
