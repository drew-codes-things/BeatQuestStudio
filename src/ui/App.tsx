import { useEffect, useState } from "react";
import { ProjectStore } from "../storage/projectStore";
import { Dashboard } from "./Dashboard";
import { errorMessage } from "./format";
import { ProjectView } from "./ProjectView";

export function App() {
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

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
        <span className="logo"><span className="red">Beatmap</span> <span className="blue">Studio</span></span>
      </header>
      {storeError && <main className="page"><div className="error-banner" role="alert">{storeError}</div></main>}
      {store && (openProjectId
        ? <ProjectView store={store} projectId={openProjectId} onClose={() => setOpenProjectId(null)} />
        : <Dashboard store={store} onOpen={setOpenProjectId} />)}
    </>
  );
}
