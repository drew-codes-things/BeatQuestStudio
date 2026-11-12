import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosaver, type SaveState } from "./autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosaver", () => {
  it("saves only the latest value once the edits pause", async () => {
    const saved: number[] = [];
    const autosaver = createAutosaver(async (value: number) => void saved.push(value), 500, () => {});
    autosaver.schedule(1);
    await vi.advanceTimersByTimeAsync(300);
    autosaver.schedule(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(saved).toEqual([2]);
  });

  it("flushes immediately when asked", async () => {
    const saved: string[] = [];
    const autosaver = createAutosaver(async (value: string) => void saved.push(value), 10_000, () => {});
    autosaver.schedule("now");
    await autosaver.flush();
    expect(saved).toEqual(["now"]);
  });

  it("reports a failed save instead of hiding it", async () => {
    const states: SaveState[] = [];
    let reported: Error | undefined;
    const autosaver = createAutosaver(async () => { throw new Error("disk full"); }, 10, (state, error) => {
      states.push(state);
      if (error) reported = error;
    });
    autosaver.schedule(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(states).toEqual(["pending", "saving", "failed"]);
    expect(reported?.message).toBe("disk full");
  });

  it("keeps the unsaved value after a failure so the next flush saves it", async () => {
    const saved: number[] = [];
    const states: SaveState[] = [];
    let storageWorks = false;
    const autosaver = createAutosaver(async (value: number) => {
      if (!storageWorks) throw new Error("storage busy");
      saved.push(value);
    }, 10, (state) => states.push(state));
    autosaver.schedule(7);
    await vi.advanceTimersByTimeAsync(20);
    expect(states.at(-1)).toBe("failed");
    storageWorks = true;
    await autosaver.flush();
    expect(saved).toEqual([7]);
    expect(states.at(-1)).toBe("saved");
  });

  it("saves the newer value when an edit arrives during a failing save", async () => {
    const saved: number[] = [];
    let attempts = 0;
    const autosaver = createAutosaver(async (value: number) => {
      attempts += 1;
      if (attempts === 1) {
        autosaver.schedule(2);
        throw new Error("storage busy");
      }
      saved.push(value);
    }, 10, () => {});
    autosaver.schedule(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(saved).toEqual([2]);
  });

  it("drops a pending save when cancelled", async () => {
    const saved: number[] = [];
    const autosaver = createAutosaver(async (value: number) => void saved.push(value), 10, () => {});
    autosaver.schedule(1);
    autosaver.cancel();
    await vi.advanceTimersByTimeAsync(50);
    expect(saved).toEqual([]);
  });
});
