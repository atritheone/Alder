import AlderLogo from "./AlderLogo";
import { useEffect, useRef, useState } from "react";
import { FilePlus2, FolderOpen, X } from "lucide-react";
import { api } from "./api";
import { DOCUMENT_FONT } from "./fontCatalogue";
import { newChapter } from "./book";
import type { Project } from "./types";
import "./start-screen.css";
import { openDocuments } from "./openDocuments";

export function NewDocument({
  onCreate,
  onClose,
}: {
  onCreate: (project: Project) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState("txt");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!form.current || !document.querySelector(".start-screen")) return;
    const element = form.current;
    const fit = () => {
      const rect = element.getBoundingClientRect();
      const fields = element.querySelector<HTMLElement>(".modal-fields");
      const overflow = fields
        ? Math.max(0, fields.scrollHeight - fields.clientHeight)
        : 0;
      void window.alder?.setWindowLayout(
        "start",
        Math.max(590, rect.width + 160),
        Math.max(460, rect.height + overflow + 160),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop form-backdrop">
      <form
        ref={form}
        className="modal new-document"
        aria-label="New document"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) {
            e.stopPropagation();
            onClose();
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const values = Object.fromEntries(
            new FormData(e.currentTarget),
          ) as Record<string, string>;
          setBusy(true);
          setError("");
          try {
            const project = await api<Project>("/api/projects", "POST", {
              name: values.name.trim(),
              template: "blank",
            });
            const book = kind === "book";
            project.book = {
              version: 1,
              chapters: Array.from(
                { length: book ? Number(values.chapters) : 1 },
                (_, i) => newChapter(book ? `Chapter ${i + 1}` : project.name),
              ),
            };
            project.clips = [];
            project.placements = [];
            Object.assign(project.settings, {
              documentKind: kind,
              preferredFormat: kind === "book" ? "pdf" : kind,
              fontFamily: DOCUMENT_FONT,
              pageSize: values.pageSize || "A4",
              orientation: values.orientation || "portrait",
              marginMm: Number(values.marginMm || 22),
              author: values.author || "",
              chapterPageBreaks: book,
              includeTitle: book && values.includeTitle === "on",
              includeToc: book && values.includeToc === "on",
              footer: book && values.footer === "on",
              firstPageNumber: Number(values.firstPageNumber || 1),
            });
            onCreate(
              await api<Project>(`/api/projects/${project.id}`, "PUT", {
                expectedRevision: project.revision,
                project,
              }),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <strong>New</strong>
          <button
            type="button"
            aria-label="Close new document"
            onClick={onClose}
            disabled={busy}
          >
            <X size={16} />
          </button>
        </header>
        <div className="modal-fields">
          <div
            className="document-kinds"
            role="group"
            aria-label="Document type"
          >
            {[
              ["txt", "Text document", ".txt"],
              ["docx", "Word document", ".docx"],
              ["book", "Book", "Chapters & pages"],
            ].map(([value, label, sub]) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                className={kind === value ? "active" : ""}
                onClick={() => setKind(value)}
              >
                <strong>{label}</strong>
                <small>{sub}</small>
              </button>
            ))}
          </div>
          <label>
            Name
            <input
              name="name"
              defaultValue="Untitled"
              required
              autoFocus
              maxLength={200}
            />
          </label>
          {kind === "book" && (
            <div className="new-book-fields">
              <label>
                Author
                <input name="author" />
              </label>
              <label>
                Chapters
                <input
                  name="chapters"
                  type="number"
                  min="1"
                  max="200"
                  step="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label>
                Page size
                <select name="pageSize" defaultValue="A5">
                  <option>A4</option>
                  <option>A5</option>
                  <option>Letter</option>
                  <option>Legal</option>
                  <option value="6x9">6 × 9 in</option>
                </select>
              </label>
              <label>
                Orientation
                <select name="orientation">
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label>
                Margins (mm)
                <input
                  name="marginMm"
                  type="number"
                  min="5"
                  max="45"
                  step="0.1"
                  defaultValue="22"
                  required
                />
              </label>
              <label>
                Start page numbering at
                <input
                  name="firstPageNumber"
                  type="number"
                  min="1"
                  max="9999"
                  step="1"
                  defaultValue="1"
                  required
                />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="footer" defaultChecked />
                Page numbers
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="includeTitle" defaultChecked />
                Title page
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="includeToc" />
                Table of contents
              </label>
            </div>
          )}
          <p className="quiet">
            {kind === "book"
              ? "Chapters flow onto pages as you write. Adjust typography and publication settings in Edit → Settings."
              : `Write in a blank document and save a ${kind === "txt" ? "plain text (.txt)" : "Word (.docx)"} file.`}
          </p>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <span />
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="accent" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </footer>
      </form>
    </div>
  );
}

export default function StartScreen({
  onOpen,
}: {
  onOpen: (p: Project) => void;
}) {
  const [mode, setMode] = useState<"home" | "new" | "open">("home");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode === "new" || !content.current) return;
    const element = content.current;
    const fit = () => {
      const scale =
        Number(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--ui-scale",
          ),
        ) || 1;
      const rect = element.getBoundingClientRect();
      void window.alder?.setWindowLayout(
        "start",
        Math.max(480, rect.width + 96 * scale),
        Math.max(300, rect.height + 60 * scale),
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [mode]);
  useEffect(() => {
    const open = () => setMode("open");
    window.addEventListener("alder-open-start", open);
    return () => window.removeEventListener("alder-open-start", open);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (mode === "open")
      void run(async () =>
        setProjects(
          (await api<{ projects: typeof projects }>("/api/projects")).projects,
        ),
      );
  }, [mode]);
  return (
    <main
      className={`start-screen${mode === "open" ? " start-screen--open" : ""}`}
    >
      <div className="start-content" ref={content}>
        <div className="start-brand">
          <AlderLogo />
          <h1>Alder</h1>
          <p>Organic Language Engine</p>
        </div>
        <div className="start-actions">
          <button onClick={() => setMode("new")}>
            <FilePlus2 size={20} />
            New
          </button>
          <button onClick={() => setMode(mode === "open" ? "home" : "open")}>
            <FolderOpen size={20} />
            Open
          </button>
        </div>
        {mode === "open" && (
          <section className="start-open" aria-label="Open document">
            <div className="manager-actions">
              <button disabled={busy} onClick={() => file.current?.click()}>
                Open file…
              </button>
            </div>
            {projects.length > 0 && <p className="quiet">Saved workspaces</p>}
            {projects.map((p) => (
              <button
                data-context-actions="self"
                data-context-label="Open"
                className="project-list-item"
                key={p.id}
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    onOpen(await api<Project>(`/api/projects/${p.id}`)),
                  )
                }
              >
                <FolderOpen size={16} />
                {p.name}
              </button>
            ))}
          </section>
        )}
        {busy && <p role="status">Opening…</p>}
        {error && <p role="alert">{error}</p>}
        <input
          ref={file}
          type="file"
          hidden
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (selected)
              void run(async () => {
                const opened = await openDocuments([selected]);
                if (opened) onOpen(opened);
              });
          }}
        />
      </div>
      {mode === "new" && (
        <NewDocument onCreate={onOpen} onClose={() => setMode("home")} />
      )}
    </main>
  );
}
