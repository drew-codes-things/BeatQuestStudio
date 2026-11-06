import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { analyseSong } from "../audio/analysis";
import { makeClickTrack } from "../audio/testSignals";
import { chartObjectCount, newProject } from "../core/model";
import { generateCharts } from "../generator/generate";
import { withImportedSong } from "../import/songImport";
import { hasStorageRoom, importRejection, MAX_IMPORT_BYTES, MAX_SONG_SECONDS, songLengthRejection } from "./limits";
import { BatchQueue, type BatchSnapshot } from "./queue";
import { ZipPartWriter } from "./zipParts";

const MEGABYTE = 1024 * 1024;

function deferred() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function statuses<T>(snapshot: BatchSnapshot<T>): string[] {
  return snapshot.items.map((item) => `${item.label}:${item.status}`);
}

describe("import limits", () => {
  it("accepts a normal song", () => {
    expect(importRejection({ name: "song.mp3", type: "audio/mpeg", size: 8 * MEGABYTE })).toBeNull();
  });

  it("rejects files that are not audio or video", () => {
    expect(importRejection({ name: "notes.txt", type: "text/plain", size: 100 })).toMatch(/not an audio or video file/);
  });

  it("rejects empty files", () => {
    expect(importRejection({ name: "song.mp3", type: "audio/mpeg", size: 0 })).toMatch(/empty/);
  });

  it("rejects files over the size limit before they are read", () => {
    expect(importRejection({ name: "film.mp4", type: "video/mp4", size: MAX_IMPORT_BYTES + 1 })).toMatch(/256 MB/);
    expect(importRejection({ name: "film.mp4", type: "video/mp4", size: MAX_IMPORT_BYTES })).toBeNull();
  });

  it("rejects songs longer than the length limit", () => {
    expect(songLengthRejection("long.wav", MAX_SONG_SECONDS + 1)).toMatch(/15 minutes/);
    expect(songLengthRejection("fine.wav", MAX_SONG_SECONDS)).toBeNull();
  });

  it("needs room for the file plus headroom, and trusts a browser that reports no quota", () => {
    expect(hasStorageRoom({ usage: 0, quota: 1000 * MEGABYTE }, 10 * MEGABYTE)).toBe(true);
    expect(hasStorageRoom({ usage: 950 * MEGABYTE, quota: 1000 * MEGABYTE }, 10 * MEGABYTE)).toBe(false);
    expect(hasStorageRoom({}, 10 * MEGABYTE)).toBe(true);
  });
});

