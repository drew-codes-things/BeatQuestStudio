import { describe, expect, it } from "vitest";
import { DIFFICULTIES } from "../core/model";
import { FLOW_TABLE, fromRedFrame, gapBucket, parseStateKey, readFlowTable, stateKey, toRedFrame } from "./flowTable";

describe("flow table", () => {
  it("mirrors blue into red's side and back", () => {
    const blue = { x: 3, y: 0, direction: "downLeft" as const };
    const mirrored = toRedFrame(blue, "blue");
    expect(mirrored).toEqual({ x: 0, y: 0, direction: "downRight" });
    expect(fromRedFrame(mirrored, "blue")).toEqual(blue);
    expect(toRedFrame(blue, "red")).toBe(blue);
  });

  it("round-trips state keys", () => {
    for (const key of ["000", "128", "317"]) expect(stateKey(parseStateKey(key))).toBe(key);
  });

  it("buckets the time between swings", () => {
    expect([0.2, 0.45, 1, 2].map(gapBucket)).toEqual(["fast", "steady", "slow", "rest"]);
  });

  it("ships a learned table for every difficulty", () => {
    for (const difficulty of DIFFICULTIES) {
      expect(Object.keys(FLOW_TABLE.tiers[difficulty].transitions).length).toBeGreaterThan(50);
      expect(FLOW_TABLE.tiers[difficulty].starts.length).toBeGreaterThan(0);
    }
  });

  it("refuses a table with a missing difficulty", () => {
    const { Expert: _dropped, ...partial } = FLOW_TABLE.tiers;
    expect(() => readFlowTable({ source: "test", tiers: partial })).toThrow(/missing Expert/);
  });
});
