export interface FileEntryLike {
  isFile: true;
  isDirectory: false;
  name: string;
  file(resolve: (file: File) => void, reject: (cause: { message: string }) => void): void;
}

export interface DirectoryReaderLike {
  readEntries(resolve: (entries: EntryLike[]) => void, reject: (cause: { message: string }) => void): void;
}

export interface DirectoryEntryLike {
  isFile: false;
  isDirectory: true;
  name: string;
  createReader(): DirectoryReaderLike;
}

export type EntryLike = FileEntryLike | DirectoryEntryLike;

export interface DroppedItem {
  entry: EntryLike | null;
  file: File | null;
}

function readFile(entry: FileEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, (cause) => reject(new Error(`could not read "${entry.name}" (${cause.message})`))));
}

async function readAllEntries(directory: DirectoryEntryLike): Promise<EntryLike[]> {
  const reader = directory.createReader();
  const everything: EntryLike[] = [];
  for (;;) {
    const page = await new Promise<EntryLike[]>((resolve, reject) => reader.readEntries(resolve, (cause) => reject(new Error(`could not read the folder "${directory.name}" (${cause.message})`))));
    if (page.length === 0) return everything;
    everything.push(...page);
  }
}

async function filesOf(entry: EntryLike): Promise<File[]> {
  if (entry.isFile) return [await readFile(entry)];
  const children = await readAllEntries(entry);
  return (await Promise.all(children.map(filesOf))).flat();
}

export async function collectDroppedFiles(items: readonly DroppedItem[]): Promise<File[]> {
  const groups = await Promise.all(items.map(async (item) => {
    if (item.entry) return filesOf(item.entry);
    return item.file ? [item.file] : [];
  }));
  return groups.flat();
}
