import type { EditorState } from "prosemirror-state";
import type { Project } from "./types";

type Path = (string | number)[];
type Patch = {
  path: Path;
  before: unknown;
  after: unknown;
  hadBefore: boolean;
  hadAfter: boolean;
};
export type EditorEdit = {
  projectId: string;
  identity: string;
  before: EditorState;
  after: EditorState;
  joined: boolean;
};
export type HistoryEntry = {
  patches: Patch[];
  editor?: EditorEdit;
  bytes: number;
  beforeSessions?: Map<string, EditorState>;
  afterSessions?: Map<string, EditorState>;
};
const same = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every((k) => Object.hasOwn(b, k) && same((a as any)[k], (b as any)[k]))
  );
};

/** Reuse unchanged subtrees from the previous immutable project. The existing
 * mutation API still receives a private clone, never an object retained here. */
export function shareProject<T>(before: T, after: T): T {
  if (
    Object.is(before, after) ||
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) !== Array.isArray(after)
  )
    return after;
  const left = before as any,
    right = after as any;
  const keyed = Array.isArray(left)
    ? new Map(
        left
          .filter(
            (x) => x && typeof x === "object" && (x.id || x.attrs?.blockId),
          )
          .map((x) => [x.id || x.attrs.blockId, x]),
      )
    : null;
  let output = right;
  for (const key of Object.keys(right)) {
    const value = right[key],
      id = value?.id || value?.attrs?.blockId;
    const shared = shareProject(keyed && id ? keyed.get(id) : left[key], value);
    if (shared !== value) {
      if (output === right)
        output = Array.isArray(right) ? [...right] : { ...right };
      output[key] = shared;
    }
  }
  return Object.keys(left).length === Object.keys(output).length &&
    Object.keys(output).every(
      (k) => Object.hasOwn(left, k) && Object.is(left[k], output[k]),
    )
    ? before
    : output;
}

function changes(
  before: any,
  after: any,
  path: Path = [],
  output: Patch[] = [],
): Patch[] {
  if (Object.is(before, after)) return output;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const structural =
      Array.isArray(before) &&
      (before.length !== after.length ||
        before.some(
          (v: any, i: number) =>
            (v?.id || v?.attrs?.blockId) !==
            (after[i]?.id || after[i]?.attrs?.blockId),
        ));
    if (!structural) {
      for (const key of new Set([
        ...Object.keys(before),
        ...Object.keys(after),
      ])) {
        if (!path.length && key === "revision") continue;
        const p = [...path, Array.isArray(before) ? Number(key) : key];
        if (!Object.hasOwn(before, key) || !Object.hasOwn(after, key))
          output.push({
            path: p,
            before: before[key],
            after: after[key],
            hadBefore: Object.hasOwn(before, key),
            hadAfter: Object.hasOwn(after, key),
          });
        else changes(before[key], after[key], p, output);
      }
      return output;
    }
  }
  output.push({ path, before, after, hadBefore: true, hadAfter: true });
  return output;
}

function bytes(value: unknown, seen = new Set<unknown>()): number {
  if (typeof value === "string") return value.length * 2;
  if (!value || typeof value !== "object") return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  return Object.entries(value).reduce(
    (n, [k, v]) => n + k.length * 2 + bytes(v, seen),
    32,
  );
}

function applyPatch(project: Project, patch: Patch, reverse: boolean): Project {
  const { path } = patch;
  let source: any = project;
  for (const part of path.slice(0, -1)) source = source?.[part];
  const key = path.at(-1)!;
  const expected = reverse ? patch.after : patch.before,
    present = reverse ? patch.hadAfter : patch.hadBefore;
  if (
    !source ||
    Object.hasOwn(source, key) !== present ||
    !same(source[key], expected)
  )
    throw new Error(
      "The document changed outside this editing history. Reopen it before undoing further changes.",
    );
  const result = { ...project };
  let target: any = result;
  source = project;
  for (const part of path.slice(0, -1)) {
    source = source[part];
    target[part] = Array.isArray(source) ? [...source] : { ...source };
    target = target[part];
  }
  if (reverse ? patch.hadBefore : patch.hadAfter)
    target[key] = reverse ? patch.before : patch.after;
  else delete target[key];
  return result;
}

