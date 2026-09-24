import { useStoredPreference } from "./useStoredPreference";

export function useReadReferences() {
  // Preserve an explicitly chosen hyperlink preference when upgrading.
  return useStoredPreference(
    "alder.readReferences",
    localStorage.getItem("alder.readHyperlinks") ?? "false",
  );
}
