import { useCallback, useState } from "react";
import { beatSaberInstalled, connectQuest, type QuestConnection, webUsbAvailable } from "../quest/usb";
import { errorMessage } from "./format";

export interface Headset {
  connection: QuestConnection | null;
  note: string | null;
  connecting: boolean;
  error: string | null;
  usbAvailable: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useHeadset(): Headset {
  const [connection, setConnection] = useState<QuestConnection | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const connected = await connectQuest();
      const installed = await beatSaberInstalled(connected);
      setConnection(connected);
      setNote(installed ? `Connected to ${connected.name}. Beat Saber is installed.` : `Connected to ${connected.name}, but Beat Saber was not found on it.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!connection) return;
    setError(null);
    try {
      await connection.adb.close();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setConnection(null);
      setNote(null);
    }
  }, [connection]);

  return { connection, note, connecting, error, usbAvailable: webUsbAvailable(), connect, disconnect };
}
