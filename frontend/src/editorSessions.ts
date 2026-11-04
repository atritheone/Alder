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
  { projectId: string; state: () => EditorState; discarded: boolean }
>();
export function registerEditorSession(
  projectId: string,
  identity: string,
  state: () => EditorState,
) {
  const entry = { projectId, state, discarded: false };
  active.set(identity, entry);
  return (save?: EditorState) => {
    if (active.get(identity) !== entry) return;
    active.delete(identity);
    if (save && !entry.discarded) rememberEditorSession(identity, save);
  };
}
/** Closing a document releases cached model/history references. Its mounted
 * view may unmount after React commits the new tab; do not cache it again then. */
export function forgetEditorSessions(projectId: string) {
  for (const identity of sessions.keys())
    if (identity.startsWith(projectId + ":")) sessions.delete(identity);
  for (const entry of active.values())
    if (entry.projectId === projectId) entry.discarded = true;
}
export function captureEditorSessions(projectId: string) {
  const result = new Map(
    [...sessions].filter(([id]) => id.startsWith(projectId + ":")),
  );
  for (const [id, entry] of active)
    if (entry.projectId === projectId && !entry.discarded)
      result.set(id, portableEditorState(entry.state()));
  return result;
}
export function restoreEditorSessions(states: Map<string, EditorState>) {
  for (const [identity, state] of states)
    rememberEditorSession(identity, state);
}
