import { useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { MenuEntry } from "./MenuItems";

export function searchableCommands(groups: Record<string, MenuEntry[]>) {
  const result: { path: string; item: MenuEntry }[] = [];
  const visit = (items: MenuEntry[], parent: string, disabled = false) => {
    for (const item of items) {
      const path = `${parent} → ${item.label}`;
      if (item.submenu) visit(item.submenu, path, disabled || !!item.disabled);
      else if (item.action && item.label !== "Find command…")
        result.push({
          path,
          item: disabled ? { ...item, disabled: true } : item,
        });
    }
  };
  for (const [group, items] of Object.entries(groups)) visit(items, group);
  return result;
}

export default function CommandSearch({
  menus,
  onClose,
}: {
  menus: Record<string, MenuEntry[]>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const [query, setQuery] = useState("");
  const terms = query.toLocaleLowerCase().trim().split(/\s+/);
  const commands = searchableCommands(menus).filter(({ path, item }) =>
    terms.every((term) =>
      `${path} ${item.keywords?.join(" ") || ""}`
        .toLocaleLowerCase()
        .includes(term),
    ),
  );
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      previous.current?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="txt-command-dialog"
      aria-label="Find command"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <strong>Find command</strong>
        <button onClick={onClose}>Close</button>
      </header>
      <input
        autoFocus
        type="search"
        aria-label="Search commands"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if(event.nativeEvent.isComposing)return;
          if(event.key === "Enter") {
            event.preventDefault();
            dialog.current?.querySelector<HTMLButtonElement>("li button:not(:disabled)")?.click();
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            dialog.current
              ?.querySelector<HTMLButtonElement>("li button:not(:disabled)")
              ?.focus();
          }
        }}
      />
      <ul onKeyDown={event=>{
        if(!["ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
        const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        if(index<0)return;
        event.preventDefault();
        if(event.key==="ArrowUp" && index===0)dialog.current?.querySelector("input")?.focus();
        else buttons[event.key==="Home"?0:event.key==="End"?buttons.length-1:Math.min(buttons.length-1,index+(event.key==="ArrowDown"?1:-1))]?.focus();
      }}>
        {commands.map(({ path, item }) => (
          <li key={path}>
            <button
              disabled={item.disabled}
              onClick={() => {
                flushSync(onClose);
                item.action?.();
              }}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
      {!commands.length && <p role="status">No matching commands</p>}
    </dialog>,
    document.body,
  );
}
