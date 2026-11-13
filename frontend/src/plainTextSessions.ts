import { EditorState, StateEffect } from "@codemirror/state";
import { history } from "@codemirror/commands";
import { bookmarkField, markField } from "./plainTextMarks";
import { dirtyLineField } from "./plainTextViews";
import { foldState } from "@codemirror/language";

const sessions = new Map<string, EditorState>();
const active = new Map<
  string,
  { projectId: string; state: () => EditorState; discarded: boolean }
>();
export const portableTextState = (state: EditorState) =>
  state.update({
    effects: StateEffect.reconfigure.of([
      history(),
      bookmarkField,
      markField,
      dirtyLineField,
      foldState,
      EditorState.allowMultipleSelections.of(true),
    ]),
  }).state;
export const textEditorSession = (identity: string) => sessions.get(identity);
export function activeTextReadOnly(projectId: string) {
  return [...active.values()].some(
    (entry) =>
      entry.projectId === projectId &&
      !entry.discarded &&
      entry.state().readOnly,
  );
}
export function rememberTextSession(identity: string, state: EditorState) {
  sessions.delete(identity);
  sessions.set(identity, portableTextState(state));
  while (sessions.size > 32) sessions.delete(sessions.keys().next().value!);
}
export function registerTextSession(
  projectId: string,
  identity: string,
  state: () => EditorState,
) {
  const entry = { projectId, state, discarded: false };
  active.set(identity, entry);
  return (save?: EditorState) => {
    if (active.get(identity) !== entry) return;
    active.delete(identity);
    if (save && !entry.discarded) rememberTextSession(identity, save);
  };
}
export function forgetTextSessions(projectId: string) {
  for (const key of sessions.keys())
    if (key.startsWith(projectId + ":")) sessions.delete(key);
  for (const entry of active.values())
    if (entry.projectId === projectId) entry.discarded = true;
}
export function captureTextSessions(projectId: string) {
  const result = new Map(
    [...sessions].filter(([id]) => id.startsWith(projectId + ":")),
  );
  for (const [id, entry] of active)
    if (entry.projectId === projectId && !entry.discarded)
      result.set(id, portableTextState(entry.state()));
  return result;
}
export function restoreTextSessions(states: Map<string, EditorState>) {
  for (const [id, state] of states) rememberTextSession(id, state);
}
