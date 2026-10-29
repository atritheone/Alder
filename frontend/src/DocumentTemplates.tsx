import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "./api";
import type { Project } from "./types";

export type DocumentTemplate = {
  id: string;
  name: string;
  kind: string;
  content: boolean;
  createdAt: string;
};

export default function DocumentTemplates({
  project,
  flush,
  onNew,
}: {
  project: Project;
  flush: () => Promise<void>;
  onNew: () => void;
}) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(project.name);
  const [content, setContent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<DocumentTemplate | null>(null);
  const refresh = async () =>
    setTemplates(
      (await api<{ templates: DocumentTemplate[] }>("/api/document-templates"))
        .templates,
    );
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="document-templates">
      <div className="manager-toolbar">
        <button onClick={onNew}>New from template…</button>
        <button
          aria-label="Save document as template"
          title="Save document as template"
          disabled={busy}
          onClick={() => {
            setName(project.name);
            setAdding(!adding);
          }}
        >
          <Plus size={17} />
        </button>
      </div>
      {adding && (
        <form
          aria-label="Save template"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const projectId = project.id;
              await flush();
              await api(
                `/api/projects/${projectId}/document-template`,
                "POST",
                { name, content },
              );
              setAdding(false);
            });
          }}
        >
          <label>
            Template name
            <input
              aria-label="Template name"
              autoFocus
              maxLength={200}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Include
            <select
              aria-label="Template contents"
              value={content ? "document" : "formatting"}
              onChange={(e) => setContent(e.target.value === "document")}
            >
              <option value="document">Document and formatting</option>
              <option value="formatting">Formatting only</option>
            </select>
          </label>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button disabled={busy} type="submit">
              Save template
            </button>
          </div>
        </form>
      )}
      {templates.map((template) => (
        <article
          className="voice-card"
          key={template.id}
          data-context-actions="button"
        >
          <div className="voice-card-name">
            <strong>{template.name}</strong>
            <small>
              {template.kind === "book"
                ? "Book"
                : template.kind === "txt"
                  ? "Text document"
                  : "Word document"}{" "}
              ·{" "}
              {template.content ? "Document and formatting" : "Formatting only"}
            </small>
          </div>
          <div className="voice-card-actions">
            <button
              aria-label={`Remove template ${template.name}`}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/api/document-templates/${template.id}`, "DELETE");
                  setRemoved(template);
                })
              }
            >
              <X size={14} />
            </button>
          </div>
        </article>
      ))}
      {!templates.length && !adding && (
        <p className="quiet">
          Save this document’s layout and styles with the plus button.
        </p>
      )}
      {removed && (
        <div role="status">
          Removed {removed.name}.{" "}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api(
                  `/api/document-templates/${removed.id}/restore`,
                  "POST",
                );
                setRemoved(null);
              })
            }
          >
            Undo removal
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
