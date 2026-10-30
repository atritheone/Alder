import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Pencil, X, Upload, Download } from "lucide-react";
import { api } from "./api";
import type { NamedStyle } from "./types";
import {
  citationStyles,
  locatorLabels,
  sourceLabel,
  type CitationItem,
  type CitationSource,
  type CitationStyle,
} from "./citationTypes";
type Record = { source: CitationSource; revision: number };
type Props = {
  initial?: CitationItem[];
  style: CitationStyle;
  documentSources: CitationSource[];
  styles: NamedStyle[];
  onClose: () => void;
  onInsert: (items: CitationItem[], style: CitationStyle) => Promise<void>;
  onBibliography: (
    title: string,
    entryStyle: string | null,
    style: CitationStyle,
  ) => Promise<void>;
  onUpdate: (sources: CitationSource[], style: CitationStyle) => Promise<void>;
};
const newSource = (): CitationSource => ({
  id: "source_" + crypto.randomUUID().replaceAll("-", ""),
  type: "book",
  title: "",
});
const sourceAuthors = (source: CitationSource) =>
  (source.author || [])
    .map((person: any) =>
      person.literal
        ? "=" + person.literal
        : [person.family, person.given].filter(Boolean).join(", "),
    )
    .join("\n");
const sourceYear = (source: CitationSource) =>
  String(source.issued?.["date-parts"]?.[0]?.[0] || "");
