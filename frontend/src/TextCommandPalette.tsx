import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  readShortcutMap,
  shortcutError,
  type TextCommand,
} from "./textCommands";

export default function TextCommandPalette({
  commands,
  value,
  onChange,
  onClose,
}: {
  commands: TextCommand[];
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [shortcut, setShortcut] = useState(""),
    [error, setError] = useState("");
  const bindings = readShortcutMap(value),
    matches = commands.filter((c) =>
      c.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current!.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="txt-command-dialog"
      aria-label="Text commands and shortcuts"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <strong>Text commands &amp; shortcuts</strong>
        <button onClick={onClose}>Close commands</button>
      </header>
      <input
        autoFocus
        type="search"
        aria-label="Search text commands"
        placeholder="Search commands"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul>
        {matches.map((command) => (
          <li key={command.id}>
            <button
              onClick={() => {
                onClose();
                command.run();
              }}
            >
              {command.label}
              {bindings[command.id] ? ` (${bindings[command.id]})` : ""}
            </button>
            <button
              aria-label={`Set shortcut for ${command.label}`}
              onClick={() => {
                setSelected(command.id);
                setShortcut(bindings[command.id] || "");
                setError("");
              }}
            >
              Shortcut…
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const problem = shortcutError(shortcut, selected, bindings);
            if (problem) {
              setError(problem);
              return;
            }
            const next = { ...bindings };
            if (shortcut) next[selected] = shortcut;
            else delete next[selected];
            onChange(JSON.stringify(next));
            setError("Shortcut saved.");
          }}
        >
          <label>
            Shortcut for {commands.find((c) => c.id === selected)?.label}
            <input
              aria-label="Text command shortcut"
              placeholder="Ctrl-Alt-U"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
            />
          </label>
          <button type="submit">Save shortcut</button>
          <button
            type="button"
            onClick={() => {
              const next = { ...bindings };
              delete next[selected];
              onChange(JSON.stringify(next));
              setShortcut("");
              setError("Custom shortcut removed.");
            }}
          >
            Reset shortcut
          </button>
        </form>
      )}
      {error && <p role="status">{error}</p>}
    </dialog>,
    document.body,
  );
}
