import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { newProject } from "../core/model";
import { MAX_BACKUPS_PER_PROJECT, ProjectStore } from "./projectStore";

let store: ProjectStore;

beforeEach(async () => {
  store = await ProjectStore.open(new IDBFactory());
});

describe("ProjectStore", () => {
  it("saves, lists newest first and loads projects", async () => {
    await store.saveProject(newProject("a", "Older", 1));
    await store.saveProject(newProject("b", "Newer", 2));
    const summaries = await store.listProjects();
    expect(summaries.map((summary) => summary.name)).toEqual(["Newer", "Older"]);
    expect((await store.loadProject("a"))?.name).toBe("Older");
    expect(await store.loadProject("missing")).toBeNull();
  });

  it("counts notes across every difficulty in the summary", async () => {
    const project = newProject("n", "Mapped", 1);
    const note = { id: "x", beat: 4, x: 0, y: 0, color: "red" as const, direction: "down" as const };
    await store.saveProject({ ...project, charts: { ...project.charts, Easy: { ...project.charts.Easy, notes: [note] }, Expert: { ...project.charts.Expert, notes: [note, { ...note, id: "y" }] } } });
    expect((await store.listProjects()).find((summary) => summary.id === "n")?.noteCount).toBe(3);
  });

  it("renames by saving the changed project", async () => {
    const project = newProject("a", "Draft", 1);
    await store.saveProject(project);
    await store.saveProject({ ...project, name: "Final", updatedAt: 5 });
    expect((await store.listProjects())[0]?.name).toBe("Final");
  });

  it("duplicates the project and its audio as an independent copy", async () => {
    const project = newProject("a", "Song", 1);
    project.charts.Expert.notes.push({ id: "n1", beat: 1, x: 1, y: 0, color: "red", direction: "down" });
    await store.saveProject(project);
    await store.saveAudio({ projectId: "a", fileName: "song.ogg", mimeType: "audio/ogg", bytes: new Uint8Array([1, 2, 3]).buffer });

    const copy = await store.duplicateProject("a", "b", "Song copy", 9);
    copy.charts.Expert.notes.length = 0;
    await store.saveProject(copy);

    expect((await store.loadProject("a"))?.charts.Expert.notes).toHaveLength(1);
    expect((await store.loadProject("b"))?.charts.Expert.notes).toHaveLength(0);
    expect(new Uint8Array((await store.loadAudio("b"))!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("stores, copies and deletes the cover with the project", async () => {
    await store.saveProject(newProject("a", "Song", 1));
    await store.saveCover({ projectId: "a", fileName: "cover.png", mimeType: "image/png", bytes: new Uint8Array([9]).buffer });
    await store.duplicateProject("a", "b", "Copy", 2);
    expect((await store.loadCover("b"))?.fileName).toBe("cover.png");
    await store.deleteProject("a");
    expect(await store.loadCover("a")).toBeNull();
    expect(await store.loadCover("b")).not.toBeNull();
  });

  it("upgrades a version 1 database without losing projects", async () => {
    const factory = new IDBFactory();
    const v1 = factory.open("beatmap-studio", 1);
    v1.onupgradeneeded = () => {
      v1.result.createObjectStore("projects", { keyPath: "id" });
      v1.result.createObjectStore("audio", { keyPath: "projectId" });
      v1.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true }).createIndex("byProject", "projectId");
    };
    await new Promise<void>((resolve, reject) => {
      v1.onsuccess = () => {
        const transaction = v1.result.transaction("projects", "readwrite");
        transaction.objectStore("projects").put(newProject("old", "From v1", 1));
        transaction.oncomplete = () => { v1.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      v1.onerror = () => reject(v1.error);
    });
    const upgraded = await ProjectStore.open(factory);
    expect((await upgraded.loadProject("old"))?.name).toBe("From v1");
    expect(await upgraded.loadCover("old")).toBeNull();
    upgraded.close();
  });

  it("refuses to duplicate a project that does not exist", async () => {
    await expect(store.duplicateProject("ghost", "b", "x", 1)).rejects.toThrow(/does not exist/);
  });

  it("deletes the project with its audio and backups", async () => {
    const project = newProject("a", "Song", 1);
    await store.saveProject(project);
    await store.saveAudio({ projectId: "a", fileName: "s.ogg", mimeType: "audio/ogg", bytes: new ArrayBuffer(4) });
    await store.createBackup(project, "manual", 2);
    await store.saveProject(newProject("keep", "Keep", 1));
    await store.createBackup(newProject("keep", "Keep", 1), "manual", 3);

    await store.deleteProject("a");

    expect(await store.loadProject("a")).toBeNull();
    expect(await store.loadAudio("a")).toBeNull();
    expect(await store.listBackups("a")).toEqual([]);
    expect(await store.listBackups("keep")).toHaveLength(1);
  });

  it("restores a backup and keeps the replaced state as a new backup", async () => {
    const project = newProject("a", "Original", 1);
    await store.saveProject(project);
    await store.createBackup(project, "manual", 2);
    await store.saveProject({ ...project, name: "Changed", updatedAt: 3 });

    const [backup] = await store.listBackups("a");
    const restored = await store.restoreBackup(backup!, 4);

    expect(restored.name).toBe("Original");
    expect((await store.loadProject("a"))?.name).toBe("Original");
    const backups = await store.listBackups("a");
    expect(backups[0]?.label).toBe("before restore");
    expect(backups[0]?.project.name).toBe("Changed");
  });

  it("keeps backups as snapshots and caps how many are kept", async () => {
    const project = newProject("a", "Song", 1);
    for (let index = 0; index < MAX_BACKUPS_PER_PROJECT + 3; index += 1) {
      project.name = `v${index}`;
      await store.createBackup(project, "auto", index);
    }
    const backups = await store.listBackups("a");
    expect(backups).toHaveLength(MAX_BACKUPS_PER_PROJECT);
    expect(backups[0]?.project.name).toBe(`v${MAX_BACKUPS_PER_PROJECT + 2}`);
    expect(backups.at(-1)?.project.name).toBe("v3");
  });
});
