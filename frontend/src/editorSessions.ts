import type { EditorState } from "prosemirror-state";

// Views and their DOM are not retained. Rebind view-specific plugins on restore.
const sessions = new Map<string, EditorState>();
export function rememberEditorSession(identity: string, state: EditorState) {
  sessions.delete(identity);
  sessions.set(identity, state);
  while (sessions.size > 32) sessions.delete(sessions.keys().next().value!);
}
export function editorSession(identity: string) {
  return sessions.get(identity);
}
