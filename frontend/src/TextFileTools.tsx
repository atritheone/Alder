import { useEffect, useState } from "react";
import type { Project } from "./types";
import { openDocuments, rememberDocumentFile } from "./openDocuments";
import { decodeTextBytes } from "./decodeTextBytes";
import TextCompareDialog from "./TextCompareDialog";
import TextFileMonitor from "./TextFileMonitor";
import { copyText } from "./clipboardText";
import { api, upload } from "./api";

type Info = NonNullable<
  Awaited<
    ReturnType<NonNullable<NonNullable<Window["alder"]>["documentFileInfo"]>>
  >
>;
export default function TextFileTools({
  project,
  flush,
  onOpen,
  onSaveAs,
  visible = true,
}: {
  project: Project;
  flush: () => Promise<void>;
  onOpen: (project: Project) => Promise<void>;
  onSaveAs: () => void;
  visible?: boolean;
}) {
  const [info, setInfo] = useState<Info | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [ignored, setIgnored] = useState(""),
    [comparison, setComparison] = useState<{
      left: string;
      right: string;
    } | null>(null);
  const [monitor, setMonitor] = useState(false);
  const [reopenEncoding, setReopenEncoding] = useState("utf-8");
  const [fingerprint, setFingerprint] = useState<{
    revision: number;
    digest: string;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (project.settings.documentKind === "txt" && info?.format === "txt")
      void api<{ revision: number; digest: string }>(
        `/api/projects/${project.id}/txt-file-fingerprint`,
      )
        .then((value) => {
          if (!cancelled && value.revision === project.revision)
            setFingerprint(value);
        })
        .catch((error) => {
          if (!cancelled) {
            setFingerprint({ revision: project.revision, digest: "" });
            setMessage((error as Error).message);
          }
        });
    else setFingerprint(null);
    return () => {
      cancelled = true;
    };
  }, [project.id, project.revision, info?.digest, info?.format]);
  const dirty =
    info?.format === "txt" && fingerprint
      ? fingerprint.digest !== info.digest
      : !info && !!project.book?.chapters.some((c) => c.text);
  const checking =
    info?.format === "txt" && fingerprint?.revision !== project.revision;
  useEffect(() => {
    if (checking) return;
    window.dispatchEvent(
      new CustomEvent("alder-txt-file-status", {
        detail: {
          projectId: project.id,
          dirty,
          path: info?.path,
          missing: info?.missing || false,
          external: info?.changed || false,
        },
      }),
    );
  }, [project.id, dirty, checking, info?.path, info?.missing, info?.changed]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void window.alder
        ?.documentFileInfo?.(project.id)
        .then((value) => {
          if (!cancelled) setInfo(value);
        })
        .catch((error) => {
          if (!cancelled) setMessage((error as Error).message);
        });
    };
    setInfo(null);
    setIgnored("");
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("alder-document-written", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("alder-document-written", refresh);
    };
  }, [project.id]);
  if (
    !window.alder?.documentFileInfo ||
    project.settings.documentKind !== "txt" ||
    (!visible && !info?.missing && !info?.changed)
  )
    return null;
  const read = async () => {
    if (!window.alder?.readDocumentFile)
      throw new Error("File reopening is unavailable.");
    return window.alder.readDocumentFile(project.id);
  };
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="txt-file-tools" aria-label="TXT file tools">
      {visible && (
        <>
          <span title={info?.path}>
            {info?.path?.split(/[\\/]/).at(-1) || "TXT recovery workspace"}
            {checking
              ? " · Checking file status…"
              : dirty
                ? " · Unsaved to file"
                : info?.format === "txt"
                  ? " · Saved to file"
                  : info
                    ? " · Alder project binding"
                    : ""}
          </span>
          {info && (
            <>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await copyText(info.path);
                    setMessage("File path copied.");
                  })
                }
              >
                Copy path
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await window.alder?.revealDocumentFile?.(project.id);
                  })
                }
              >
                Show in folder
              </button>
            </>
          )}
          {info?.format === "txt" && (
            <>
              <button
                disabled={busy || info.missing}
                onClick={() =>
                  void perform(async () => {
                    await flush();
                    const snapshot = await read();
                    const file = new File(
                      [new Uint8Array(snapshot.bytes)],
                      snapshot.name,
                      { type: "text/plain" },
                    );
                    await openDocuments([file], async (opened) => {
                      await window.alder?.bindReopenedDocument?.(
                        project.id,
                        opened.id,
                        snapshot.digest,
                      );
                      await rememberDocumentFile(opened.id, snapshot.path);
                      await onOpen(opened);
                    });
                  })
                }
              >
                Reload disk file in new tab
              </button>
              <button
                disabled={busy || info.missing}
                onClick={() =>
                  void perform(async () => {
                    const snapshot = await read();
                    setComparison({
                      left: decodeTextBytes(snapshot.bytes),
                      right:
                        project.book?.chapters.map((c) => c.text).join("\n") ||
                        "",
                    });
                  })
                }
              >
                Compare with disk
              </button>
              <button
                disabled={busy || info.missing}
                onClick={() => setMonitor(true)}
              >
                Monitor file
              </button>
            </>
          )}
          {info?.format === "txt" && (
            <>
              <label>
                Reopen encoding{" "}
                <select
                  aria-label="Reopen TXT encoding"
                  value={reopenEncoding}
                  onChange={(e) => setReopenEncoding(e.target.value)}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="utf-16-le">UTF-16 LE</option>
                  <option value="utf-16-be">UTF-16 BE</option>
                  <option value="cp1252">Windows-1252</option>
                </select>
              </label>
              <button
                disabled={busy || info.missing}
                onClick={() =>
                  void perform(async () => {
                    await flush();
                    const snapshot = await read();
                    const opened = await upload<Project>(
                      `/api/projects/${project.id}/txt-reopen?encoding=${encodeURIComponent(reopenEncoding)}`,
                      new File(
                        [new Uint8Array(snapshot.bytes)],
                        snapshot.name,
                        { type: "text/plain" },
                      ),
                    );
                    await window.alder?.bindReopenedDocument?.(
                      project.id,
                      opened.id,
                      snapshot.digest,
                    );
                    await rememberDocumentFile(opened.id, snapshot.path);
                    await onOpen(opened);
                  })
                }
              >
                Reopen using encoding in new tab
              </button>
            </>
          )}
        </>
      )}
      {info?.missing && (
        <span role="status">
          The source file is missing. Your recovery workspace is retained.{" "}
          <button onClick={onSaveAs}>Save As</button>
        </span>
      )}
      {info?.changed && !info.missing && info.currentDigest !== ignored && (
        <span role="status">
          This file changed outside Alder.{" "}
          <button onClick={() => setIgnored(info.currentDigest || "")}>
            Keep current workspace
          </button>
          <button onClick={onSaveAs}>Save As</button>
        </span>
      )}
      {message && <span role="status">{message}</span>}
      {comparison && (
        <TextCompareDialog
          left={comparison.left}
          right={comparison.right}
          leftLabel="Current disk file"
          rightLabel="Alder workspace"
          onClose={() => setComparison(null)}
        />
      )}
      {monitor && (
        <TextFileMonitor
          id={project.id}
          name={info?.path.split(/[\\/]/).at(-1) || project.name}
          onClose={() => setMonitor(false)}
        />
      )}
    </div>
  );
}
