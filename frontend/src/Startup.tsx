import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import StartScreen from "./StartScreen";
import { readTextSessionManifest } from "./plainTextSessionManifest";
import type { StartupIntent } from "./startupIntent";

export default function Startup() {
  const [workspace, setWorkspace] = useState<ComponentType<{ initialIntent?: StartupIntent }> | null>(null);
  const intent = useRef<StartupIntent | undefined>(undefined);
  const loading = useRef<Promise<void> | null>(null);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const open = useCallback((next?: StartupIntent) => {
    if (loading.current) {
      if (next) {
        intent.current ??= {};
        if (next.paths) intent.current.paths = [...(intent.current.paths || []), ...next.paths];
        if (next.files) intent.current.files = [...(intent.current.files || []), ...next.files];
      }
      return loading.current;
    }
    intent.current = next;
    setOpening(true);
    loading.current = import("./WorkspaceApp").then(module => {
      setWorkspace(() => module.default);
    }).catch(cause => {
      setError(String(cause.message || cause));
      setOpening(false);
      loading.current = null;
    });
    return loading.current;
  }, []);
  useEffect(() => {
    if (workspace) return;
    const close = window.alder?.onCloseRequest(async () => {});
    const files = window.alder?.onOpenFiles?.(paths => { void open({ paths }); });
    const commands = window.alder?.onCommand(command => {
      if (command === "new") document.querySelector<HTMLButtonElement>(".start-actions button")?.click();
      else if (command === "open") window.dispatchEvent(new Event("alder-open-start"));
      else void open({ command });
    });
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      void open({ files: Array.from(event.dataTransfer.files) });
    };
    const over = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    void window.alder?.performance?.("renderer.shell");
    void window.alder?.ready?.().then(() => window.alder?.performance?.("renderer.core-ready")).catch(cause => setError(String(cause.message || cause)));
    if (localStorage.getItem("alder.txt.restoreSession") !== "false" && readTextSessionManifest().ids.length) void open();
    return () => { close?.(); files?.(); commands?.(); window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  }, [open, workspace]);
  if (workspace) { const Workspace = workspace; return <Workspace initialIntent={intent.current} />; }
  return <>
    <StartScreen opening={opening} onOpen={project => { void open({ project }); }}
      onCreate={(project, fromTemplate) => open({ project, fresh: !fromTemplate })}
      onOpenFiles={files => open({ files })} />
    {opening && <div className="open-progress" role="status">Opening…</div>}
    {error && <div className="open-progress" role="alert">{error}<button onClick={() => { setError(""); void open(intent.current); }}>Retry</button></div>}
  </>;
}
