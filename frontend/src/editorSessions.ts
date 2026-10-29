import type { EditorState } from "prosemirror-state";
import { history } from "prosemirror-history";

const portablePlugins = [history()];
export const portableEditorState = (state: EditorState) =>
  state.reconfigure({ plugins: portablePlugins });

// Views and their DOM are not retained. Rebind view-specific plugins on restore.
const sessions = new Map<string, EditorState>();
export function rememberEditorSession(identity: string, state: EditorState) {
  sessions.delete(identity);
  sessions.set(identity, portableEditorState(state));
  while (sessions.size > 32) sessions.delete(sessions.keys().next().value!);
}
export function editorSession(identity: string) {
  return sessions.get(identity);
}

const active = new Map<
  string,
  { projectId: string; state: () => EditorState }
>();
export function registerEditorSession(
  projectId: string,
  identity: string,
  state: () => EditorState,
) {
  const entry = { projectId, state };
  active.set(identity, entry);
  return () => {
    if (active.get(identity) === entry) active.delete(identity);
  };
}
export function captureEditorSessions(projectId: string) {
  const result = new Map(
    [...sessions].filter(([id]) => id.startsWith(projectId + ":")),
  );
  for (const [id, entry] of active)
    if (entry.projectId === projectId)
      result.set(id, portableEditorState(entry.state()));
  return result;
}
export function restoreEditorSessions(states: Map<string, EditorState>) {
  for (const [identity, state] of states)
    rememberEditorSession(identity, state);
}
