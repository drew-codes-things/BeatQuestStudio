import { describe, expect, it } from "vitest";
import { CUSTOM_LEVELS_PATH, type QuestConnection } from "./usb";
import { deleteInstalledSong, matchStudioProject, parseInfoDat, readInstalledSongs } from "./installedSongs";

const DIRECTORY = 4;
const FILE = 8;
const encode = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));

const infoV2 = {
  _version: "2.1.0",
  _songName: "Night Drive",
  _songSubName: "Radio Edit",
  _songAuthorName: "Test Artist",
  _levelAuthorName: "Some Mapper",
  _beatsPerMinute: 128,
  _difficultyBeatmapSets: [
    { _beatmapCharacteristicName: "Standard", _difficultyBeatmaps: [{ _difficulty: "Expert" }, { _difficulty: "Easy" }, { _difficulty: "ExpertPlus" }] },
    { _beatmapCharacteristicName: "OneSaber", _difficultyBeatmaps: [{ _difficulty: "Easy" }] },
  ],
};

const infoV4 = {
  version: "4.0.0",
  song: { title: "New Format Song", subTitle: "", author: "Band" },
  audio: { bpm: 140.5 },
  difficultyBeatmaps: [
    { characteristic: "Standard", difficulty: "Hard", beatmapAuthors: { mappers: ["Mapper One", "Mapper Two"], lighters: [] } },
    { characteristic: "Standard", difficulty: "Normal", beatmapAuthors: { mappers: ["Mapper One"], lighters: [] } },
  ],
};

interface FolderSpec {
  files: Record<string, Uint8Array | string>;
}

function fakeHeadset(folders: Record<string, FolderSpec>, extras: { strayFile?: boolean; missingRoot?: boolean } = {}) {
  const commands: string[][] = [];
  const present = new Set(Object.keys(folders));
  let reads = 0;
  const bytesOf = (value: Uint8Array | string) => (typeof value === "string" ? encode(value) : value);
  const folderOf = (path: string) => path.slice(CUSTOM_LEVELS_PATH.length + 1).split("/");
  const sync = {
    readdir: async (path: string) => {
      if (path === CUSTOM_LEVELS_PATH) {
        if (extras.missingRoot) throw new Error("no such directory");
        const entries = [...present].map((name) => ({ name, type: DIRECTORY, size: 4096n }));
        return [{ name: ".", type: DIRECTORY, size: 0n }, { name: "..", type: DIRECTORY, size: 0n }, ...(extras.strayFile ? [{ name: "stray.zip", type: FILE, size: 9n }] : []), ...entries];
      }
      const [folder] = folderOf(path);
      if (!folder || !present.has(folder)) throw new Error("no such directory");
      return Object.entries(folders[folder]!.files).map(([name, value]) => ({ name, type: FILE, size: BigInt(bytesOf(value).length) }));
    },
    read: (path: string) => {
      reads += 1;
      const [folder, file] = folderOf(path);
      const bytes = bytesOf(folders[folder!]!.files[file!]!);
      return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close(); } });
    },
    dispose: async () => {},
  };
  const adb = {
    subprocess: {
      noneProtocol: {
        spawnWaitText: async (args: string[]) => {
          commands.push(args);
          if (args[0] === "rm") {
            const target = args[args.length - 1]!.slice(1, -1).replaceAll("'\\''", "'");
            present.delete(target.slice(CUSTOM_LEVELS_PATH.length + 1));
          }
          return "";
        },
      },
    },
    sync: async () => sync,
  };
  return { connection: { adb, name: "Quest 3S", serial: "1WMHH" } as unknown as QuestConnection, commands, present, readCount: () => reads };
}

describe("parseInfoDat", () => {
  it("reads the older Info.dat layout and orders difficulties from easiest to hardest", () => {
    expect(parseInfoDat(JSON.stringify(infoV2))).toEqual({ title: "Night Drive", subTitle: "Radio Edit", artist: "Test Artist", mapper: "Some Mapper", bpm: 128, difficulties: ["Easy", "Expert", "Expert+"] });
  });

  it("reads the newer Info.dat layout and joins mapper names", () => {
    expect(parseInfoDat(JSON.stringify(infoV4))).toEqual({ title: "New Format Song", subTitle: "", artist: "Band", mapper: "Mapper One, Mapper Two", bpm: 140.5, difficulties: ["Normal", "Hard"] });
  });

  it("copes with a byte order mark at the start of the file", () => {
    expect(parseInfoDat(`\uFEFF${JSON.stringify(infoV2)}`)?.title).toBe("Night Drive");
  });

  it("gives null for text that is not a map description", () => {
    expect(parseInfoDat("not json")).toBeNull();
    expect(parseInfoDat("[1,2]")).toBeNull();
    expect(parseInfoDat("{}")).toBeNull();
  });
});