export default function SourcesDialog(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null),
    active = useRef(true);
  const [records, setRecords] = useState<Record[]>([]),
    [query, setQuery] = useState(""),
    [items, setItems] = useState<CitationItem[]>(props.initial || []),
    [style, setStyle] = useState(props.style),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [editing, setEditing] = useState<Record | null>(null),
    [authors, setAuthors] = useState(""),
    [year, setYear] = useState(""),
    [title, setTitle] = useState("References"),
    [entryStyle, setEntryStyle] = useState(""),
    [showBibliography, setShowBibliography] = useState(false),
    [removed, setRemoved] = useState<Record | null>(null);
  useEffect(() => {
    active.current=true;
    dialog.current?.showModal();
    api<{ sources: Record[] }>("/api/citation-sources")
      .then((value) => {
        if (active.current) setRecords(value.sources);
      })
      .catch((e) => setError(e.message));
    return () => {
      active.current = false;
      dialog.current?.close();
    };
  }, []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const all = new Map(
    props.documentSources.map((source) => [source.id, { source, revision: 0 }]),
  );
  for (const record of records) all.set(record.source.id, record);
  const edit = (record?: Record) => {
    const value = record || { source: newSource(), revision: 0 };
    setEditing(structuredClone(value));
    setAuthors(
      (value.source.author || [])
        .map((person: any) =>
          person.literal
            ? "=" + person.literal
            : [person.family, person.given].filter(Boolean).join(", "),
        )
        .join("\n"),
    );
    setYear(String(value.source.issued?.["date-parts"]?.[0]?.[0] || ""));
  };
  const save = () =>
    run(async () => {
      if (!editing) return;
      const source = { ...editing.source };
      if (!String(source.title || "").trim())
        throw new Error("Give the source a title.");
      if (authors !== sourceAuthors(editing.source))
        source.author = authors
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) =>
            line.startsWith("=")
              ? { literal: line.slice(1).trim() }
              : {
                  family: line.split(",")[0].trim(),
                  given: line.split(",").slice(1).join(",").trim(),
                },
          );
      if (year !== sourceYear(editing.source)) {
        if (year) {
          if (!/^-?\d{1,4}$/.test(year))
            throw new Error("Enter a year of up to four digits.");
          const issued = source.issued || {};
          const dates = issued["date-parts"] || [[]];
          source.issued = {
            ...issued,
            "date-parts": [
              [Number(year), ...dates[0].slice(1)],
              ...dates.slice(1),
            ],
          };
        } else delete source.issued;
      }
      // Sources brought in with the document can be collected without changing
      // their embedded identity until the user explicitly updates the document.
      if (!/^source_[a-f0-9]{32}$/.test(source.id)) source.id = newSource().id;
      const saved = await api<Record>("/api/citation-sources", "POST", {
        source,
        revision: editing.revision,
      });
      setRecords((old) => [
        ...old.filter((record) => record.source.id !== saved.source.id),
        saved,
      ]);
      setEditing(null);
      setMessage("Source saved to the local library.");
    });
  const close = () => props.onClose();
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog sources-dialog"
      aria-label="Sources"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (editing) void save();
        }}
      >
        <header>
          <strong>{editing ? "Source details" : "Sources"}</strong>
          <button
            type="button"
            aria-label="Close sources"
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        {editing ? (
          <div className="word-dialog-fields source-details">
            <label>
              Type
              <select
                aria-label="Source type"
                value={editing.source.type}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    source: { ...editing.source, type: e.target.value },
                  })
                }
              >
                {[
                  ...new Set([
                    "book",
                    "article-journal",
                    "chapter",
                    "webpage",
                    "report",
                    "thesis",
                    editing.source.type,
                  ]),
                ].map((type) => (
                  <option key={type} value={type}>
                    {(
                      {
                        book: "Book",
                        "article-journal": "Journal article",
                        chapter: "Book chapter",
                        webpage: "Web page",
                        report: "Report",
                        thesis: "Thesis",
                      } as any
                    )[type] || type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                autoFocus
                aria-label="Source title"
                value={editing.source.title || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    source: { ...editing.source, title: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Authors
              <textarea
                aria-label="Source authors"
                rows={3}
                placeholder={
                  "Family, Given · one author per line\n=Organisation name"
                }
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
              />
            </label>
            <label>
              Year
              <input
                aria-label="Source year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </label>
            {[
              ["container-title", "Journal or book"],
              ["publisher", "Publisher"],
              ["publisher-place", "Publisher location"],
              ["volume", "Volume"],
              ["issue", "Issue"],
              ["page", "Pages"],
              ["DOI", "DOI"],
              ["URL", "URL"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={"Source " + label}
                  value={String(editing.source[key] || "")}
                  onChange={(e) => {
                    const source = { ...editing.source };
                    if (e.target.value) source[key] = e.target.value;
                    else delete source[key];
                    setEditing({ ...editing, source });
                  }}
                />
              </label>
            ))}
            <p className="source-hint">
              Library edits leave existing citations unchanged. Use Update
              document to copy the latest details into this document.
            </p>
          </div>
        ) : (
          <>
            <div className="sources-tools">
              <input
                aria-label="Find source"
                placeholder="Find source"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                type="button"
                title="New source"
                aria-label="New source"
                disabled={busy}
                onClick={() => edit()}
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                title="Import CSL-JSON"
                aria-label="Import sources"
                disabled={busy}
                onClick={() => file.current?.click()}
              >
                <Upload size={16} />
              </button>
              <button
                type="button"
                title="Export CSL-JSON"
                aria-label="Export sources"
                disabled={busy || !records.length}
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [
                        JSON.stringify(
                          records.map((record) => record.source),
                          null,
                          2,
                        ),
                      ],
                      { type: "application/json" },
                    ),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "Alder sources.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={16} />
              </button>
            </div>
            <input
              ref={file}
              type="file"
              hidden
              accept=".json,application/json"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = "";
                if (selected)
                  void run(async () => {
                    if (selected.size > 10 * 1024 * 1024)
                      throw new Error("Source imports must be at most 10 MB.");
                    const result = await api<{
                      sources: Record[];
                      added: number;
                      duplicates: number;
                    }>("/api/citation-sources/import", "POST", {
                      items: JSON.parse(await selected.text()),
                    });
                    setRecords(result.sources);
                    setMessage(
                      `${result.added} sources imported; ${result.duplicates} duplicates skipped.`,
                    );
                  });
              }}
            />
            <div className="sources-list" aria-label="Local sources">
              {[...all.values()]
                .filter((record) =>
                  JSON.stringify(record.source)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((record) => (
                  <div className="source-row" key={record.source.id}>
                    <button
                      type="button"
                      className="source-name"
                      disabled={busy}
                      title="Add to citation"
                      onClick={() =>
                        setItems((old) =>
                          old.some(
                            (item) => item.source.id === record.source.id,
                          )
                            ? old
                            : [...old, { source: record.source }],
                        )
                      }
                    >
                      {sourceLabel(record.source)}
                      <small>
                        {(record.source.author || [])
                          .map((name: any) => name.family || name.literal)
                          .join(", ")}
                        {record.source.issued?.["date-parts"]?.[0]?.[0]
                          ? " · " + record.source.issued["date-parts"][0][0]
                          : ""}
                      </small>
                    </button>
                    <button
                      type="button"
                      aria-label={"Edit " + sourceLabel(record.source)}
                      disabled={busy}
                      onClick={() => edit(record)}
                    >
                      <Pencil size={14} />
                    </button>
                    {record.revision > 0 && (
                      <button
                        type="button"
                        aria-label={"Remove " + sourceLabel(record.source)}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const result = await api<Record>(
                              `/api/citation-sources/${record.source.id}/remove`,
                              "POST",
                              { revision: record.revision },
                            );
                            setRemoved(result);
                            setRecords((old) =>
                              old.filter(
                                (v) => v.source.id !== record.source.id,
                              ),
                            );
                            setMessage(
                              "Removed from the library. Existing citations are retained.",
                            );
                          })
                        }
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              {!all.size && (
                <p>No sources yet. Add a source or import CSL-JSON.</p>
              )}
            </div>
            <div className="word-dialog-fields">
              <label>
                Citation style
                <select
                  aria-label="Citation style"
                  value={style}
                  disabled={busy}
                  onChange={(e) => setStyle(e.target.value as CitationStyle)}
                >
                  {Object.entries(citationStyles).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="citation-items" aria-label="Citation sources">
                {items.map((item, index) => (
                  <div className="citation-item" key={index}>
                    <div>
                      <strong>{sourceLabel(item.source)}</strong>
                      <button
                        type="button"
                        aria-label={"Remove citation source " + (index + 1)}
                        disabled={busy}
                        onClick={() =>
                          setItems(items.filter((_, i) => i !== index))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <label>
                      Locator
                      <select
                        aria-label={"Locator type " + (index + 1)}
                        value={item.label || "page"}
                        onChange={(e) =>
                          setItems(
                            items.map((v, i) =>
                              i === index ? { ...v, label: e.target.value } : v,
                            ),
                          )
                        }
                      >
                        {locatorLabels.map((label) => (
                          <option key={label}>{label}</option>
                        ))}
                      </select>
                      <input
                        aria-label={"Locator " + (index + 1)}
                        placeholder="e.g. 12–15"
                        value={item.locator || ""}
                        onChange={(e) =>
                          setItems(
                            items.map((v, i) =>
                              i === index
                                ? { ...v, locator: e.target.value }
                                : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <details>
                      <summary>Surrounding text</summary>
                      {(["prefix", "suffix"] as const).map((key) => (
                        <label key={key}>
                          {key === "prefix" ? "Before" : "After"}
                          <input
                            value={item[key] || ""}
                            onChange={(e) =>
                              setItems(
                                items.map((v, i) =>
                                  i === index
                                    ? { ...v, [key]: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                      <label>
                        <input
                          type="checkbox"
                          checked={!!item.suppressAuthor}
                          onChange={(e) =>
                            setItems(
                              items.map((v, i) =>
                                i === index
                                  ? { ...v, suppressAuthor: e.target.checked }
                                  : v,
                              ),
                            )
                          }
                        />
                        Omit author
                      </label>
                    </details>
                  </div>
                ))}
              </div>
              <details
                open={showBibliography}
                onToggle={(e) => setShowBibliography(e.currentTarget.open)}
              >
                <summary>Bibliography</summary>
                <label>
                  Title
                  <input
                    aria-label="Bibliography title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  Entry style
                  <select
                    aria-label="Bibliography entry style"
                    value={entryStyle}
                    onChange={(e) => setEntryStyle(e.target.value)}
                  >
                    <option value="">Citation style defaults</option>
                    {props.styles
                      .filter((s) => s.kind !== "character")
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await props.onBibliography(
                        title,
                        entryStyle || null,
                        style,
                      );
                      props.onClose();
                    })
                  }
                >
                  Insert bibliography
                </button>
              </details>
            </div>
          </>
        )}
        {(error || message) && (
          <p className="sources-message" role={error ? "alert" : "status"}>
            {error || message}
            {removed && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const value = await api<Record>(
                      "/api/citation-sources",
                      "POST",
                      { source: removed.source, revision: removed.revision },
                    );
                    setRecords((old) => [...old, value]);
                    setRemoved(null);
                    setMessage("Source restored.");
                  })
                }
              >
                Undo removal
              </button>
            )}
          </p>
        )}
        <footer>
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button type="submit" disabled={busy}>
                Save source
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await props.onUpdate(
                      records.map((record) => record.source),
                      style,
                    );
                    setMessage("Document citations and bibliography updated.");
                  })
                }
              >
                Update document
              </button>
              <button type="button" onClick={close}>
                Close
              </button>
              <button
                type="button"
                disabled={busy || !items.length}
                onClick={() =>
                  void run(async () => {
                    await props.onInsert(items, style);
                    props.onClose();
                  })
                }
              >
                {busy
                  ? "Formatting…"
                  : props.initial
                    ? "Apply citation"
                    : "Insert citation"}
              </button>
            </>
          )}
        </footer>
        <p className="citation-attribution">
          citeproc-js implements the Citation Style Language · © Frank Bennett
          <br />
          Styles and locales:{" "}
          <a
            href="https://citationstyles.org/"
            target="_blank"
            rel="noreferrer"
          >
            Citation Style Language
          </a>{" "}
          · CC BY-SA 3.0
        </p>
      </form>
    </dialog>,
    document.body,
  );
}
