import { api } from "./api";

// Readers share the same backend runtime. Keep successful demand warm for less
// than its idle lease; never retain a failed preparation or authored content.
const preparations = new Map<string, { at: number; work: Promise<void> }>();
export function prepareVoiceOnDemand(id: string): Promise<void> {
  const existing = preparations.get(id);
  if (existing && Date.now() - existing.at < 90_000) return existing.work;
  const entry = { at: Date.now(), work: Promise.resolve() };
  entry.work = api("/api/speech/prepare", "POST", { voiceId: id }).then(
    () => {},
    (error) => {
      if (preparations.get(id) === entry) preparations.delete(id);
      throw error;
    },
  );
  preparations.set(id, entry);
  while (preparations.size > 32)
    preparations.delete(preparations.keys().next().value!);
  return entry.work;
}
