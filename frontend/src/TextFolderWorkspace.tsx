import { useEffect, useRef, useState } from "react";
import type { Project } from "./types";
import type {
  TextWorkspace,
  WorkspaceScan,
  WorkspacePreview,
  WorkspaceReplacement,
  WorkspaceEdit,
  WorkspaceCommit,
} from "./textWorkspaceTypes";
import { runPatternSearch } from "./runPatternSearch";
import { decodeSearchEscapes } from "./searchEscapes";
import { lineStarts, searchLine } from "./searchLines";
import {
  openDocuments,
  rememberDocumentFile,
  documentFileSource,
} from "./openDocuments";

type Hit = WorkspaceEdit & {
  relative: string;
  digest: string;
  line: number;
  excerpt: string;
};
export default function TextFolderWorkspace({
  onOpen,
  findSource,
}: {
  onOpen: (
    project: Project,
    range?: { start: number; end: number; originalText: string },
  ) => Promise<void>;
  findSource: (source: string) => Project | undefined;
}) {
  const [roots, setRoots] = useState<TextWorkspace[]>([]),
    [selected, setSelected] = useState(""),
    [scan, setScan] = useState<WorkspaceScan | null>(null),
    [include, setInclude] = useState("*.txt"),
    [exclude, setExclude] = useState(".git/**;node_modules/**;.venv/**");
  const [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [mode, setMode] = useState("normal"),
    [caseSensitive, setCaseSensitive] = useState(false),
    [wholeWord, setWholeWord] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]),
    [preview, setPreview] = useState<WorkspacePreview | null>(null),
    [lastCommit, setLastCommit] = useState<WorkspaceCommit | null>(() => {
      try {
        const value = JSON.parse(
          localStorage.getItem("alder.txt.lastFolderReplacement") || "null",
        );
        return typeof value?.token === "string" &&
          /^replace_[a-f0-9-]+$/.test(value.token)
          ? value
          : null;
      } catch {
        return null;
      }
    }),
    [status, setStatus] = useState(""),
    [errors, setErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [committing, setCommitting] = useState(false);
  const abort = useRef<AbortController | null>(null),
    jobRoot = useRef(""),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void window.alder
      ?.textWorkspaces?.()
      .then(setRoots)
      .catch((error) => setStatus((error as Error).message));
    return () => {
      mounted.current = false;
      abort.current?.abort();
      void window.alder?.cancelTextWorkspace?.(jobRoot.current);
    };
  }, []);
  if (!window.alder?.chooseTextWorkspace) return null;
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setErrors([]);
    try {
      await action(controller.signal);
      if (controller.signal.aborted && !committing)
        throw new DOMException("Cancelled", "AbortError");
    } catch (error) {
      if (mounted.current) {
        setStatus(
          controller.signal.aborted
            ? "Cancelled. Completed writes, if any, remain available through the replacement backup."
            : (error as Error).message,
        );
        setPreview(null);
      }
    } finally {
      if (mounted.current && abort.current === controller) setBusy(false);
    }
  };
  const scanFolder = async (id: string, signal: AbortSignal) => {
    jobRoot.current = id;
    const result = await window.alder!.scanTextWorkspace!(id, include, exclude);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    setScan(result);
    setErrors(result.warnings);
    return result;
  };
  const openFile = async (
    relative: string,
    range?: { start: number; end: number; originalText: string },
  ) => {
    const source = await window.alder!.openWorkspaceText!(selected, relative),
      existing = findSource(await documentFileSource(source.path));
    if (existing) {
      await onOpen(existing, range);
      return;
    }
    const name = /\.txt$/i.test(source.name)
      ? source.name
      : source.name + ".txt";
    await openDocuments(
      [new File([new Uint8Array(source.bytes)], name, { type: "text/plain" })],
      async (project) => {
        await window.alder!.bindWorkspaceText!(
          selected,
          relative,
          project.id,
          source.digest,
        );
        await rememberDocumentFile(project.id, source.path);
        await onOpen(project, range);
      },
    );
  };
  const search = () =>
    void run(async (signal) => {
      setHits([]);
      setPreview(null);
      const decodedQuery =
          mode === "extended" ? decodeSearchEscapes(query) : { text: query },
        decodedReplacement =
          mode === "extended"
            ? decodeSearchEscapes(replacement)
            : { text: replacement };
      if (decodedQuery.error || decodedReplacement.error)
        throw new Error(decodedQuery.error || decodedReplacement.error);
      if (!decodedQuery.text) throw new Error("Enter text to find.");
      setStatus("Scanning files…");
      const listing = await scanFolder(selected, signal),
        found: Hit[] = [],
        skipped: string[] = [];
      let bytes = 0;
      for (const [index, file] of listing.files.entries()) {
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        setStatus(
          `Searching ${index + 1} of ${listing.files.length}: ${file.relative}`,
        );
        if (file.size > 8_000_000) {
          skipped.push(
            `${file.relative}: exceeds the eight-megabyte folder limit.`,
          );
          continue;
        }
        bytes += file.size;
        if (bytes > 256_000_000)
          throw new Error(
            "This search reached the 256 MB batch limit. Narrow the folder or file filters.",
          );
        let source;
        try {
          source = await window.alder!.readWorkspaceText!(
            selected,
            file.relative,
          );
        } catch (error) {
          skipped.push(`${file.relative}: ${(error as Error).message}`);
          continue;
        }
        const pattern =
          mode === "regex"
            ? decodedQuery.text
            : decodedQuery.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const result = await runPatternSearch(
          {
            sources: [
              { id: file.relative, title: file.relative, text: source.text },
            ],
            query: pattern,
            replacement:
              mode === "regex"
                ? decodedReplacement.text
                : decodedReplacement.text.replace(/\$/g, () => "$$"),
            options: { caseSensitive, wholeWord },
            maxMatches: 10000,
          },
          signal,
        );
        if (result.error) throw new Error(`${file.relative}: ${result.error}`);
        if (found.length + result.matches.length > 10000)
          throw new Error(
            "The folder search exceeded 10,000 matches. Refine the query before replacing.",
          );
        const starts = lineStarts(source.text);
        for (const match of result.matches) {
          const line = searchLine(source.text, starts, match.start);
          found.push({
            relative: file.relative,
            digest: source.digest,
            start: match.start,
            end: match.end,
            originalText: source.text.slice(match.start, match.end),
            replacement: match.replacement ?? decodedReplacement.text,
            line: line.number,
            excerpt: line.excerpt,
          });
        }
      }
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      setHits(found);
      setErrors([...listing.warnings, ...skipped].slice(0, 100));
      setStatus(
        `${found.length.toLocaleString()} matches in ${new Set(found.map((h) => h.relative)).size} files.${listing.truncated ? " File listing stopped at 10,000 files; narrow the folder." : ""}`,
      );
    });
  const prepare = () =>
    void run(async () => {
      const groups = new Map<string, WorkspaceReplacement>();
      for (const hit of hits) {
        let group = groups.get(hit.relative);
        if (!group) {
          group = { relative: hit.relative, digest: hit.digest, edits: [] };
          groups.set(hit.relative, group);
        }
        group.edits.push({
          start: hit.start,
          end: hit.end,
          originalText: hit.originalText,
          replacement: hit.replacement,
        });
      }
      if (groups.size > 200)
        throw new Error(
          "Refine the search to 200 files or fewer for one replacement batch.",
        );
      setStatus("Preparing replacement preview…");
      const result = await window.alder!.prepareFolderReplacement!(selected, [
        ...groups.values(),
      ]);
      setPreview(result);
      setStatus(
        `Prepared ${result.files.length} files. Review the replacements before writing.`,
      );
    });
  return (
    <details className="txt-folder-workspace">
      <summary>Folder workspace</summary>
      <div className="txt-tools">
        <button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const root = await window.alder!.chooseTextWorkspace!();
              if (!root || signal.aborted) return;
              setRoots((previous) => [
                ...previous.filter((r) => r.id !== root.id),
                root,
              ]);
              setSelected(root.id);
              setHits([]);
              setPreview(null);
              setStatus("Scanning files…");
              const result = await scanFolder(root.id, signal);
              setStatus(
                `${result.files.length} files${result.truncated ? " (listing limited to 10,000)" : ""}.`,
              );
            })
          }
        >
          Choose folder
        </button>
        <select
          aria-label="Text folder workspace"
          value={selected}
          disabled={busy}
          onChange={(e) => {
            setSelected(e.target.value);
            setScan(null);
            setHits([]);
            setPreview(null);
          }}
        >
          <option value="">Select workspace…</option>
          {roots.map((root) => (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          ))}
        </select>
        <label>
          Files
          <input
            aria-label="Workspace file filters"
            value={include}
            disabled={busy}
            onChange={(e) => {
              setInclude(e.target.value);
              setHits([]);
              setPreview(null);
              setScan(null);
            }}
            placeholder="*.txt;*.log"
          />
        </label>
        <label>
          Exclude
          <input
            aria-label="Workspace exclude filters"
            value={exclude}
            disabled={busy}
            onChange={(e) => {
              setExclude(e.target.value);
              setHits([]);
              setPreview(null);
              setScan(null);
            }}
          />
        </label>
        <button
          disabled={!selected || busy}
          onClick={() =>
            void run(async (signal) => {
              const result = await scanFolder(selected, signal);
              setStatus(
                `${result.files.length} files${result.truncated ? " (listing limited)" : ""}.`,
              );
            })
          }
        >
          Refresh files
        </button>
        <button
          disabled={!busy || committing}
          onClick={() => {
            abort.current?.abort();
            void window.alder?.cancelTextWorkspace?.(
              jobRoot.current || selected,
            );
          }}
        >
          Cancel folder work
        </button>
      </div>
      <div className="txt-tools">
        <label>
          Find
          <input
            aria-label="Find in folder"
            value={query}
            maxLength={16384}
            disabled={busy}
            onChange={(e) => {
              setQuery(e.target.value);
              setPreview(null);
              setHits([]);
            }}
          />
        </label>
        <label>
          Replace with
          <input
            aria-label="Folder replacement text"
            value={replacement}
            disabled={busy}
            onChange={(e) => {
              setReplacement(e.target.value);
              setPreview(null);
              setHits([]);
            }}
          />
        </label>
        <select
          aria-label="Folder search mode"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value);
            setHits([]);
            setPreview(null);
          }}
        >
          <option value="normal">Normal</option>
          <option value="extended">Extended characters</option>
          <option value="regex">JavaScript regex</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            disabled={busy}
            onChange={(e) => {
              setCaseSensitive(e.target.checked);
              setHits([]);
              setPreview(null);
            }}
          />
          Match case
        </label>
        <label>
          <input
            type="checkbox"
            checked={wholeWord}
            disabled={busy}
            onChange={(e) => {
              setWholeWord(e.target.checked);
              setHits([]);
              setPreview(null);
            }}
          />
          Whole words
        </label>
        <button disabled={!selected || !query || busy} onClick={search}>
          Find in files
        </button>
        <button disabled={!hits.length || busy} onClick={prepare}>
          Preview folder replacement
        </button>
      </div>
      <p role="status">{status}</p>
      {errors.length > 0 && (
        <details>
          <summary>Skipped files / errors ({errors.length})</summary>
          {errors.map((error, i) => (
            <p key={i}>{error}</p>
          ))}
        </details>
      )}
      {preview && (
        <div className="txt-folder-preview">
          <strong>Replacement preview</strong>
          <ul>
            {preview.files.map((file) => (
              <li key={file.relative}>
                {file.relative}: {file.replacements} replacement(s)
              </li>
            ))}
          </ul>
          {hits.slice(0, 10).map((hit, i) => (
            <p key={i}>
              {hit.relative}:{hit.line}{" "}
              <del>{hit.originalText.slice(0, 120)}</del> →{" "}
              <ins>{hit.replacement.slice(0, 120)}</ins>
            </p>
          ))}
          <p>
            Verified original-file backups are created before any file is
            written. Files changed since this preview are refused.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCommitting(true);
                try {
                  try {
                    localStorage.setItem(
                      "alder.txt.lastFolderReplacement",
                      JSON.stringify({
                        token: preview.token,
                        backup: "Pending replacement batch",
                        status: "partial",
                        written: 0,
                        total: preview.files.length,
                        errors: [],
                      }),
                    );
                  } catch {}
                  const result = await window.alder!.commitFolderReplacement!(
                    preview.token,
                  );
                  try {
                    localStorage.setItem(
                      "alder.txt.lastFolderReplacement",
                      JSON.stringify(result),
                    );
                  } catch {}
                  setLastCommit(result);
                  setPreview(null);
                  setHits([]);
                  setErrors(result.errors);
                  setStatus(
                    `${result.written} of ${result.total} files written. Backups: ${result.backup}`,
                  );
                  window.dispatchEvent(new Event("focus"));
                } finally {
                  setCommitting(false);
                }
              })
            }
          >
            Write verified replacements
          </button>
        </div>
      )}
      {lastCommit && (
        <div>
          <span>Last backup: {lastCommit.backup}</span>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCommitting(true);
                try {
                  const result = await window.alder!.restoreFolderReplacement!(
                    lastCommit.token,
                  );
                  setErrors(result.errors);
                  setStatus(
                    `Restored ${result.restored} files. Newer work is retained. Backups: ${result.backup}`,
                  );
                  window.dispatchEvent(new Event("focus"));
                } finally {
                  setCommitting(false);
                }
              })
            }
          >
            Restore last replacement
          </button>
        </div>
      )}
      {hits.length > 0 && (
        <details open>
          <summary>Search results ({hits.length})</summary>
          <ol className="txt-folder-results">
            {hits.slice(0, 500).map((hit, i) => (
              <li key={i}>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => openFile(hit.relative, hit))
                  }
                >
                  {hit.relative}:{hit.line}: {hit.excerpt.slice(0, 160)}
                </button>
              </li>
            ))}
          </ol>
          {hits.length > 500 && (
            <small>
              Showing the first 500 matches. Refine the search to see a smaller
              set.
            </small>
          )}
        </details>
      )}
      {scan && (
        <details>
          <summary>Files ({scan.files.length})</summary>
          <ul className="txt-folder-results">
            {scan.files.slice(0, 1000).map((file) => (
              <li key={file.relative}>
                <button
                  disabled={busy}
                  onClick={() => void run(async () => openFile(file.relative))}
                >
                  {file.relative}
                </button>
              </li>
            ))}
          </ul>
          {scan.files.length > 1000 && (
            <small>
              Showing the first 1,000 paths. Use file filters to narrow the
              list.
            </small>
          )}
        </details>
      )}
    </details>
  );
}
