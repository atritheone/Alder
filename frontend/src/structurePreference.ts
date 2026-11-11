import { useEffect, useState } from "react";

const key = "alder.structure";
export function useStructurePreference() {
  const [visible, setVisible] = useState(
    () => localStorage.getItem(key) !== "false",
  );
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setVisible(localStorage.getItem(key) !== "false");
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return [
    visible,
    () =>
      setVisible((current) => {
        localStorage.setItem(key, String(!current));
        return !current;
      }),
  ] as const;
}
