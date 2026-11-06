import type { MapFiles } from "../export/package";

export const CUSTOM_LEVELS_FOLDER = "CustomLevels";

interface DirectoryPickerWindow {
  showDirectoryPicker(options: { id?: string; mode: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}

export function folderPickerAvailable(): boolean {
  return "showDirectoryPicker" in window;
}

export async function pickCustomLevelsFolder(): Promise<FileSystemDirectoryHandle> {
  if (!folderPickerAvailable()) throw new Error("this browser cannot write to folders; use Chrome or Edge");
  const picker = window as unknown as DirectoryPickerWindow;
  const chosen = await picker.showDirectoryPicker({ id: "beatsaber-custom-levels", mode: "readwrite" });
  if (chosen.name !== CUSTOM_LEVELS_FOLDER) {
    throw new Error(`pick the folder called ${CUSTOM_LEVELS_FOLDER} (you picked "${chosen.name}")`);
  }
  return chosen;
}

export async function writeMapFolder(customLevels: FileSystemDirectoryHandle, files: MapFiles, mapFolderName: string): Promise<string> {
  const mapFolder = await customLevels.getDirectoryHandle(mapFolderName, { create: true });
  for (const [name, bytes] of Object.entries(files)) {
    const handle = await mapFolder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }
  return `${CUSTOM_LEVELS_FOLDER}/${mapFolderName}`;
}
