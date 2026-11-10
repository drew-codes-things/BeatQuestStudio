import { AudioWorkerClient } from "../audio/workerProtocol";
import { DIFFICULTIES, difficultyLabel, newProject, type Project } from "../core/model";
import { FIXED_MAP_SEED, generateCharts } from "../generator/generate";
import { readSongDurationSeconds, readSongTags, songIdentity } from "../import/songIdentity";
import { type ReadSong, readSongFile, storeAutoCover, withImportedSong } from "../import/songImport";
import { type ProjectStore, type ProjectSummary, summarizeProject } from "../storage/projectStore";
import { findAlreadyMade } from "./alreadyMade";
import { BATCH_ITEM_TIMEOUT_MS, BATCH_REST_MS, hasStorageRoom, importRejection } from "./limits";
import { type BatchResult, BatchQueue } from "./queue";

const MEGABYTE = 1024 * 1024;

interface FileWithPath extends File {
  webkitRelativePath: string;
}

function labelFor(file: File): string {
  const relative = (file as FileWithPath).webkitRelativePath;
  return relative || file.name;
}

async function estimateStorage(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) return {};
  return navigator.storage.estimate();
}

export class BatchMaker {
  readonly queue: BatchQueue<File>;
  private worker: AudioWorkerClient | null = null;
  private generation = 0;
  private persistenceRequested = false;
  private known: ProjectSummary[] | null = null;

  constructor(private readonly store: ProjectStore, private readonly context: () => BaseAudioContext) {
    this.queue = new BatchQueue<File>({
      process: (file) => this.makeMap(file),
      timeoutMs: BATCH_ITEM_TIMEOUT_MS,
      restMs: BATCH_REST_MS,
      checkRoom: (file) => this.checkRoom(file),
      onTimeout: () => this.abandonCurrent(),
    });
  }

  addFiles(files: Iterable<File>): void {
    this.queue.add(Array.from(files, (file) => ({ input: file, label: labelFor(file), rejection: importRejection(file) })));
  }

  start(): void {
    this.known = null;
    this.requestPersistentStorage();
    void this.queue.start();
  }

  dispose(): void {
    this.queue.stop();
    this.worker?.dispose();
    this.worker = null;
  }

  private workerClient(): AudioWorkerClient {
    this.worker ??= new AudioWorkerClient();
    return this.worker;
  }

  private abandonCurrent(): void {
    this.generation += 1;
    this.worker?.dispose();
    this.worker = null;
  }

  private requestPersistentStorage(): void {
    if (this.persistenceRequested || !navigator.storage?.persist) return;
    this.persistenceRequested = true;
    void navigator.storage.persist();
  }

  private async checkRoom(file: File): Promise<string | null> {
    const estimate = await estimateStorage();
    if (hasStorageRoom(estimate, file.size)) return null;
    const freeMegabytes = Math.max(0, Math.round(((estimate.quota ?? 0) - (estimate.usage ?? 0)) / MEGABYTE));
    return `Browser storage is nearly full (${freeMegabytes} MB free), so the batch paused before "${file.name}". Delete projects you no longer need or free some disk space, then press Start again.`;
  }

  private async knownProjects(): Promise<ProjectSummary[]> {
    this.known ??= await this.store.listProjects();
    return this.known;
  }

  private async findAlreadyMade(file: File): Promise<ProjectSummary | null> {
    const identity = songIdentity(await readSongTags(file), file.name);
    return findAlreadyMade(await this.knownProjects(), identity, () => readSongDurationSeconds(file));
  }

  private async makeMap(file: File): Promise<BatchResult> {
    const alreadyMade = await this.findAlreadyMade(file);
    if (alreadyMade) return { message: `Matches your project "${alreadyMade.name}", so it was left alone`, projectId: alreadyMade.id, alreadyMade: true };
    const startedIn = this.generation;
    const read = await readSongFile(file, this.context(), this.workerClient());
    const { title } = read.identity;
    const now = Date.now();
    const project = withImportedSong(newProject(crypto.randomUUID(), title, now), { storedFileName: read.audio.fileName, identity: read.identity, analysis: read.analysis }, now);
    const charts = generateCharts(project.timing, read.analysis, DIFFICULTIES, FIXED_MAP_SEED, () => crypto.randomUUID());
    if (startedIn !== this.generation) throw new Error(`"${file.name}" was abandoned after taking too long`);
    const made = { ...project, charts: { ...project.charts, ...charts } };
    await this.saveProjectWithAudio(made, read);
    (await this.knownProjects()).push(summarizeProject(made));
    const counts = DIFFICULTIES.map((difficulty) => `${difficultyLabel(difficulty)} ${charts[difficulty]?.notes.length ?? 0}`).join(", ");
    const named = read.identity.artist ? `${read.identity.artist} - ${title}` : title;
    return { message: `${named}, ${Math.round(project.timing.bpm * 100) / 100} BPM${read.strippedFromVideo ? ", sound taken from the video" : ""}: ${counts} notes`, projectId: project.id };
  }

  private async saveProjectWithAudio(project: Project, read: ReadSong): Promise<void> {
    try {
      await this.store.saveAudio({ projectId: project.id, ...read.audio });
      await storeAutoCover(this.store, project.id, read);
      await this.store.saveProject(project);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      try {
        await this.store.deleteProject(project.id);
      } catch (cleanup) {
        throw new Error(`saving failed (${reason}) and the half-saved project could not be removed (${cleanup instanceof Error ? cleanup.message : String(cleanup)})`);
      }
      throw new Error(`saving failed: ${reason}`);
    }
  }
}
