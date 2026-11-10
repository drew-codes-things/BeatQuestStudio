import { DIFFICULTIES, type Project, withEveryDifficulty } from "../core/model";

const DATABASE_NAME = "beatmap-studio";
const DATABASE_VERSION = 2;
const PROJECTS = "projects";
const AUDIO = "audio";
const BACKUPS = "backups";
const COVERS = "covers";
const BACKUPS_BY_PROJECT = "byProject";
export const MAX_BACKUPS_PER_PROJECT = 20;

export interface StoredAudio {
  projectId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface StoredCover {
  projectId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}

export interface Backup {
  id?: number;
  projectId: string;
  takenAt: number;
  label: string;
  project: Project;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  songTitle: string | null;
  artist: string | null;
  durationSeconds: number | null;
  noteCount: number;
}

function totalNotes(project: Project): number {
  return DIFFICULTIES.reduce((total, difficulty) => total + project.charts[difficulty].notes.length, 0);
}

export function summarizeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    songTitle: project.song?.title ?? null,
    artist: project.song?.artist ?? null,
    durationSeconds: project.song?.durationSeconds ?? null,
    noteCount: totalNotes(project),
  };
}

function requestToPromise<T>(request: IDBRequest<T>, context: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`${context}: ${request.error?.message ?? "unknown IndexedDB error"}`));
  });
}

function transactionDone(transaction: IDBTransaction, context: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error(`${context}: ${transaction.error?.message ?? "unknown IndexedDB error"}`));
    transaction.onabort = () => reject(new Error(`${context}: transaction aborted`));
  });
}

function upgradeSchema(database: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    database.createObjectStore(PROJECTS, { keyPath: "id" });
    database.createObjectStore(AUDIO, { keyPath: "projectId" });
    const backups = database.createObjectStore(BACKUPS, { keyPath: "id", autoIncrement: true });
    backups.createIndex(BACKUPS_BY_PROJECT, "projectId");
  }
  if (oldVersion < 2) database.createObjectStore(COVERS, { keyPath: "projectId" });
}

export class ProjectStore {
  private constructor(private readonly database: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<ProjectStore> {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => upgradeSchema(request.result, event.oldVersion);
    const database = await requestToPromise(request, "opening the project database");
    return new ProjectStore(database);
  }

  close(): void {
    this.database.close();
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const store = this.database.transaction(PROJECTS, "readonly").objectStore(PROJECTS);
    const projects = await requestToPromise(store.getAll() as IDBRequest<Project[]>, "listing projects");
    return projects.map((project) => summarizeProject(withEveryDifficulty(project))).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadProject(id: string): Promise<Project | null> {
    const store = this.database.transaction(PROJECTS, "readonly").objectStore(PROJECTS);
    const project = await requestToPromise(store.get(id) as IDBRequest<Project | undefined>, `loading project ${id}`);
    return project ? withEveryDifficulty(project) : null;
  }

  async saveProject(project: Project): Promise<void> {
    const transaction = this.database.transaction(PROJECTS, "readwrite");
    transaction.objectStore(PROJECTS).put(project);
    await transactionDone(transaction, `saving project ${project.id}`);
  }

  async deleteProject(id: string): Promise<void> {
    const transaction = this.database.transaction([PROJECTS, AUDIO, COVERS, BACKUPS], "readwrite");
    transaction.objectStore(PROJECTS).delete(id);
    transaction.objectStore(AUDIO).delete(id);
    transaction.objectStore(COVERS).delete(id);
    const backupKeys = await requestToPromise(transaction.objectStore(BACKUPS).index(BACKUPS_BY_PROJECT).getAllKeys(id), `finding backups of ${id}`);
    for (const key of backupKeys) transaction.objectStore(BACKUPS).delete(key);
    await transactionDone(transaction, `deleting project ${id}`);
  }

  async saveAudio(audio: StoredAudio): Promise<void> {
    const transaction = this.database.transaction(AUDIO, "readwrite");
    transaction.objectStore(AUDIO).put(audio);
    await transactionDone(transaction, `saving audio for ${audio.projectId}`);
  }

  async loadAudio(projectId: string): Promise<StoredAudio | null> {
    const store = this.database.transaction(AUDIO, "readonly").objectStore(AUDIO);
    const audio = await requestToPromise(store.get(projectId) as IDBRequest<StoredAudio | undefined>, `loading audio for ${projectId}`);
    return audio ?? null;
  }

  async saveCover(cover: StoredCover): Promise<void> {
    const transaction = this.database.transaction(COVERS, "readwrite");
    transaction.objectStore(COVERS).put(cover);
    await transactionDone(transaction, `saving cover for ${cover.projectId}`);
  }

  async loadCover(projectId: string): Promise<StoredCover | null> {
    const store = this.database.transaction(COVERS, "readonly").objectStore(COVERS);
    const cover = await requestToPromise(store.get(projectId) as IDBRequest<StoredCover | undefined>, `loading cover for ${projectId}`);
    return cover ?? null;
  }

  async duplicateProject(sourceId: string, newId: string, newName: string, now: number): Promise<Project> {
    const source = await this.loadProject(sourceId);
    if (!source) throw new Error(`cannot duplicate project ${sourceId}: it does not exist`);
    const copy: Project = { ...structuredClone(source), id: newId, name: newName, createdAt: now, updatedAt: now };
    await this.saveProject(copy);
    const audio = await this.loadAudio(sourceId);
    if (audio) await this.saveAudio({ ...audio, projectId: newId });
    const cover = await this.loadCover(sourceId);
    if (cover) await this.saveCover({ ...cover, projectId: newId });
    return copy;
  }

  async createBackup(project: Project, label: string, now: number): Promise<void> {
    const transaction = this.database.transaction(BACKUPS, "readwrite");
    const store = transaction.objectStore(BACKUPS);
    const backup: Backup = { projectId: project.id, takenAt: now, label, project: structuredClone(project) };
    store.add(backup);
    const keys = await requestToPromise(store.index(BACKUPS_BY_PROJECT).getAllKeys(project.id), `counting backups of ${project.id}`);
    const sortedKeys = [...keys].sort((left, right) => Number(left) - Number(right));
    const surplus = sortedKeys.length - MAX_BACKUPS_PER_PROJECT;
    for (const key of sortedKeys.slice(0, Math.max(0, surplus))) store.delete(key);
    await transactionDone(transaction, `backing up project ${project.id}`);
  }

  async restoreBackup(backup: Backup, now: number): Promise<Project> {
    const current = await this.loadProject(backup.projectId);
    if (current) await this.createBackup(current, "before restore", now);
    const restored: Project = { ...structuredClone(backup.project), updatedAt: now };
    await this.saveProject(restored);
    return restored;
  }

  async listBackups(projectId: string): Promise<Backup[]> {
    const index = this.database.transaction(BACKUPS, "readonly").objectStore(BACKUPS).index(BACKUPS_BY_PROJECT);
    const backups = await requestToPromise(index.getAll(projectId) as IDBRequest<Backup[]>, `listing backups of ${projectId}`);
    return backups.map((backup) => ({ ...backup, project: withEveryDifficulty(backup.project) })).sort((left, right) => right.takenAt - left.takenAt);
  }
}
