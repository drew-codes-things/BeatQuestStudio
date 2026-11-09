import { useEffect, useMemo, useState } from "react";
import { BatchMaker } from "../batch/batchMaker";
import { ProjectStore } from "../storage/projectStore";
import { useBatchSnapshot } from "./BatchPanel";
import { Dashboard } from "./Dashboard";
import { errorMessage } from "./format";
import { ProjectView } from "./ProjectView";
import { audioContext } from "./session";

function WarnWhileBatchRuns({ batch }: { batch: BatchMaker }) {
  const { running } = useBatchSnapshot(batch);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);
  return null;
}

export function App() {
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const batch = useMemo(() => (store ? new BatchMaker(store, audioContext) : null), [store]);

  useEffect(() => () => batch?.dispose(), [batch]);

  useEffect(() => {
    let opened: ProjectStore | null = null;
    ProjectStore.open()
      .then((result) => {
        opened = result;
        setStore(result);
      })
      .catch((cause: unknown) => setStoreError(`Browser storage is unavailable: ${errorMessage(cause)}`));
    return () => opened?.close();
  }, []);

  return (
    <>
      <header className="app-header">
        <span className="logo"><span className="red">BeatQuest</span> <span className="blue">Studio</span></span>
      </header>
      {storeError && <main className="page"><div className="error-banner" role="alert">{storeError}</div></main>}
      {batch && <WarnWhileBatchRuns batch={batch} />}
      {store && batch && (openProjectId
        ? <ProjectView store={store} projectId={openProjectId} onClose={() => setOpenProjectId(null)} />
        : <Dashboard store={store} batch={batch} onOpen={setOpenProjectId} />)}
    </>
  );
}
