import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { findText, type TextMatch } from "./findText";
import type { BookSearchGroup } from "./bookFind";
import type { PatternMatch, PatternResult } from "./patternSearch";
import "./word-processing.css";

export default function FindPanel({
  text,
  initial,
  selection,
  onSelect,
  onReplace,
  onClose,
  onError,
  sourceId,
  sources,
  onReplaceBook,
}: {
  text: string;
  initial: string;
  selection: TextMatch;
  sourceId: string;
  sources?: { id: string; title: string; text: string }[];
  onSelect: (match: TextMatch, sourceId: string) => void;
  onReplace: (
    matches: TextMatch[],
    replacement: string,
    expectedText: string,
    sourceId: string,
  ) => void;
  onReplaceBook?: (
    groups: BookSearchGroup[],
    replacement: string,
  ) => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState(initial),
    [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false),
    [wholeWord, setWholeWord] = useState(false),
    [selectionOnly, setSelectionOnly] = useState(false);
  const [index, setIndex] = useState(-1);
  const [wholeBook, setWholeBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState(false);
  const [patternState, setPatternState] = useState<{
    key: string;
    matches: PatternMatch[];
    error?: string;
  }>({ key: "", matches: [] });
  // Parent renders (including narration) must not repeatedly cancel unchanged searches.
  const stableSources = useRef(sources);
  if (
    stableSources.current?.length !== sources?.length ||
    sources?.some((source, i) => {
      const old = stableSources.current?.[i];
      return (
        !old ||
        source.id !== old.id ||
        source.text !== old.text ||
        source.title !== old.title
      );
    })
  )
    stableSources.current = sources;
  const searchSources = stableSources.current;
  const [scope, setScope] = useState(selection);
  const [scopeSource] = useState(sourceId);
  const previousText = useRef(text);
  const previousSource = useRef(sourceId);
  useEffect(() => {
    if (previousSource.current !== sourceId) {
      previousSource.current = sourceId;
      previousText.current = text;
      setSelectionOnly(false);
      if (!wholeBook) setIndex(-1);
      return;
    }
    if (text === previousText.current) return;
    // Retain the original range through edits instead of searching different text
    // at its old offsets after an insertion or replacement.
    const old = previousText.current;
    let start = 0,
      suffix = 0;
    while (
      start < old.length &&
      start < text.length &&
      old[start] === text[start]
    )
      start++;
    while (
      suffix < old.length - start &&
      suffix < text.length - start &&
      old[old.length - suffix - 1] === text[text.length - suffix - 1]
    )
      suffix++;
    const end = old.length - suffix,
      delta = text.length - old.length;
    if (sourceId === scopeSource)
      setScope((range) => ({
        start:
          range.start <= start
            ? range.start
            : range.start >= end
              ? range.start + delta
              : start,
        end:
          range.end < start
            ? range.end
            : range.end >= end
              ? range.end + delta
              : text.length - suffix,
      }));
    previousText.current = text;
    if (!wholeBook) setIndex(-1);
  }, [text, wholeBook, sourceId, scopeSource]);
  const literalMatches = useMemo(
    () =>
      (pattern
        ? []
        : wholeBook && searchSources
          ? searchSources
          : [{ id: sourceId, title: "", text }]
      ).flatMap((source) =>
        findText(source.text, query, {
          caseSensitive,
          wholeWord,
          ...(!wholeBook && selectionOnly ? scope : {}),
        }).map((match) => ({
          ...match,
          sourceId: source.id,
          title: source.title,
          sourceText: source.text,
        })),
      ),
    [
      text,
      query,
      caseSensitive,
      wholeWord,
      selectionOnly,
      scope,
      wholeBook,
      searchSources,
      sourceId,
      pattern,
    ],
  );
  const patternRequest = useMemo(
    () => ({
      sources:
        wholeBook && searchSources
          ? searchSources
          : [{ id: sourceId, title: "", text }],
      query,
      replacement,
      options: {
        caseSensitive,
        wholeWord,
        ...(!wholeBook && selectionOnly ? scope : {}),
      },
    }),
    [
      wholeBook,
      searchSources,
      sourceId,
      text,
      query,
      replacement,
      caseSensitive,
      wholeWord,
      selectionOnly,
      scope,
    ],
  );
  const patternKey = useMemo(
    () => (pattern ? JSON.stringify(patternRequest) : ""),
    [pattern, patternRequest],
  );
  useEffect(() => {
    if (!pattern || !query) return;
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: PatternResult) => {
      clearTimeout(timeout);
      worker?.terminate();
      const byId = new Map(
        patternRequest.sources.map((source) => [source.id, source]),
      );
      setPatternState({
        key: patternKey,
        error: result.error,
        matches: result.matches.flatMap((match) => {
          const source = byId.get(match.sourceId);
          return source
            ? [{ ...match, sourceText: source.text, title: source.title }]
            : [];
        }),
      });
    };
    const debounce = setTimeout(() => {
      try {
        worker = new Worker(
          new URL("./patternSearch.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = (event) => finish(event.data);
        worker.onerror = () =>
          finish({
            matches: [],
            error: "Pattern search could not run. Try another pattern.",
          });
        timeout = setTimeout(
          () =>
            finish({
              matches: [],
              error: "This pattern took too long. Simplify it and try again.",
            }),
          1500,
        );
        worker.postMessage(patternRequest);
      } catch {
        finish({ matches: [], error: "Pattern search could not start." });
      }
    }, 120);
    return () => {
      clearTimeout(debounce);
      clearTimeout(timeout);
      worker?.terminate();
    };
  }, [pattern, patternKey, patternRequest, query]);
  const searching = pattern && !!query && patternState.key !== patternKey;
  const matches: PatternMatch[] = pattern
    ? patternState.key === patternKey
      ? patternState.matches
      : []
    : literalMatches;
  const patternError =
    pattern && patternState.key === patternKey ? patternState.error : "";
  const navigate = (direction: number) => {
    if (!matches.length || busy) return;
    const next =
      index < 0
        ? direction < 0
          ? matches.length - 1
          : 0
        : (index + direction + matches.length) % matches.length;
    setIndex(next);
    onSelect(matches[next], matches[next].sourceId);
  };
  const replace = async (all: boolean) => {
    try {
      const selected = matches[index];
      if (!all && !selected) {
        navigate(1);
        return;
      }
      if (all && wholeBook && onReplaceBook) {
        setBusy(true);
        const groups = (sources || [])
          .map((source) => ({
            id: source.id,
            text: source.text,
            matches: matches
              .filter((match) => match.sourceId === source.id)
              .map(({ start, end, replacement }) => ({
                start,
                end,
                ...(replacement === undefined ? {} : { replacement }),
              })),
          }))
          .filter((group) => group.matches.length);
        await onReplaceBook(groups, replacement);
      } else
        onReplace(
          all ? matches : [selected],
          replacement,
          selected?.sourceText ?? text,
          selected?.sourceId ?? sourceId,
        );
      setIndex(-1);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="word-find-panel" aria-label="Find and replace">
      <header>
        <strong>Find and replace</strong>
        <button aria-label="Close find and replace" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <label>
        Find
        <input
          autoFocus
          aria-label="Find text"
          type="search"
          disabled={busy}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              navigate(e.shiftKey ? -1 : 1);
            }
            if (e.key === "Escape") onClose();
          }}
        />
      </label>
      {sources && sources.length > 1 && (
        <label>
          Search in
          <select
            aria-label="Search scope"
            value={wholeBook ? "book" : "chapter"}
            disabled={busy}
            onChange={(event) => {
              setWholeBook(event.target.value === "book");
              setSelectionOnly(false);
              setIndex(-1);
            }}
          >
            <option value="chapter">This chapter</option>
            <option value="book">Whole book</option>
          </select>
        </label>
      )}
      <div className="find-navigation">
        <span role="status">
          {searching
            ? "Searching…"
            : matches.length
              ? `${index >= 0 && index < matches.length ? `${index + 1} of ` : ""}${matches.length} matches`
              : "No matches"}
        </span>
        <button
          aria-label="Previous match"
          disabled={!matches.length || busy}
          onClick={() => navigate(-1)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          aria-label="Next match"
          disabled={!matches.length || busy}
          onClick={() => navigate(1)}
        >
          <ArrowDown size={15} />
        </button>
      </div>
      <label className="find-option">
        <input
          type="checkbox"
          disabled={busy}
          checked={caseSensitive}
          onChange={(e) => {
            setCaseSensitive(e.target.checked);
            setIndex(-1);
          }}
        />
        Match case
      </label>
      <label className="find-option">
        <input
          type="checkbox"
          disabled={busy}
          checked={wholeWord}
          onChange={(e) => {
            setWholeWord(e.target.checked);
            setIndex(-1);
          }}
        />
        Whole words
      </label>
      {!wholeBook &&
        sourceId === scopeSource &&
        selection.end > selection.start && (
          <label className="find-option">
            <input
              type="checkbox"
              disabled={busy}
              checked={selectionOnly}
              onChange={(e) => {
                setSelectionOnly(e.target.checked);
                setIndex(-1);
              }}
            />
            Original selection only
          </label>
        )}
      <label>
        Replace with
        <input
          aria-label="Replacement text"
          disabled={busy}
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
      </label>
      <details className="find-advanced">
        <summary>Advanced</summary>
        <label className="find-option">
          <input
            type="checkbox"
            checked={pattern}
            disabled={busy}
            onChange={(event) => {
              setPattern(event.target.checked);
              setIndex(-1);
            }}
          />
          Regular expression
        </label>
        {pattern && (
          <small>
            Use $1 or $&lt;name&gt; for captured text, $&amp; for the match and
            $$ for a dollar sign. Patterns must match non-empty text.
          </small>
        )}
        {patternError && <p role="alert">{patternError}</p>}
        {!!matches.length && (
          <div
            className="find-replacement-preview"
            aria-label="Replacement preview"
          >
            <strong>Replacement preview</strong>
            {matches.slice(0, 5).map((match, i) => (
              <p key={i}>
                <del>
                  {match.sourceText.slice(
                    match.start,
                    Math.min(match.end, match.start + 100),
                  )}
                </del>
                <span aria-label="becomes"> → </span>
                <ins>
                  {(match.replacement ?? replacement).slice(0, 100) ||
                    "(delete)"}
                </ins>
              </p>
            ))}
          </div>
        )}
      </details>
      <div className="find-navigation">
        <button
          disabled={!matches.length || busy}
          onClick={() => void replace(false)}
        >
          Replace
        </button>
        <button
          disabled={!matches.length || busy}
          onClick={() => void replace(true)}
        >
          Replace all
        </button>
      </div>
      <small>
        {busy
          ? "Replacing…"
          : wholeBook
            ? matches[index]?.title ||
              "All chapters, including excluded chapters"
            : sources
              ? "Current chapter"
              : "Sandbox draft"}
      </small>
    </aside>
  );
}
