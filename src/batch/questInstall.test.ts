import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { analyseSong } from "../audio/analysis";
import { makeClickTrack } from "../audio/testSignals";
import { DIFFICULTIES, newProject, type Project } from "../core/model";
import { mapFolderName } from "../export/beatmap";
import type { MapFiles } from "../export/package";
import { generateCharts } from "../generator/generate";
import { withImportedSong } from "../import/songImport";
import { CUSTOM_LEVELS_PATH, type QuestConnection } from "../quest/usb";
import { ProjectStore } from "../storage/projectStore";
import { hasErrors, validateProject } from "../validation/validate";
import { exportProjects, type ExportProgress, type MapPreparer } from "./exportMaps";

const analysis = analyseSong([makeClickTrack({ bpm: 120, offsetSeconds: 0.5, durationSeconds: 30, sampleRate: 22050, accentEvery: 4, noiseLevel: 0.01 })], 22050);
const TWO_FILES: MapFiles = { "Info.dat": new Uint8Array([1]), "song.egg": new Uint8Array([2, 3]) };

function mappedProject(id: string, title: string): Project {
  const imported = withImportedSong(newProject(id, title, 1), { storedFileName: "song.ogg", identity: { title, artist: "Artist" }, analysis }, 2);
  let next = 0;
  const charts = generateCharts(imported.timing, analysis, DIFFICULTIES, id, () => `${id}-${next++}`);
  const project = { ...imported, charts: { ...imported.charts, ...charts } };
  expect(hasErrors(validateProject(project))).toBe(false);
  return project;
}

interface HeadsetOptions {
  alreadyThere?: string[];
  failWritesIn?: string;
  customLevelsMissing?: boolean;
}

function fakeHeadset(options: HeadsetOptions = {}) {
  const written = new Map<string, string[]>();
  const folderOf = (path: string) => path.slice(CUSTOM_LEVELS_PATH.length + 1).split("/")[0]!;
  const sync = {
    readdir: async (path: string) => {
      if (path === CUSTOM_LEVELS_PATH) {
        if (options.customLevelsMissing) throw new Error("no such directory");
        return [".", "..", ...(options.alreadyThere ?? []), ...written.keys()].map((name) => ({ name }));
      }
      return (written.get(folderOf(path)) ?? []).map((name) => ({ name }));
    },
    write: async ({ filename }: { filename: string }) => {
      const folder = folderOf(filename);
      if (options.failWritesIn && folder === options.failWritesIn) throw new Error("the headset disconnected");
      written.set(folder, [...(written.get(folder) ?? []), filename.split("/").pop()!]);
    },
    dispose: async () => {},
  };
  const adb = { subprocess: { noneProtocol: { spawnWaitText: async () => "" } }, sync: async () => sync };
  return { connection: { adb, name: "Quest 3S", serial: "1WMHH" } as unknown as QuestConnection, written };
}

const preparer: MapPreparer = { prepare: async () => TWO_FILES };
const context = () => { throw new Error("the audio context is not used with a fake preparer"); };

let store: ProjectStore;
let projects: Project[];

beforeEach(async () => {
  store = await ProjectStore.open(new IDBFactory());
  projects = [mappedProject("aaaaaa-1", "First"), mappedProject("bbbbbb-2", "Second"), mappedProject("cccccc-3", "Third")];
  for (const project of projects) await store.saveProject(project);
});

function install(ids: string[], headset: ReturnType<typeof fakeHeadset>, replaceExisting: boolean, onProgress: (progress: ExportProgress) => void = () => {}) {
  return exportProjects(ids, { kind: "quest", connection: headset.connection, replaceExisting }, { store, context, onProgress, preparer });
}

describe("installing many maps on the Quest", () => {
  it("puts every map in its own folder with all its files", async () => {
    const headset = fakeHeadset();
    const report = await install(projects.map((project) => project.id), headset, false);
    expect(report.exported).toEqual(["First", "Second", "Third"]);
    expect(report.skipped).toEqual([]);
    expect(report.alreadyOnHeadset).toEqual([]);
    expect([...headset.written.keys()].sort()).toEqual(projects.map(mapFolderName).sort());
    for (const files of headset.written.values()) expect(files).toEqual(["Info.dat", "song.egg"]);
  });

  it("leaves maps that are already on the headset alone and says which", async () => {
    const headset = fakeHeadset({ alreadyThere: [mapFolderName(projects[1]!)] });
    const report = await install(projects.map((project) => project.id), headset, false);
    expect(report.exported).toEqual(["First", "Third"]);
    expect(report.alreadyOnHeadset).toEqual(["Second"]);
    expect(headset.written.has(mapFolderName(projects[1]!))).toBe(false);
  });

  it("installs maps that are already there again when asked to replace them", async () => {
    const headset = fakeHeadset({ alreadyThere: [mapFolderName(projects[1]!)] });
    const report = await install(projects.map((project) => project.id), headset, true);
    expect(report.exported).toEqual(["First", "Second", "Third"]);
    expect(report.alreadyOnHeadset).toEqual([]);
    expect(headset.written.has(mapFolderName(projects[1]!))).toBe(true);
  });

  it("treats a headset with no CustomLevels folder yet as empty", async () => {
    const headset = fakeHeadset({ customLevelsMissing: true });
    const report = await install([projects[0]!.id], headset, false);
    expect(report.exported).toEqual(["First"]);
  });

  it("reports a map that fails and still installs the rest", async () => {
    const headset = fakeHeadset({ failWritesIn: mapFolderName(projects[1]!) });
    const report = await install(projects.map((project) => project.id), headset, false);
    expect(report.exported).toEqual(["First", "Third"]);
    expect(report.skipped).toEqual([{ name: "Second", reason: "the headset disconnected" }]);
  });

  it("skips a project that has errors and one that is gone, without touching the headset for them", async () => {
    const broken = { ...mappedProject("dddddd-4", "No song"), song: null };
    await store.saveProject(broken);
    const headset = fakeHeadset();
    const report = await install([broken.id, "missing-id", projects[0]!.id], headset, false);
    expect(report.exported).toEqual(["First"]);
    expect(report.skipped.map((skip) => skip.name)).toEqual(["No song", "missing-id"]);
    expect(report.skipped[1]!.reason).toMatch(/no longer in storage/);
    expect(headset.written.size).toBe(1);
  });

  it("reports progress for each map and finishes at the total", async () => {
    const seen: ExportProgress[] = [];
    await install(projects.map((project) => project.id), fakeHeadset(), false, (progress) => seen.push(progress));
    expect(seen.map((progress) => progress.current).filter(Boolean)).toEqual(["First", "Second", "Third"]);
    expect(seen.at(-1)).toEqual({ done: 3, total: 3, current: "" });
  });
});
