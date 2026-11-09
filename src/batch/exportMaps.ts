import { decodeAudio } from "../audio/decode";
import { AudioWorkerClient } from "../audio/workerProtocol";
import type { Project } from "../core/model";
import { mapFolderName } from "../export/beatmap";
import type { MapFiles } from "../export/package";
import { downloadBytes, prepareMapFiles } from "../export/prepare";
import { writeMapFolder } from "../quest/folder";
import { installOverUsb, listCustomLevelsIfPresent, type QuestConnection } from "../quest/usb";
import type { ProjectStore } from "../storage/projectStore";
import { hasErrors, validateProject } from "../validation/validate";
import { BATCH_REST_MS, MAX_ZIP_PART_BYTES } from "./limits";
import { ZipPartWriter } from "./zipParts";

export type ExportDestination =
  | { kind: "zip" }
  | { kind: "folder"; customLevels: FileSystemDirectoryHandle }
  | { kind: "quest"; connection: QuestConnection; replaceExisting: boolean };

export interface ExportProgress {
  done: number;
  total: number;
  current: string;
}

export interface ExportReport {
  exported: string[];
  skipped: { name: string; reason: string }[];
  alreadyOnHeadset: string[];
  zipParts: number;
}

export interface MapPreparer {
  prepare(project: Project): Promise<MapFiles>;
  dispose?(): void;
}

export interface ExportDependencies {
  store: ProjectStore;
  context: () => BaseAudioContext;
  onProgress: (progress: ExportProgress) => void;
  preparer?: MapPreparer;
}

function rest(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, BATCH_REST_MS));
}

function zipPartName(partNumber: number): string {
  const day = new Date().toISOString().slice(0, 10);
  return `beatquest-studio-maps-${day}-part-${partNumber}.zip`;
}

function workerPreparer(store: ProjectStore, context: () => BaseAudioContext): MapPreparer {
  let worker: AudioWorkerClient | null = null;
  const workerClient = () => (worker ??= new AudioWorkerClient());
  return {
    prepare: (project) => prepareMapFiles(project, store, (stored) => decodeAudio(context(), stored.bytes, stored.fileName), workerClient()),
    dispose: () => worker?.dispose(),
  };
}

async function foldersAlreadyOnHeadset(destination: ExportDestination): Promise<ReadonlySet<string>> {
  if (destination.kind !== "quest" || destination.replaceExisting) return new Set();
  return new Set(await listCustomLevelsIfPresent(destination.connection));
}

async function writeMap(destination: ExportDestination, zip: ZipPartWriter, folder: string, files: MapFiles): Promise<void> {
  if (destination.kind === "zip") await zip.add(folder, files);
  else if (destination.kind === "folder") await writeMapFolder(destination.customLevels, files, folder);
  else await installOverUsb(destination.connection, files, folder, () => undefined);
}

export async function exportProjects(projectIds: readonly string[], destination: ExportDestination, dependencies: ExportDependencies): Promise<ExportReport> {
  const { store, context, onProgress } = dependencies;
  const preparer = dependencies.preparer ?? workerPreparer(store, context);
  const zip = new ZipPartWriter(MAX_ZIP_PART_BYTES, (bytes, partNumber) => downloadBytes(bytes, zipPartName(partNumber), "application/zip"));
  const report: ExportReport = { exported: [], skipped: [], alreadyOnHeadset: [], zipParts: 0 };
  try {
    const onHeadset = await foldersAlreadyOnHeadset(destination);
    for (const [index, projectId] of projectIds.entries()) {
      const project = await store.loadProject(projectId);
      const name = project?.name ?? projectId;
      onProgress({ done: index, total: projectIds.length, current: name });
      if (!project) {
        report.skipped.push({ name, reason: "it is no longer in storage" });
        continue;
      }
      const issues = validateProject(project);
      if (hasErrors(issues)) {
        report.skipped.push({ name, reason: issues.find((issue) => issue.severity === "error")?.message ?? "it has errors" });
        continue;
      }
      const folder = mapFolderName(project);
      if (onHeadset.has(folder)) {
        report.alreadyOnHeadset.push(name);
        continue;
      }
      try {
        await writeMap(destination, zip, folder, await preparer.prepare(project));
        report.exported.push(name);
      } catch (cause) {
        report.skipped.push({ name, reason: cause instanceof Error ? cause.message : String(cause) });
      }
      await rest();
    }
    if (destination.kind === "zip") report.zipParts = await zip.finish();
    onProgress({ done: projectIds.length, total: projectIds.length, current: "" });
    return report;
  } finally {
    preparer.dispose?.();
  }
}
