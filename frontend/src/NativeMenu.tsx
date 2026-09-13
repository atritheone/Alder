import { useEffect, useRef } from "react";

export default function NativeMenu({
  items,
  onError,
}: {
  items: Record<string, { label: string; action: () => void }[]>;
  onError: (message: string) => void;
}) {
  const current = useRef(items);
  current.current = items;
  const description = JSON.stringify(
    Object.entries(items).map(([label, entries]) => ({
      label,
      items: entries.map((item, index) => ({
        id: `native:${label}:${index}`,
        label: item.label.replace(/\b\p{L}/gu, (letter) =>
          letter.toUpperCase(),
        ),
      })),
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
      const [, group, index] = command.split(":");
      current.current[group]?.[Number(index)]?.action();
    });
    return () => {
      off?.();
      void window.alder?.setNativeMenu(null);
    };
  }, []);
  return null;
}
