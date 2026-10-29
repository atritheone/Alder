type Direction = "undo" | "redo";
type Handler = {
  run: (direction: Direction) => void;
  can: (direction: Direction) => boolean;
  breakBefore: (identity: string) => boolean;
};
const handlers = new Map<string, Handler>();
export function registerProjectHistory(projectId: string, handler: Handler) {
  handlers.set(projectId, handler);
  return () => {
    if (handlers.get(projectId) === handler) handlers.delete(projectId);
  };
}
/** null means a standalone editor with its own ProseMirror history. */
export function projectHistoryCommand(
  projectId: string,
  direction: Direction,
  execute: boolean,
): boolean | null {
  const handler = handlers.get(projectId);
  if (!handler) return null;
  if (!execute) return handler.can(direction);
  if (handler.can(direction)) handler.run(direction);
  return true;
}
export function breakEditorHistory(projectId: string, identity: string) {
  return handlers.get(projectId)?.breakBefore(identity) || false;
}
