import { describe, expect, it } from "vitest";
import { collectDroppedFiles, type DroppedItem, type EntryLike } from "./dropped";

const file = (name: string) => new File(["x"], name);

function fileEntry(name: string): EntryLike {
  return { isFile: true, isDirectory: false, name, file: (resolve) => resolve(file(name)) };
}

function directoryEntry(name: string, children: EntryLike[], pageSize = 100): EntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (resolve) => {
          const page = children.slice(offset, offset + pageSize);
          offset += pageSize;
          resolve(page);
        },
      };
    },
  };
}

describe("collectDroppedFiles", () => {
  it("returns plain dropped files", async () => {
    const files = await collectDroppedFiles([{ entry: null, file: file("a.mp3") }, { entry: null, file: file("b.wav") }]);
    expect(files.map((found) => found.name)).toEqual(["a.mp3", "b.wav"]);
  });

  it("walks folders and nested folders", async () => {
    const items: DroppedItem[] = [{ entry: directoryEntry("album", [fileEntry("one.mp3"), directoryEntry("disc2", [fileEntry("two.flac")])]), file: null }, { entry: fileEntry("loose.ogg"), file: null }];
    const files = await collectDroppedFiles(items);
    expect(files.map((found) => found.name).sort()).toEqual(["loose.ogg", "one.mp3", "two.flac"]);
  });

  it("keeps reading a folder until it has every entry, since browsers hand them over in pages", async () => {
    const many = Array.from({ length: 250 }, (_, index) => fileEntry(`song-${index}.mp3`));
    const files = await collectDroppedFiles([{ entry: directoryEntry("big", many, 100), file: null }]);
    expect(files).toHaveLength(250);
  });

  it("falls back to the file when the browser gives no entry", async () => {
    const files = await collectDroppedFiles([{ entry: null, file: file("only.mp3") }]);
    expect(files).toHaveLength(1);
  });

  it("skips an item that is neither", async () => {
    expect(await collectDroppedFiles([{ entry: null, file: null }])).toEqual([]);
  });

  it("reports a file that cannot be read instead of hiding it", async () => {
    const broken: EntryLike = { isFile: true, isDirectory: false, name: "bad.mp3", file: (_resolve, reject) => reject(new Error("permission denied")) };
    await expect(collectDroppedFiles([{ entry: broken, file: null }])).rejects.toThrow(/bad\.mp3.*permission denied/);
  });
});
