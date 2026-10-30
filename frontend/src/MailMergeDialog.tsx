import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DOMSerializer, type Schema } from "prosemirror-model";
import { X } from "lucide-react";
import { api } from "./api";
import type { DocNode, Project } from "./types";
import { styleSheet } from "./styleResolution";
import {
  mergeFieldKeys,
  mergePreview,
  mergeRecordSelection,
  mergeTemplateContent,
} from "./mailMerge";

type Data = { headers: string[]; rows: string[][] };
type Created = { id: string; name: string }[];
export default function MailMergeDialog({
  project,
  schema,
  onInsert,
  onCreate,
  onOpen,
  onClose,
}: {
  project: Project;
  schema: Schema;
  onInsert: (name: string) => void;
  onCreate: (
    rows: Record<string, string>[],
    mapping: Record<string, string>,
    records: number[],
  ) => Promise<Created>;
  onOpen: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    preview = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(""),
    [delimiter, setDelimiter] = useState(","),
    [csv, setCsv] = useState(""),
    [filename, setFilename] = useState("");
  const [data, setData] = useState<Data | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [selection, setSelection] = useState("");
  const [record, setRecord] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState<Created>([]);
  const template = useMemo(() => mergeTemplateContent(project), [project]),
    keys = useMemo(() => mergeFieldKeys(template), [template]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    return () => {
      active.current = false;
      dialog.current?.close();
    };
  }, []);
  let selected: number[] = [],
    selectionError = "";
  try {
    selected = mergeRecordSelection(selection, data?.rows.length || 0);
  } catch (cause) {
    selectionError = (cause as Error).message;
  }
  const mapped =
    keys.length > 0 &&
    keys.every((key) => data?.headers.includes(mapping[key]));
  const values = useMemo(
    () =>
      Object.fromEntries(
        keys
          .map((key) => [
            key,
            data?.rows[record - 1]?.[data.headers.indexOf(mapping[key])],
          ])
          .filter(([, value]) => value !== undefined),
      ) as Record<string, string>,
    [data, record, mapping, keys],
  );
  useEffect(() => {
    if (!preview.current) return;
    preview.current.replaceChildren();
    try {
      const serializer = DOMSerializer.fromSchema(schema);
      const prepare = (node: DocNode): DocNode => ({
        ...node,
        ...(node.content ? { content: node.content.map(prepare) } : {}),
        ...(["image", "inline_image"].includes(node.type) && node.attrs?.assetId
          ? {
              attrs: {
                ...node.attrs,
                src: `/api/projects/${project.id}/assets/${node.attrs.assetId}`,
              },
            }
          : {}),
      });
      const append = (titleText: string, documentNode: DocNode) => {
        const section = document.createElement("section"),
          title = document.createElement("strong"),
          body = document.createElement("div");
        body.className = "ProseMirror";
        title.textContent = titleText;
        section.append(title);
        const doc = schema.nodeFromJSON(
          prepare(mergePreview(documentNode, values)),
        );
        body.append(serializer.serializeFragment(doc.content));
        section.append(body);
        preview.current!.append(section);
      };
      const running = project.settings.runningMatter;
      for (const [variant, story] of Object.entries(running?.header || {}))
        if (story) append(`Header (${variant})`, story as DocNode);
      for (const chapter of template.book.chapters) {
        append(chapter.title, chapter.document);
        const notes = (node: DocNode) => {
          if (node.type === "document_note")
            append(
              node.attrs?.kind === "endnote" ? "Endnote" : "Footnote",
              node.attrs!.body,
            );
          node.content?.forEach(notes);
        };
        notes(chapter.document);
      }
      for (const [variant, story] of Object.entries(running?.footer || {}))
        if (story) append(`Footer (${variant})`, story as DocNode);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [template, values, schema, project.id, project.settings.runningMatter]);
  const run = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      if (active.current) setError((cause as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const read = async (text: string, separator: string) => {
    const result = await api<Data>("/api/mail-merge/csv", "POST", {
      text,
      delimiter: separator,
    });
    if (!active.current) return;
    setData(result);
    setRecord(1);
    setSelection(
      result.rows.length <= 100 ? `1-${result.rows.length}` : "1-100",
    );
    setMapping(
      Object.fromEntries(
        keys.map((key) => [
          key,
          result.headers.find((header) => header === key) ||
            result.headers.find(
              (header) =>
                header.toLocaleLowerCase() === key.toLocaleLowerCase(),
            ) ||
            "",
        ]),
      ),
    );
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog mail-merge-dialog"
      aria-label="Mail merge"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={(event) => event.preventDefault()} aria-busy={busy}>
        <header>
          <strong>Mail merge</strong>
          <button
            type="button"
            aria-label="Close mail merge"
            disabled={busy}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          {created.length ? (
            <>
              <p role="status">
                Created {created.length} documents. The template and CSV are
                unchanged.
              </p>
              <div className="comments-list">
                {created.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={busy}
                    onClick={() => void run(() => onOpen(item.id))}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="comments-actions">
                <label>
                  Field name
                  <input
                    aria-label="Merge field name"
                    value={name}
                    maxLength={100}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || !name.trim()}
                  onClick={() => {
                    try {
                      onInsert(name.trim());
                    } catch (cause) {
                      setError((cause as Error).message);
                    }
                  }}
                >
                  Insert field
                </button>
              </div>
              <div className="comments-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => file.current?.click()}
                >
                  Choose CSV…
                </button>
                <span>{filename}</span>
                <label>
                  Separator
                  <select
                    aria-label="CSV separator"
                    disabled={busy}
                    value={delimiter}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDelimiter(next);
                      setData(null);
                      if (csv) void run(() => read(csv, next));
                    }}
                  >
                    <option value=",">Comma</option>
                    <option value=";">Semicolon</option>
                    <option value={"\t"}>Tab</option>
                  </select>
                </label>
              </div>
              <input
                ref={file}
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                aria-label="Mail merge CSV"
                hidden
                onChange={(event) => {
                  const source = event.target.files?.[0];
                  event.target.value = "";
                  if (!source) return;
                  setData(null);
                  void run(async () => {
                    if (source.size > 5 * 1024 * 1024)
                      throw new Error("Choose a CSV file no larger than 5 MB.");
                    let text: string;
                    try {
                      text = new TextDecoder("utf-8", { fatal: true }).decode(
                        await source.arrayBuffer(),
                      );
                    } catch {
                      throw new Error(
                        "Save the data as UTF-8 CSV before opening it.",
                      );
                    }
                    setCsv(text);
                    setFilename(source.name);
                    await read(text, delimiter);
                  });
                }}
              />
              {!!keys.length && data && (
                <div className="merge-mapping">
                  {keys.map((key) => (
                    <label key={key}>
                      {key}
                      <select
                        aria-label={`Column for ${key}`}
                        disabled={busy}
                        value={mapping[key] || ""}
                        onChange={(event) =>
                          setMapping({ ...mapping, [key]: event.target.value })
                        }
                      >
                        <option value="">Choose column</option>
                        {data.headers.map((header) => (
                          <option key={header}>{header}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {!keys.length && (
                <p>
                  Insert fields where each record’s values should appear, then
                  choose the CSV containing those values.
                </p>
              )}
              {data && (
                <div className="comments-actions">
                  <label>
                    Records
                    <input
                      aria-label="Merge records"
                      value={selection}
                      disabled={busy}
                      onChange={(event) => setSelection(event.target.value)}
                    />
                  </label>
                  <small>
                    {selected.length} of {data.rows.length} selected
                  </small>
                  <label>
                    Preview record
                    <input
                      type="number"
                      aria-label="Preview record"
                      min={1}
                      max={data.rows.length}
                      value={record}
                      disabled={busy}
                      onChange={(event) =>
                        setRecord(
                          Math.max(
                            1,
                            Math.min(
                              data.rows.length,
                              Number(event.target.value) || 1,
                            ),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              )}
              {selectionError && <p role="alert">{selectionError}</p>}
              <style>{styleSheet(project.styles, "merge-preview")}</style>
              <div
                ref={preview}
                className="merge-preview"
                data-alder-editor="merge-preview"
                aria-label="Merge preview"
                style={{
                  fontFamily: project.settings.fontFamily || "Cambria",
                  fontSize: `${project.settings.fontSize || 12}pt`,
                }}
              />
              <small>
                Creates separate editable documents in Alder. Use Save, Export
                or Print from each document. CSV values remain literal text;
                empty values leave an empty field.
              </small>
            </>
          )}
        </div>
        <footer>
          {error && <span role="alert">{error}</span>}
          <button type="button" disabled={busy} onClick={onClose}>
            {created.length ? "Done" : "Cancel"}
          </button>
          {!created.length && (
            <button
              type="button"
              className="accent"
              disabled={busy || !mapped || !selected.length || !!selectionError}
              onClick={() =>
                void run(async () => {
                  const rows = selected.map((index) =>
                    Object.fromEntries(
                      data!.headers.map((header, i) => [
                        header,
                        data!.rows[index - 1][i],
                      ]),
                    ),
                  );
                  const result = await onCreate(rows, mapping, selected);
                  if (active.current) setCreated(result);
                })
              }
            >
              {busy ? "Working…" : "Create documents"}
            </button>
          )}
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