describe("BatchQueue", () => {
  it("runs one item at a time, in order", async () => {
    let running = 0;
    let mostAtOnce = 0;
    const order: number[] = [];
    const queue = new BatchQueue<number>({
      process: async (input) => {
        running += 1;
        mostAtOnce = Math.max(mostAtOnce, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        order.push(input);
        running -= 1;
        return `made ${input}`;
      },
      timeoutMs: 1000,
      restMs: 0,
    });
    queue.add([1, 2, 3, 4, 5].map((input) => ({ input, label: `s${input}`, rejection: null })));
    await queue.start();
    expect(order).toEqual([1, 2, 3, 4, 5]);
    expect(mostAtOnce).toBe(1);
    expect(queue.snapshot().items.every((item) => item.status === "done")).toBe(true);
    expect(queue.snapshot().items[0]!.message).toBe("made 1");
  });

  it("keeps going after a failure and skips rejected items without running them", async () => {
    const ran: string[] = [];
    const queue = new BatchQueue<string>({
      process: async (input) => {
        ran.push(input);
        if (input === "bad") throw new Error("could not read any audio");
        return "ok";
      },
      timeoutMs: 1000,
      restMs: 0,
    });
    queue.add([
      { input: "a", label: "a", rejection: null },
      { input: "huge", label: "huge", rejection: "too big" },
      { input: "bad", label: "bad", rejection: null },
      { input: "b", label: "b", rejection: null },
    ]);
    await queue.start();
    expect(ran).toEqual(["a", "bad", "b"]);
    expect(statuses(queue.snapshot())).toEqual(["a:done", "huge:skipped", "bad:failed", "b:done"]);
    expect(queue.snapshot().items[2]!.message).toBe("could not read any audio");
  });

  it("picks up items added while it is running", async () => {
    const gate = deferred();
    const queue = new BatchQueue<string>({
      process: async (input) => {
        if (input === "first") await gate.promise;
        return input;
      },
      timeoutMs: 1000,
      restMs: 0,
    });
    queue.add([{ input: "first", label: "first", rejection: null }]);
    const finished = queue.start();
    queue.add([{ input: "later", label: "later", rejection: null }]);
    gate.release();
    await finished;
    expect(statuses(queue.snapshot())).toEqual(["first:done", "later:done"]);
  });

  it("stops after the current item when asked", async () => {
    const gate = deferred();
    const queue = new BatchQueue<string>({
      process: async () => {
        await gate.promise;
        return "ok";
      },
      timeoutMs: 1000,
      restMs: 0,
    });
    queue.add(["a", "b", "c"].map((input) => ({ input, label: input, rejection: null })));
    const finished = queue.start();
    queue.stop();
    gate.release();
    await finished;
    expect(statuses(queue.snapshot())).toEqual(["a:done", "b:waiting", "c:waiting"]);
    expect(queue.snapshot().running).toBe(false);
  });

  it("fails an item that takes too long, tells the owner, and moves on", async () => {
    let timeouts = 0;
    const queue = new BatchQueue<string>({
      process: (input) => (input === "stuck" ? new Promise<string>(() => {}) : Promise.resolve("ok")),
      timeoutMs: 20,
      restMs: 0,
      onTimeout: () => { timeouts += 1; },
    });
    queue.add(["stuck", "next"].map((input) => ({ input, label: input, rejection: null })));
    await queue.start();
    expect(statuses(queue.snapshot())).toEqual(["stuck:failed", "next:done"]);
    expect(queue.snapshot().items[0]!.message).toMatch(/took longer than/);
    expect(timeouts).toBe(1);
  });

  it("halts with a reason when the room check says no, leaving the rest waiting", async () => {
    const queue = new BatchQueue<string>({
      process: async () => "ok",
      timeoutMs: 1000,
      restMs: 0,
      checkRoom: async (input) => (input === "c" ? "browser storage is nearly full" : null),
    });
    queue.add(["a", "b", "c", "d"].map((input) => ({ input, label: input, rejection: null })));
    await queue.start();
    expect(statuses(queue.snapshot())).toEqual(["a:done", "b:done", "c:waiting", "d:waiting"]);
    expect(queue.snapshot().halted).toBe("browser storage is nearly full");
  });

  it("reports finished as soon as the last item is done, without a trailing rest", async () => {
    const queue = new BatchQueue<string>({ process: async () => "ok", timeoutMs: 1000, restMs: 5_000 });
    queue.add([{ input: "only", label: "only", rejection: null }]);
    const started = Date.now();
    await queue.start();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(queue.snapshot().running).toBe(false);
  });

  it("counts, clears finished items and notifies subscribers", async () => {
    const queue = new BatchQueue<string>({ process: async () => "ok", timeoutMs: 1000, restMs: 0 });
    let notified = 0;
    const unsubscribe = queue.subscribe(() => { notified += 1; });
    queue.add([{ input: "a", label: "a", rejection: null }, { input: "x", label: "x", rejection: "no" }]);
    await queue.start();
    expect(queue.snapshot().counts).toEqual({ waiting: 0, working: 0, done: 1, failed: 0, skipped: 1 });
    queue.clearFinished();
    expect(queue.snapshot().items).toEqual([]);
    expect(notified).toBeGreaterThan(2);
    unsubscribe();
  });
});

describe("ZipPartWriter", () => {
  const map = (size: number) => ({ "Info.dat": new TextEncoder().encode("{}"), "song.egg": new Uint8Array(size).fill(7) });

  it("puts each map in its own folder and splits parts at the size limit", async () => {
    const parts: Uint8Array[] = [];
    const writer = new ZipPartWriter(1000, (zip) => { parts.push(zip); });
    await writer.add("one (A - B)", map(400));
    await writer.add("two (A - B)", map(400));
    await writer.add("three (A - B)", map(400));
    expect(await writer.finish()).toBe(2);
    expect(Object.keys(unzipSync(parts[0]!)).sort()).toEqual(["one (A - B)/Info.dat", "one (A - B)/song.egg", "two (A - B)/Info.dat", "two (A - B)/song.egg"]);
    const second = unzipSync(parts[1]!);
    expect(Object.keys(second).sort()).toEqual(["three (A - B)/Info.dat", "three (A - B)/song.egg"]);
    expect(second["three (A - B)/song.egg"]!.length).toBe(400);
  });

  it("gives a map bigger than the limit a part of its own and emits nothing when empty", async () => {
    const parts: Uint8Array[] = [];
    const writer = new ZipPartWriter(100, (zip) => { parts.push(zip); });
    await writer.add("big", map(500));
    await writer.add("small", map(10));
    expect(await writer.finish()).toBe(2);
    const empty = new ZipPartWriter(100, () => { throw new Error("should not emit"); });
    expect(await empty.finish()).toBe(0);
  });
});

describe("song import helpers", () => {
  const analysis = analyseSong([makeClickTrack({ bpm: 120, offsetSeconds: 0.5, durationSeconds: 30, sampleRate: 22050, accentEvery: 4, noiseLevel: 0.01 })], 22050);

  it("fills timing and song details from the analysis and keeps a title already set", () => {
    const fresh = withImportedSong(newProject("p", "Untitled", 1), { storedFileName: "clip.ogg", identity: { title: "Great Tune", artist: "" }, analysis }, 5);
    expect(fresh.timing.bpm).toBeCloseTo(120, 1);
    expect(fresh.song?.title).toBe("Great Tune");
    expect(fresh.song?.fileName).toBe("clip.ogg");
    expect(fresh.updatedAt).toBe(5);
    const renamed = { ...fresh, song: { ...fresh.song!, title: "Kept" } };
    expect(withImportedSong(renamed, { storedFileName: "b.mp3", identity: { title: "b", artist: "" }, analysis }, 6).song?.title).toBe("Kept");
  });

  it("generates only the chosen difficulties", () => {
    let next = 0;
    const charts = generateCharts(withImportedSong(newProject("p", "x", 1), { storedFileName: "a.wav", identity: { title: "a", artist: "" }, analysis }, 2).timing, analysis, ["Easy", "Expert"], "seed", () => `id${next++}`);
    expect(Object.keys(charts).sort()).toEqual(["Easy", "Expert"]);
    expect(chartObjectCount(charts.Easy!)).toBeGreaterThan(0);
    expect(charts.Expert!.notes.length).toBeGreaterThan(charts.Easy!.notes.length);
  });
});
