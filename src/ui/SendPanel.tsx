import { useState } from "react";
import { type ExportDestination, type ExportProgress, type ExportReport, exportProjects } from "../batch/exportMaps";
import { folderPickerAvailable, pickCustomLevelsFolder } from "../quest/folder";
import type { ProjectStore } from "../storage/projectStore";
import { errorMessage } from "./format";
import { audioContext } from "./session";
import type { Headset } from "./useHeadset";

interface SendPanelProps {
  store: ProjectStore;
  selectedIds: readonly string[];
  headset: Headset;
  onClear: () => void;
}

interface FinishedReport {
  text: string;
  skipped: ExportReport["skipped"];
  alreadyOnHeadset: string[];
}

function mapCount(count: number): string {
  return `${count} ${count === 1 ? "map" : "maps"}`;
}

function reportText(report: ExportReport, destination: ExportDestination["kind"]): string {
  const count = mapCount(report.exported.length);
  if (destination === "quest") {
    const left = report.alreadyOnHeadset.length;
    const alreadyThere = left > 0 ? ` ${left} already on the headset ${left === 1 ? "was" : "were"} left alone.` : "";
    return `Installed ${count} on the Quest.${alreadyThere} Restart Beat Saber or refresh songs to see them.`;
  }
  const where = destination === "zip" ? ` in ${report.zipParts} zip ${report.zipParts === 1 ? "file" : "files"}` : " into CustomLevels";
  return `Exported ${count}${where}.`;
}

export function SendPanel({ store, selectedIds, headset, onClear }: SendPanelProps) {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [report, setReport] = useState<FinishedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaceOnHeadset, setReplaceOnHeadset] = useState(false);
  const busy = progress !== null || headset.connecting;

  const send = async (chooseDestination: () => Promise<ExportDestination | null>) => {
    setError(null);
    setReport(null);
    try {
      const destination = await chooseDestination();
      if (!destination) return;
      setProgress({ done: 0, total: selectedIds.length, current: "" });
      const result = await exportProjects(selectedIds, destination, { store, context: audioContext, onProgress: setProgress });
      setReport({ text: reportText(result, destination.kind), skipped: result.skipped, alreadyOnHeadset: result.alreadyOnHeadset });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setProgress(null);
    }
  };

  const installOnQuest = () => send(async () => {
    const connection = headset.connection ?? await headset.connect();
    return connection ? { kind: "quest", connection, replaceExisting: replaceOnHeadset } : null;
  });

  return (
    <section className="card send" data-testid="send-panel">
      <div className="send-head">
        <h3 data-testid="selected-count">{mapCount(selectedIds.length)} selected</h3>
        <button onClick={onClear} disabled={busy}>Clear</button>
      </div>
      <div className="toolbar wrap">
        <button className="primary" disabled={!headset.usbAvailable || busy} data-testid="install-many-quest" onClick={() => void installOnQuest()}>
          {headset.connection ? `Install ${selectedIds.length} on the Quest` : "Connect the Quest and install"}
        </button>
        <button disabled={busy} onClick={() => void send(async () => ({ kind: "zip" }))} data-testid="export-many-zip">Download .zip</button>
      </div>
      {!headset.usbAvailable && <p className="meta">Installing on the Quest needs WebUSB, so use Chrome or Edge on a computer.</p>}
      {headset.error && <div className="error-banner" role="alert">{headset.error}</div>}
      <details className="more">
        <summary>More options</summary>
        <div className="toolbar wrap">
          <button disabled={busy || !folderPickerAvailable()} onClick={() => void send(async () => ({ kind: "folder", customLevels: await pickCustomLevelsFolder() }))}>Save into a CustomLevels folder</button>
          <label>
            <input type="checkbox" checked={replaceOnHeadset} onChange={(event) => setReplaceOnHeadset(event.target.checked)} /> Replace maps already on the headset
          </label>
        </div>
        <p className="meta">Maps already on the headset are skipped unless you tick the box. Zips are split every 256 MB so a big export never has to sit in memory at once.</p>
      </details>
      {progress && (
        <div className="info-banner" role="status">
          Working on {Math.min(progress.done + 1, progress.total)} of {progress.total}{progress.current ? `: ${progress.current}` : ""}
          <progress className="batch-progress" max={progress.total} value={progress.done} />
        </div>
      )}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {report && (
        <div data-testid="export-many-result">
          <p className="meta ok">{report.text}</p>
          {(report.skipped.length > 0 || report.alreadyOnHeadset.length > 0) && (
            <ul className="batch-list">
              {report.alreadyOnHeadset.map((name) => <li key={`there-${name}`} className="existing"><span className="status">Already there</span><span className="label">{name}</span><span className="message">left alone on the headset</span></li>)}
              {report.skipped.map((skip) => <li key={skip.name} className="skipped"><span className="status">Skipped</span><span className="label">{skip.name}</span><span className="message">{skip.reason}</span></li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