describe("readInstalledSongs", () => {
  const folders = {
    "aaaaaa (Night Drive - Some Mapper)": { files: { "Info.dat": JSON.stringify(infoV2), "song.egg": new Uint8Array(1000), "cover.png": new Uint8Array(500) } },
    "25f3f (New Format Song - Mapper One)": { files: { "info.dat": JSON.stringify(infoV4), "song.egg": new Uint8Array(2000) } },
    "no-info-here": { files: { "song.egg": new Uint8Array(10) } },
    "garbage": { files: { "Info.dat": "{{{" } },
  };

  it("lists each song folder with its details and total size, ignoring files in CustomLevels", async () => {
    const headset = fakeHeadset(folders, { strayFile: true });
    const songs = await readInstalledSongs(headset.connection, { onProgress: () => {}, shouldStop: () => false });
    expect(songs.map((song) => song.folder).sort()).toEqual(["25f3f (New Format Song - Mapper One)", "aaaaaa (Night Drive - Some Mapper)", "garbage", "no-info-here"]);
    const night = songs.find((song) => song.folder.startsWith("aaaaaa"))!;
    expect(night).toMatchObject({ title: "Night Drive", artist: "Test Artist", mapper: "Some Mapper", bpm: 128, difficulties: ["Easy", "Expert", "Expert+"], sizeBytes: JSON.stringify(infoV2).length + 1500, problem: null });
    expect(songs.find((song) => song.folder.startsWith("25f3f"))).toMatchObject({ title: "New Format Song", sizeBytes: JSON.stringify(infoV4).length + 2000 });
  });

  it("says what is wrong with a folder that has no readable Info.dat and keeps going", async () => {
    const songs = await readInstalledSongs(fakeHeadset(folders).connection, { onProgress: () => {}, shouldStop: () => false });
    const noInfo = songs.find((song) => song.folder === "no-info-here")!;
    const garbage = songs.find((song) => song.folder === "garbage")!;
    expect(noInfo.problem).toMatch(/no Info\.dat/);
    expect(noInfo.title).toBe("no-info-here");
    expect(garbage.problem).toMatch(/could not be read/);
  });

  it("reports progress for every folder", async () => {
    const seen: number[] = [];
    await readInstalledSongs(fakeHeadset(folders).connection, { onProgress: (progress) => seen.push(progress.done), shouldStop: () => false });
    expect(seen.at(-1)).toBe(4);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("stops when asked and returns what it has read so far", async () => {
    let asked = 0;
    const songs = await readInstalledSongs(fakeHeadset(folders).connection, { onProgress: () => {}, shouldStop: () => ++asked > 2 });
    expect(songs).toHaveLength(2);
  });

  it("returns an empty list when the headset has no CustomLevels folder yet", async () => {
    expect(await readInstalledSongs(fakeHeadset({}, { missingRoot: true }).connection, { onProgress: () => {}, shouldStop: () => false })).toEqual([]);
  });
});

describe("deleteInstalledSong", () => {
  const folders = { "aaaaaa (Night Drive - Some Mapper)": { files: { "Info.dat": "{}" } }, "keep me": { files: {} } };

  it("removes just that folder and confirms it is gone", async () => {
    const headset = fakeHeadset(folders);
    await deleteInstalledSong(headset.connection, "aaaaaa (Night Drive - Some Mapper)");
    expect([...headset.present]).toEqual(["keep me"]);
    expect(headset.commands).toHaveLength(1);
    expect(headset.commands[0]!.slice(0, 2)).toEqual(["rm", "-r"]);
    expect(headset.commands[0]!.at(-1)).toBe(`'${CUSTOM_LEVELS_PATH}/aaaaaa (Night Drive - Some Mapper)'`);
  });

  it.each(["", ".", "..", "../x", "a/b", "/etc", "a\0b"])("refuses the unsafe name %j without touching the headset", async (name) => {
    const headset = fakeHeadset(folders);
    await expect(deleteInstalledSong(headset.connection, name)).rejects.toThrow(/folder name/);
    expect(headset.commands).toEqual([]);
  });

  it("escapes a name with a quote in it", async () => {
    const headset = fakeHeadset({ "it's (Song - Me)": { files: {} } });
    await deleteInstalledSong(headset.connection, "it's (Song - Me)");
    expect(headset.commands[0]!.at(-1)).toContain("it'\\''s");
    expect(headset.present.size).toBe(0);
  });

  it("does not report a removal it could not confirm", async () => {
    const headset = fakeHeadset(folders);
    headset.connection.adb.subprocess.noneProtocol.spawnWaitText = async () => "rm: Permission denied";
    headset.connection.adb.sync = async () => ({
      readdir: async () => { throw new Error("transport closed"); },
      dispose: async () => {},
    }) as never;
    await expect(deleteInstalledSong(headset.connection, "aaaaaa (Night Drive - Some Mapper)")).rejects.toThrow(/transport closed/);
  });

  it("says so when the folder is still there afterwards", async () => {
    const headset = fakeHeadset(folders);
    headset.connection.adb.subprocess.noneProtocol.spawnWaitText = async () => "";
    await expect(deleteInstalledSong(headset.connection, "keep me")).rejects.toThrow(/still on the headset/);
  });
});

describe("matchStudioProject", () => {
  const projects = [{ id: "aaaaaa11-2222-4333-8444-555555555555", name: "Night Drive" }, { id: "bbbbbb11-2222-4333-8444-555555555555", name: "Other" }];

  it("finds the project a folder was made from by the id at the start of its name", () => {
    expect(matchStudioProject("aaaaaa (Night Drive - Some Mapper)", projects)?.name).toBe("Night Drive");
  });

  it("does not claim folders from elsewhere", () => {
    expect(matchStudioProject("25f3f (Song - Mapper)", projects)).toBeNull();
    expect(matchStudioProject("aaaaaa-not-ours", projects)).toBeNull();
  });
});
