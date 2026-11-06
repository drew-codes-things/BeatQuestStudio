import { describe, expect, it } from "vitest";
import { beatToSeconds, secondsToBeat, snapBeat, songLengthInBeats, validateBpm } from "./timing";

const timing = { bpm: 120, offsetSeconds: 0.25 };

describe("timing", () => {
  it("converts beats to seconds with the offset", () => {
    expect(beatToSeconds(0, timing)).toBe(0.25);
    expect(beatToSeconds(4, timing)).toBe(2.25);
  });

  it("converts seconds back to the same beat", () => {
    for (const beat of [0, 0.5, 3.25, 117]) expect(secondsToBeat(beatToSeconds(beat, timing), timing)).toBeCloseTo(beat, 10);
  });

  it("snaps to the nearest subdivision", () => {
    expect(snapBeat(1.13, 4)).toBe(1.25);
    expect(snapBeat(1.1, 1)).toBe(1);
    expect(snapBeat(2.32, 3)).toBeCloseTo(2 + 1 / 3, 10);
  });

  it("refuses nonsense subdivisions", () => {
    expect(() => snapBeat(1, 0)).toThrow(RangeError);
    expect(() => snapBeat(1, 1.5)).toThrow(RangeError);
  });

  it("checks the BPM range", () => {
    expect(validateBpm(128)).toBeNull();
    expect(validateBpm(Number.NaN)).toBe("BPM must be a number");
    expect(validateBpm(10)).toMatch(/between/);
    expect(validateBpm(1000)).toMatch(/between/);
  });

  it("never reports a negative song length", () => {
    expect(songLengthInBeats(0.1, timing)).toBe(0);
    expect(songLengthInBeats(60.25, timing)).toBe(120);
  });
});
