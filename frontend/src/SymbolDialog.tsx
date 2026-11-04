import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  findSymbols,
  symbolCatalogue,
  symbolCode,
  symbolFromCode,
} from "./documentSymbols";

const visibleSymbol = (value: string) =>
  ({ "\u00a0": "NBSP", "\u202f": "NNBSP", "\u2009": "THIN", "\u00ad": "SHY" })[
    value
  ] || value;
export default function SymbolDialog({
  onInsert,
  onClose,
}: {
  onInsert: (value: string) => boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState("");
  const [code, setCode] = useState("U+2014"),
    [error, setError] = useState("");
  const items = findSymbols(query, group),
    value = symbolFromCode(code);
  const selected = symbolCatalogue.find((item) => item.value === value);
  const current = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  const filter = (text: string, category: string) => {
    setQuery(text);
    setGroup(category);
    setError("");
    const first = findSymbols(text, category)[0];
    setCode(first ? symbolCode(first.value) : "");
  };
  const insert = (symbol = value) => {
    if (!symbol) return;
    try {
      if (onInsert(symbol)) onClose();
      else
        setError(
          "The document changed. Close this window and choose the symbol again.",
        );
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="word-dialog symbol-dialog"
      aria-label="Insert symbol"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          insert();
        }}
      >
        <header>
          <strong>Symbol</strong>
          <button
            type="button"
            aria-label="Close symbol picker"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="word-dialog-fields">
          <label>
            Search
            <input
              aria-label="Search symbols"
              value={query}
              onChange={(e) => filter(e.target.value, group)}
              placeholder="Name, character or code"
              autoFocus
            />
          </label>
          <label>
            Group
            <select
              aria-label="Symbol group"
              value={group}
              onChange={(e) => filter(query, e.target.value)}
            >
              <option value="">All</option>
              {[...new Set(symbolCatalogue.map((item) => item.group))].map(
                (name) => (
                  <option key={name}>{name}</option>
                ),
              )}
            </select>
          </label>
          <div className="symbol-grid" role="group" aria-label="Symbols">
            {items.map((item, index) => (
              <button
                type="button"
                key={item.value}
                aria-label={`${item.name}, ${symbolCode(item.value)}`}
                aria-pressed={value === item.value}
                tabIndex={index === current ? 0 : -1}
                title={`${item.name} (${symbolCode(item.value)})`}
                onClick={() => {
                  setCode(symbolCode(item.value));
                  setError("");
                }}
                onDoubleClick={() => insert(item.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    insert(item.value);
                    return;
                  }
                  const next =
                    e.key === "ArrowRight"
                      ? index + 1
                      : e.key === "ArrowLeft"
                        ? index - 1
                        : e.key === "ArrowDown"
                          ? index + 8
                          : e.key === "ArrowUp"
                            ? index - 8
                            : e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? items.length - 1
                                : null;
                  if (next == null) return;
                  e.preventDefault();
                  const target = Math.max(0, Math.min(items.length - 1, next));
                  setCode(symbolCode(items[target].value));
                  e.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>("button")
                    [target]?.focus();
                }}
              >
                <span
                  className={
                    visibleSymbol(item.value).length > 2
                      ? "symbol-space"
                      : undefined
                  }
                >
                  {visibleSymbol(item.value)}
                </span>
              </button>
            ))}
            {!items.length && <p>No matching symbols.</p>}
          </div>
          <label>
            Unicode
            <input
              aria-label="Unicode character code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
              placeholder="U+2014"
              spellCheck={false}
              maxLength={8}
            />
          </label>
          <div className="symbol-detail" aria-live="polite">
            <span className="symbol-preview" aria-hidden="true">
              {value ? visibleSymbol(value) : ""}
            </span>
            <span>
              {value
                ? selected?.name || symbolCode(value)
                : "Enter a Unicode character code."}
            </span>
          </div>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="accent" disabled={!value}>
            Insert
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}
