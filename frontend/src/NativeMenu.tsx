import { useEffect, useRef } from "react";
import type { MenuEntry } from "./MenuItems";
import type { NativeMenuEntry } from "./types";

function describeItems(
  entries: MenuEntry[],
  prefix: string,
): NativeMenuEntry[] {
  return entries.map((item, index) => ({
    id: `${prefix}:${index}`,
    label: item.label.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()),
    checked: item.checked,
    submenu: item.submenu && describeItems(item.submenu, `${prefix}:${index}`),
  }));
}

export default function NativeMenu({
  items,
  onError,
}: {
  items: Record<string, MenuEntry[]>;
  onError: (message: string) => void;
}) {
  const current = useRef(items);
  current.current = items;
  const description = JSON.stringify(
    Object.entries(items).map(([label, entries]) => ({
      label,
      items: describeItems(entries, `native:${label}`),
    })),
  );
  useEffect(() => {
    void window.alder
      ?.setNativeMenu(JSON.parse(description))
      .catch((e) => onError(e.message));
  }, [description, onError]);
  useEffect(() => {
    const off = window.alder?.onCommand((command) => {
      if (!command.startsWith("native:")) return;
      const [, group, ...indices] = command.split(":");
      let entries = current.current[group];
      let item: MenuEntry | undefined;
      for (const index of indices) {
        item = entries?.[Number(index)];
        entries = item?.submenu ?? [];
      }
      item?.action?.();
    });
    return () => {
      off?.();
      void window.alder?.setNativeMenu(null);
    };
  }, []);
  return null;
}