export class ProjectTimeline {
  readonly past: HistoryEntry[] = [];
  readonly future: HistoryEntry[] = [];
  private boundary = true;
  constructor(
    private maxBytes = 32 * 1024 * 1024,
    private maxEntries = 200,
  ) {}
  get retainedBytes() {
    return [...this.past, ...this.future].reduce((n, e) => n + e.bytes, 0);
  }
  trimTo(limit: number) {
    while (this.retainedBytes > limit && this.past.length) this.past.shift();
    while (this.retainedBytes > limit && this.future.length)
      this.future.shift();
  }
  breakBefore(identity: string) {
    return this.boundary || this.past.at(-1)?.editor?.identity !== identity;
  }
  record(
    before: Project,
    after: Project,
    editor?: EditorEdit,
    sessions?: Map<string, EditorState>,
  ) {
    const patches = changes(before, after);
    if (!patches.length) return;
    const last = this.past.at(-1);
    if (
      editor?.joined &&
      !this.boundary &&
      last?.editor?.identity === editor.identity
    ) {
      for (const patch of patches) {
        // Other fields (plain text, timestamps) can change between edits to
        // this path. Coalesce only across disjoint paths; an intervening
        // ancestor/descendant replacement is an ordering boundary.
        let merged = false;
        for (let i = last.patches.length - 1; i >= 0; i--) {
          const prior = last.patches[i];
          const overlaps = prior.path
            .slice(0, Math.min(prior.path.length, patch.path.length))
            .every((part, index) => part === patch.path[index]);
          if (!overlaps) continue;
          if (prior.path.length === patch.path.length) {
            prior.after = patch.after;
            prior.hadAfter = patch.hadAfter;
            merged = true;
          }
          break;
        }
        if (!merged) last.patches.push(patch);
      }
      last.editor = { ...editor, before: last.editor.before };
      last.bytes = bytes(last.patches);
    } else
      this.past.push({
        patches,
        editor,
        beforeSessions: editor ? undefined : sessions,
        bytes: bytes(patches),
      });
    this.future.length = 0;
    this.boundary = false;
    let total = this.past.reduce((n, e) => n + e.bytes, 0);
    while (
      this.past.length > 1 &&
      (total > this.maxBytes || this.past.length > this.maxEntries)
    )
      total -= this.past.shift()!.bytes;
  }
  step(
    project: Project,
    direction: "undo" | "redo",
    sessions?: Map<string, EditorState>,
  ) {
    const from = direction === "undo" ? this.past : this.future,
      to = direction === "undo" ? this.future : this.past;
    const entry = from.at(-1);
    if (!entry) return null;
    if (direction === "undo" && !entry.editor) entry.afterSessions = sessions;
    let next = project;
    for (const patch of direction === "undo"
      ? [...entry.patches].reverse()
      : entry.patches)
      next = applyPatch(next, patch, direction === "undo");
    from.pop();
    to.push(entry);
    this.boundary = true;
    return {
      project: next,
      editor: entry.editor,
      sessions:
        direction === "undo" ? entry.beforeSessions : entry.afterSessions,
      direction,
    };
  }
  clear() {
    this.past.length = 0;
    this.future.length = 0;
    this.boundary = true;
  }
}

let editorEdit: EditorEdit | undefined;
export function withinEditorEdit<T>(edit: EditorEdit, fn: () => T): T {
  const previous = editorEdit;
  editorEdit = edit;
  try {
    return fn();
  } finally {
    editorEdit = previous;
  }
}
export function currentEditorEdit(projectId?: string) {
  return projectId == null || editorEdit?.projectId === projectId
    ? editorEdit
    : undefined;
}
