import { useCallback, useSyncExternalStore } from "react";

const eventName = "alder-preference-changed";
function subscribe(notify: () => void) {
  window.addEventListener(eventName, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener("storage", notify);
  };
}

/** One persistent value shared by settings and all mounted toolbar controls. */
export function useStoredPreference(key: string, fallback: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(key) ?? fallback,
  );
  const setValue = useCallback(
    (next: string) => {
      if (localStorage.getItem(key) === next) return;
      localStorage.setItem(key, next);
      window.dispatchEvent(new Event(eventName));
    },
    [key],
  );
  return [value, setValue] as const;
}
