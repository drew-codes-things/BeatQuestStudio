import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "../storage/projectStore";
import { DURATION_TOLERANCE_SECONDS, findAlreadyMade, normalizeForMatch } from "./alreadyMade";

function summary(overrides: Partial<ProjectSummary> & Pick<ProjectSummary, "id">): ProjectSummary {
  return { name: "Night Drive", updatedAt: 1, songTitle: "Night Drive", artist: "Test Artist", durationSeconds: 200, noteCount: 400, ...overrides };
}

const identity = { title: "Night Drive", artist: "Test Artist" };
const knownDuration = async () => 200;

describe("normalizeForMatch", () => {
  it("ignores case, punctuation, spacing and accents", () => {
    expect(normalizeForMatch("  Beyoncé - Halo!! ")).toBe(normalizeForMatch("beyonce halo"));
    expect(normalizeForMatch("")).toBe("");
  });

  it("keeps letters from other alphabets", () => {
    expect(normalizeForMatch("夜 に 駆ける")).toBe("夜に駆ける");
  });
});

describe("findAlreadyMade", () => {
  it("finds a mapped project with the same title, artist and length", async () => {
    const found = await findAlreadyMade([summary({ id: "a" })], identity, knownDuration);
    expect(found?.id).toBe("a");
  });

  it("matches despite tidy-up differences in the text", async () => {
    const found = await findAlreadyMade([summary({ id: "a", songTitle: "night drive!", artist: "TEST ARTIST" })], identity, knownDuration);
    expect(found?.id).toBe("a");
  });

  it("does not match a different song", async () => {
    expect(await findAlreadyMade([summary({ id: "a", songTitle: "Other Song" })], identity, knownDuration)).toBeNull();
    expect(await findAlreadyMade([summary({ id: "a", artist: "Someone Else" })], identity, knownDuration)).toBeNull();
  });

  it("does not match the same title when the length is clearly different", async () => {
    expect(await findAlreadyMade([summary({ id: "a", durationSeconds: 200 })], identity, async () => 200 + DURATION_TOLERANCE_SECONDS + 1)).toBeNull();
    expect((await findAlreadyMade([summary({ id: "a", durationSeconds: 200 })], identity, async () => 200 + DURATION_TOLERANCE_SECONDS - 0.1))?.id).toBe("a");
  });

  it("ignores projects that have no notes, because they are not made yet", async () => {
    expect(await findAlreadyMade([summary({ id: "a", noteCount: 0 })], identity, knownDuration)).toBeNull();
  });

  it("lets a missing artist on either side match, since the length still has to agree", async () => {
    expect((await findAlreadyMade([summary({ id: "a", artist: "" })], identity, knownDuration))?.id).toBe("a");
    expect((await findAlreadyMade([summary({ id: "a" })], { title: "Night Drive", artist: "" }, knownDuration))?.id).toBe("a");
  });

  it("falls back to the name alone when the new file's length cannot be read", async () => {
    expect((await findAlreadyMade([summary({ id: "a" })], identity, async () => null))?.id).toBe("a");
  });

  it("does not read the length at all when no project has that name", async () => {
    let reads = 0;
    await findAlreadyMade([summary({ id: "a", songTitle: "Other" })], identity, async () => { reads += 1; return 200; });
    expect(reads).toBe(0);
  });

  it("picks the closest length among several versions", async () => {
    const found = await findAlreadyMade([summary({ id: "radio", durationSeconds: 199 }), summary({ id: "exact", durationSeconds: 200.2 })], identity, knownDuration);
    expect(found?.id).toBe("exact");
  });
});
