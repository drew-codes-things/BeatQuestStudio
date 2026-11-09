import { describe, expect, it } from "vitest";
import type { BatchStatus } from "../batch/queue";
import { batchHeadline } from "./batchSummary";

const counts = (overrides: Partial<Record<BatchStatus, number>>): Record<BatchStatus, number> => ({ waiting: 0, working: 0, done: 0, existing: 0, failed: 0, skipped: 0, ...overrides });

describe("batchHeadline", () => {
  it("says nothing before anything is added", () => {
    expect(batchHeadline(counts({}), false)).toBe("");
  });

  it("describes a finished batch in plain words", () => {
    expect(batchHeadline(counts({ done: 3, existing: 1, skipped: 2 }), false)).toBe("Done: 3 new maps, 1 already made, 2 skipped.");
  });

  it("uses the singular and leaves out zero counts", () => {
    expect(batchHeadline(counts({ done: 1 }), false)).toBe("Done: 1 new map.");
    expect(batchHeadline(counts({ existing: 1 }), false)).toBe("Done: 1 already made.");
    expect(batchHeadline(counts({ failed: 1 }), false)).toBe("Done: 1 failed.");
  });

  it("shows progress while it runs", () => {
    expect(batchHeadline(counts({ done: 2, working: 1, waiting: 4 }), true)).toBe("Working: 2 of 7 done (2 new maps).");
    expect(batchHeadline(counts({ working: 1, waiting: 4 }), true)).toBe("Working: 0 of 5 done.");
  });

  it("says when it is paused with songs left", () => {
    expect(batchHeadline(counts({ done: 2, waiting: 3 }), false)).toBe("Paused: 2 of 5 done (2 new maps). Press Start to carry on.");
  });
});
