import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { api } from "./api";
import type { Project } from "./types";
import "./word-processing.css";

type Version = {
  sequence: number;
  revision: number;
  name: string;
  updatedAt: string;
  current: boolean;
};
export default function DocumentVersions({
  projectId,
  onRecover,
  onClose,
}: {
  projectId: string;
  onRecover: (project: Project) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [versions, setVersions] = useState<Version[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    let current = true;
    api<Version[]>(`/api/projects/${projectId}/versions`)
      .then((items) => {
        if (current) setVersions(items);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [projectId]);
  const recover = async () => {
    if (selected === null) return;
    setBusy(true);
    try {
      await onRecover(
        await api<Project>(
          `/api/projects/${projectId}/versions/${selected}/recover`,
          "POST",
        ),
      );
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <dialog
      className="word-dialog"
      ref={dialog}
      aria-labelledby="versions-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <header>
        <strong id="versions-title">Saved versions</strong>
        <button
          disabled={busy}
          aria-label="Close saved versions"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="word-dialog-fields">
        <p>
          Recover an autosaved version as a separate document. The current
          document remains open.
        </p>
        {error && <p role="alert">{error}</p>}
        <select
          aria-label="Saved version"
          size={10}
          value={selected ?? ""}
          disabled={busy}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          {versions.map((version) => (
            <option key={version.sequence} value={version.sequence}>
              {new Date(version.updatedAt).toLocaleString()} · Revision{" "}
              {version.revision}
              {version.current ? " · Current" : ""}
            </option>
          ))}
        </select>
        <small>
          Up to 201 recent autosaves are retained. These are recovery snapshots;
          editor Undo retains individual editing actions.
        </small>
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
        <button
          disabled={busy || selected === null}
          className="accent"
          onClick={() => void recover()}
        >
          {busy ? "Recovering…" : "Recover a copy"}
        </button>
      </footer>
    </dialog>,
    document.body,
  );
}
