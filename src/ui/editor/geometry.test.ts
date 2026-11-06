import { describe, expect, it } from "vitest";
import { beatToX, cellOfLane, directionFromDrag, laneAtY, laneLabel, laneOf, LANES_TOP, LANE_HEIGHT, xToBeat, zoomAround } from "./geometry";

describe("timeline lanes", () => {
  it("puts the top row first and round-trips every cell", () => {
    expect(laneOf({ x: 0, y: 2 })).toBe(0);
    expect(laneOf({ x: 3, y: 0 })).toBe(11);
    for (let lane = 0; lane < 12; lane += 1) expect(laneOf(cellOfLane(lane))).toBe(lane);
    expect(laneLabel(0)).toBe("T1");
    expect(laneLabel(11)).toBe("B4");
  });

  it("finds the lane under the pointer and nothing outside the lanes", () => {
    expect(laneAtY(LANES_TOP + LANE_HEIGHT * 4 + 1)).toBe(4);
    expect(laneAtY(LANES_TOP - 1)).toBeNull();
    expect(laneAtY(LANES_TOP + LANE_HEIGHT * 12)).toBeNull();
  });
});

describe("timeline scale", () => {
  it("converts beats and pixels both ways", () => {
    const viewport = { leftBeat: 8, pixelsPerBeat: 50 };
    expect(xToBeat(beatToX(13.25, viewport), viewport)).toBeCloseTo(13.25, 10);
  });

  it("keeps the beat under the pointer still while zooming", () => {
    const viewport = { leftBeat: 8, pixelsPerBeat: 50 };
    const anchorX = 300;
    const zoomed = zoomAround(viewport, anchorX, 2);
    expect(zoomed.pixelsPerBeat).toBe(100);
    expect(xToBeat(anchorX, zoomed)).toBeCloseTo(xToBeat(anchorX, viewport), 10);
  });

  it("limits how far it zooms", () => {
    expect(zoomAround({ leftBeat: 0, pixelsPerBeat: 50 }, 100, 1000).pixelsPerBeat).toBe(640);
    expect(zoomAround({ leftBeat: 0, pixelsPerBeat: 50 }, 100, 0.001).pixelsPerBeat).toBe(12);
  });
});

describe("drag to set a cut direction", () => {
  it.each([
    [0, 40, "down"], [0, -40, "up"], [40, 0, "right"], [-40, 0, "left"],
    [30, 30, "downRight"], [-30, 30, "downLeft"], [30, -30, "upRight"], [-30, -30, "upLeft"],
  ] as const)("drag (%d, %d) cuts %s", (deltaX, deltaY, direction) => {
    expect(directionFromDrag(deltaX, deltaY)).toBe(direction);
  });

  it("ignores a tiny drag", () => {
    expect(directionFromDrag(3, 4)).toBeNull();
  });
});
