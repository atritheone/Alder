import { useEffect, useState } from "react";

export function useStructurePreference(scope: "write" | "sandbox") {
  const key = `alder.structure.${scope}`;
  const read = () => {
    const saved =
      localStorage.getItem(key) ?? localStorage.getItem("alder.structure");
    return saved === null ? scope === "write" : saved !== "false";
  };
  const [visible, setVisible] = useState(() => {
    // Preserve the former shared choice when each independent setting is first
    // created. Later changes to either editor affect only its own preference.
    const initial = read();
    localStorage.setItem(key, String(initial));
    return initial;
  });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setVisible(read());
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
