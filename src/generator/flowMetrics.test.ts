import { describe, expect, it } from "vitest";
import type { CutDirection, Note, NoteColor } from "../core/model";
import { handSwings, measureFlow } from "./flowMetrics";

function note(beat: number, color: NoteColor, x: number, y: number, direction: CutDirection): Note {
  return { id: `${color}${beat}`, beat, x, y, color, direction };
}

describe("measureFlow", () => {
  const notes = [
    note(0, "red", 1, 0, "down"),
    note(0, "blue", 2, 0, "down"),
    note(1, "red", 1, 2, "up"),
    note(2, "red", 0, 0, "down"),
    note(2.05, "red", 0, 1, "down"),
    note(3, "red", 1, 0, "down"),
    note(4, "blue", 3, 1, "any"),
  ];

  it("treats notes a fraction of a beat apart as one swing", () => {
    expect(handSwings(notes, "red").map((swing) => swing.beat)).toEqual([0, 1, 2, 3]);
  });

  it("measures parity, rows, doubles and density", () => {
    const flow = measureFlow(notes, 10);
    expect(flow.notesPerSecond).toBeCloseTo(0.7);
    expect(flow.parityFlipRate).toBeCloseTo(2 / 3);
    expect(flow.downOnBottomShare).toBeCloseTo(4 / 5);
    expect(flow.upAboveBottomShare).toBe(1);
    expect(flow.doubleShare).toBeCloseTo(1 / 6);
    expect(flow.dotShare).toBeCloseTo(1 / 7);
  });

  it("returns zeros for an empty chart", () => {
    expect(measureFlow([], 10).parityFlipRate).toBe(0);
  });
});
