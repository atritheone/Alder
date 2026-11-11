import { useEffect, useState } from "react";

export function useStructurePreference(scope: "write" | "sandbox") {
  const key = `alder.structure.${scope}`;
  const [visible, setVisible] = useState(() => {
    // Preserve the former shared choice when each independent setting is first
    // created. Later changes to either editor affect only its own preference.
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved !== "false";
    const initial = localStorage.getItem("alder.structure") !== "false";
    localStorage.setItem(key, String(initial));
    return initial;
  });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setVisible(localStorage.getItem(key) !== "false");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);
  return [
    visible,
    () =>
      setVisible((current) => {
        localStorage.setItem(key, String(!current));
        return !current;
      }),
  ] as const;
}
