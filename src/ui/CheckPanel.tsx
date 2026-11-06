import { useMemo, useState } from "react";
import type { AudioWorkerClient } from "../audio/workerProtocol";
import type { Project } from "../core/model";
import { mapFolderName } from "../export/beatmap";
import { zipMapFiles } from "../export/package";
import { downloadBytes, prepareMapFiles } from "../export/prepare";
import { folderPickerAvailable, installIntoFolder } from "../quest/folder";
import { beatSaberInstalled, connectQuest, CUSTOM_LEVELS_PATH, type DetectedHeadset, detectHeadset, installOverUsb, listCustomLevels, type QuestConnection, webUsbAvailable } from "../quest/usb";
import type { ProjectStore } from "../storage/projectStore";
import { hasErrors, type Issue, validateProject } from "../validation/validate";
import type { EditorFocus } from "./editor/Editor";
import { errorMessage } from "./format";
import type { SongSession } from "./session";

interface CheckPanelProps {
  project: Project;
  store: ProjectStore;
  session: SongSession | null;
  worker: AudioWorkerClient;
  onFocus: (focus: EditorFocus) => void;
}

function IssueList({ issues, onFocus }: { issues: Issue[]; onFocus: (focus: EditorFocus) => void }) {
  if (issues.length === 0) return <p className="meta ok" data-testid="no-issues">No problems found.</p>;
  return (
    <ul className="issue-list" data-testid="issues">
      {issues.map((issue, index) => {
        const canJump = issue.difficulty !== null && issue.beat !== null;
        return (
          <li key={`${issue.code}-${index}`} className={issue.severity}>
            <span className="severity">{issue.severity === "error" ? "Error" : "Warning"}</span>
            {issue.difficulty && <span className="difficulty">{issue.difficulty}</span>}
            <span className="spacer">{issue.message}</span>
            {canJump && <button onClick={() => onFocus({ difficulty: issue.difficulty!, beat: issue.beat!, ids: issue.objectIds })}>Show</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function CheckPanel({ project, store, session, worker, onFocus }: CheckPanelProps) {
  const issues = useMemo(() => validateProject(project), [project]);
  const blocked = hasErrors(issues);
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headset, setHeadset] = useState<DetectedHeadset | null>(null);
  const [quest, setQuest] = useState<QuestConnection | null>(null);
  const [questInfo, setQuestInfo] = useState<string | null>(null);
  const folder = mapFolderName(project);

  const run = async (label: string, action: () => Promise<string>) => {
    setBusy(label);
    setError(null);
    setResult(null);
    try {
      setResult(await action());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const files = () => prepareMapFiles(project, store, session?.buffer ?? null, worker);

  const download = () => run("Building the map...", async () => {
    const zip = zipMapFiles(await files());
    downloadBytes(zip, `${folder}.zip`, "application/zip");
    return `Downloaded ${folder}.zip (${Math.round(zip.length / 1024)} KB).`;
  });

  const saveToFolder = () => run("Writing to the folder...", async () => `Saved to ${await installIntoFolder(await files(), folder)}.`);

  const detect = () => run("Looking for the headset...", async () => {
    const found = await detectHeadset();
    setHeadset(found);
    return found.usbDebugging ? `Found ${found.name} with USB debugging on.` : `Found ${found.name}, but USB debugging is off, so files cannot be sent over USB.`;
  });

  const connect = () => run("Connecting... put the headset on and allow USB debugging if it asks.", async () => {
    const connection = await connectQuest();
    setQuest(connection);
    const installed = await beatSaberInstalled(connection);
    const levels = installed ? await listCustomLevels(connection).catch(() => []) : [];
    setQuestInfo(installed ? `Beat Saber is installed; ${levels.length} custom levels in CustomLevels.` : "Beat Saber was not found on this headset.");
    return `Connected to ${connection.name} (${connection.serial}).`;
  });

  const installUsb = () => run("Sending to the headset...", async () => {
    if (!quest) throw new Error("connect the headset first");
    const path = await installOverUsb(quest, await files(), folder, (done, total) => setBusy(`Sending to the headset... ${done} of ${total} files`));
    return `Installed to ${path}. Restart Beat Saber or refresh songs to see it.`;
  });

  return (
    <main className="page">
      <section className="card">
        <h3>Check</h3>
        <p className="meta">{issues.length === 0 ? "" : `${issues.filter((issue) => issue.severity === "error").length} errors, ${warnings} warnings. Warnings never change the map; fix what matters to you.`}</p>
        <IssueList issues={issues} onFocus={onFocus} />
      </section>
      <section className="card">
        <h3>Export</h3>
        <p className="meta">Info.dat 2.1.0, difficulties in v3.3.0, Ogg Vorbis song.egg and a cover. Folder: <code>{folder}</code></p>
        {blocked && <div className="error-banner">Fix the errors above before exporting.</div>}
        {busy && <div className="info-banner" role="status">{busy}</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}
        {result && <p className="meta ok" role="status" data-testid="export-result">{result}</p>}
        <div className="toolbar">
          <button className="primary" disabled={blocked || busy !== null} onClick={() => void download()} data-testid="download-zip">
            {warnings > 0 ? `Download .zip (${warnings} warnings)` : "Download .zip"}
          </button>
          <button disabled={blocked || busy !== null || !folderPickerAvailable()} onClick={() => void saveToFolder()}>Save into a CustomLevels folder</button>
        </div>
      </section>
      <section className="card">
        <h3>Quest</h3>
        <p className="meta">
          Over USB: turn on developer mode for the headset in the Meta Horizon phone app, plug it in, and accept "Allow USB debugging" inside the headset.
          The map goes to <code>{CUSTOM_LEVELS_PATH}</code>. Close SideQuest or any adb server first, because only one program can use the headset at a time.
        </p>
        {!webUsbAvailable() && <div className="error-banner">This browser has no WebUSB. Use Chrome or Edge.</div>}
        <div className="toolbar">
          <button disabled={!webUsbAvailable() || busy !== null} onClick={() => void detect()}>Detect headset</button>
          <button disabled={!webUsbAvailable() || busy !== null} onClick={() => void connect()}>Connect</button>
          <button className="primary" disabled={!quest || blocked || busy !== null} onClick={() => void installUsb()}>Install on Quest</button>
        </div>
        {headset && <p className="meta" data-testid="headset">{headset.name} · serial {headset.serial} · USB debugging {headset.usbDebugging ? "on" : "off"}</p>}
        {questInfo && <p className="meta">{questInfo}</p>}
        <details>
          <summary>Without USB debugging</summary>
          <ol className="meta">
            <li>Download the .zip and unzip it into a folder named <code>{folder}</code>.</li>
            <li>Plug the Quest into a computer and allow file access in the headset.</li>
            <li>Copy that folder into <code>Internal shared storage/ModData/com.beatgames.beatsaber/Mods/SongCore/CustomLevels</code>.</li>
            <li>On Linux the headset can be opened as a folder, so "Save into a CustomLevels folder" can write there directly.</li>
          </ol>
        </details>
      </section>
    </main>
  );
}
