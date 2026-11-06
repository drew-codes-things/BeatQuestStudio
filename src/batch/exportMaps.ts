import { decodeAudio } from "../audio/decode";
import { AudioWorkerClient } from "../audio/workerProtocol";
import { mapFolderName } from "../export/beatmap";
import { downloadBytes, prepareMapFiles } from "../export/prepare";
import { writeMapFolder } from "../quest/folder";
import type { ProjectStore } from "../storage/projectStore";
import { hasErrors, validateProject } from "../validation/validate";
import { BATCH_REST_MS, MAX_ZIP_PART_BYTES } from "./limits";
import { ZipPartWriter } from "./zipParts";

export type ExportDestination = { kind: "zip" } | { kind: "folder"; customLevels: FileSystemDirectoryHandle };

export interface ExportProgress {
  done: number;
  total: number;
  current: string;
}

export interface ExportReport {
  exported: string[];
  skipped: { name: string; reason: string }[];
  zipParts: number;
}

export interface ExportDependencies {
  store: ProjectStore;
  context: () => BaseAudioContext;
  onProgress: (progress: ExportProgress) => void;
}

function rest(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, BATCH_REST_MS));
}

function zipPartName(partNumber: number): string {
  const day = new Date().toISOString().slice(0, 10);
  return `beatmap-studio-maps-${day}-part-${partNumber}.zip`;
}

export async function exportProjects(projectIds: readonly string[], destination: ExportDestination, dependencies: ExportDependencies): Promise<ExportReport> {
  const { store, context, onProgress } = dependencies;
  const worker = new AudioWorkerClient();
  const zip = new ZipPartWriter(MAX_ZIP_PART_BYTES, (bytes, partNumber) => downloadBytes(bytes, zipPartName(partNumber), "application/zip"));
  const report: ExportReport = { exported: [], skipped: [], zipParts: 0 };
  try {
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
      try {
        const files = await prepareMapFiles(project, store, (stored) => decodeAudio(context(), stored.bytes, stored.fileName), worker);
        const folder = mapFolderName(project);
        if (destination.kind === "zip") await zip.add(folder, files);
        else await writeMapFolder(destination.customLevels, files, folder);
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
    worker.dispose();
  }
}
