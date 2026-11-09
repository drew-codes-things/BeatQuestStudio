import { Adb, AdbDaemonTransport, escapeArg } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { ReadableStream } from "@yume-chan/stream-extra";
import type { MapFiles } from "../export/package";

export const META_VENDOR_ID = 0x2833;
export const BEAT_SABER_PACKAGE = "com.beatgames.beatsaber";
export const CUSTOM_LEVELS_PATH = `/sdcard/ModData/${BEAT_SABER_PACKAGE}/Mods/SongCore/CustomLevels`;
const ADB_INTERFACE = { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 };
const CREDENTIAL_NAME = "BeatQuest Studio";

export interface DetectedHeadset {
  name: string;
  serial: string;
  usbDebugging: boolean;
}

export interface QuestConnection {
  adb: Adb;
  name: string;
  serial: string;
}

export function webUsbAvailable(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

function hasAdbInterface(device: USBDevice): boolean {
  return device.configurations.some((configuration) => configuration.interfaces.some((usbInterface) => usbInterface.alternates.some((alternate) =>
    alternate.interfaceClass === ADB_INTERFACE.classCode && alternate.interfaceSubclass === ADB_INTERFACE.subclassCode && alternate.interfaceProtocol === ADB_INTERFACE.protocolCode)));
}

export async function detectHeadset(): Promise<DetectedHeadset> {
  if (!webUsbAvailable()) throw new Error("this browser has no WebUSB; use Chrome or Edge on a computer");
  const device = await navigator.usb.requestDevice({ filters: [{ vendorId: META_VENDOR_ID }] });
  return { name: device.productName ?? "Meta headset", serial: device.serialNumber ?? "unknown", usbDebugging: hasAdbInterface(device) };
}

export async function connectQuest(): Promise<QuestConnection> {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) throw new Error("this browser has no WebUSB; use Chrome or Edge on a computer");
  const device = await manager.requestDevice({ filters: [{ vendorId: META_VENDOR_ID }] });
  if (!device) throw new Error("no headset was chosen. If the list was empty, turn on USB debugging in the Meta Horizon app's developer settings");
  let connection;
  try {
    connection = await device.connect();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`could not open the headset (${reason}). Close anything else using adb, such as SideQuest or a terminal adb server, then try again`);
  }
  const transport = await AdbDaemonTransport.authenticate({ serial: device.serial, connection, credentialStore: new AdbWebCredentialStore(CREDENTIAL_NAME) });
  return { adb: new Adb(transport), name: device.name, serial: device.serial };
}

export async function beatSaberInstalled(connection: QuestConnection): Promise<boolean> {
  const output = await connection.adb.subprocess.noneProtocol.spawnWaitText(["pm", "list", "packages", escapeArg(BEAT_SABER_PACKAGE)]);
  return output.split("\n").some((line) => line.trim() === `package:${BEAT_SABER_PACKAGE}`);
}

export async function listCustomLevels(connection: QuestConnection): Promise<string[]> {
  const sync = await connection.adb.sync();
  try {
    const entries = await sync.readdir(CUSTOM_LEVELS_PATH);
    return entries.map((entry) => entry.name).filter((name) => name !== "." && name !== "..").sort();
  } finally {
    await sync.dispose();
  }
}

export async function listCustomLevelsIfPresent(connection: QuestConnection): Promise<string[]> {
  try {
    return await listCustomLevels(connection);
  } catch {
    return [];
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function installOverUsb(connection: QuestConnection, files: MapFiles, mapFolderName: string, onProgress: (done: number, total: number) => void): Promise<string> {
  const folder = `${CUSTOM_LEVELS_PATH}/${mapFolderName}`;
  await connection.adb.subprocess.noneProtocol.spawnWaitText(["mkdir", "-p", escapeArg(folder)]);
  const names = Object.keys(files);
  const sync = await connection.adb.sync();
  try {
    for (const [index, name] of names.entries()) {
      await sync.write({ filename: `${folder}/${name}`, file: streamOf(files[name]!) });
      onProgress(index + 1, names.length);
    }
    const written = new Set((await sync.readdir(folder)).map((entry) => entry.name));
    const missing = names.filter((name) => !written.has(name));
    if (missing.length > 0) throw new Error(`the headset is missing ${missing.join(", ")} after the copy`);
  } finally {
    await sync.dispose();
  }
  return folder;
}
