import { describe, it, expect } from "vitest";
import {
  ProjectTimeline,
  shareProject,
  type EditorEdit,
} from "./projectTimeline";
import type { Project } from "./types";

const fixture = () =>
  ({
    id: "project",
    revision: 1,
    name: "Manuscript",
    book: {
      chapters: [
        {
          id: "chapter-a",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { blockId: "p1" },
                content: [{ type: "text", text: "One" }],
              },
            ],
          },
          text: "One",
        },
        {
          id: "chapter-b",
          document: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                attrs: { blockId: "p2" },
                content: [{ type: "text", text: "Two" }],
              },
            ],
          },
          text: "Two",
        },
      ],
    },
    settings: { fontSize: 12 },
    clips: [],
  }) as unknown as Project;
const editor = (identity: string, joined = false) =>
  ({
    projectId: "project",
    identity,
    before: {},
    after: {},
    joined,
  }) as EditorEdit;
function edit(project: Project, fn: (p: any) => void) {
  const next = structuredClone(project);
  fn(next);
  return shareProject(project, next);
}
describe("chronological project history", () => {
  it("interleaves typing, structural edits and another editor without losing later data", () => {
    const h = new ProjectTimeline();
    const initial = fixture();
    let p = initial;
    const changes: [(p: any) => void, EditorEdit | undefined][] = [
      [
        (p) => {
          p.book.chapters[0].document.content[0].content[0].text = "One typed";
          p.book.chapters[0].text = "One typed";
        },
        editor("a"),
      ],
      [(p) => p.book.chapters.reverse(), undefined],
      [
        (p) => {
          p.book.chapters[0].document.content[0].content[0].text = "Two edited";
          p.book.chapters[0].text = "Two edited";
        },
        editor("b"),
      ],
      [(p) => (p.settings.fontSize = 16), undefined],
    ];
    const snapshots = [p];
    for (const [fn, source] of changes) {
      const next = edit(p, fn);
      h.record(p, next, source);
      p = next;
      snapshots.push(p);
    }
    p = { ...p, revision: 20 };
    for (let i = 3; i >= 0; i--) {
      p = h.step(p, "undo")!.project;
      expect({ ...p, revision: 1 }).toEqual(snapshots[i]);
      expect(p.revision).toBe(20);
    }
    for (let i = 1; i <= 4; i++) {
      p = h.step(p, "redo")!.project;
      expect({ ...p, revision: 1 }).toEqual(snapshots[i]);
    }
    expect(initial.book!.chapters[0].text).toBe("One");
  });
  it("groups adjacent editor changes and creates a new branch after undo", () => {
    const h = new ProjectTimeline();
    let p = fixture();
    const first = p;
    for (const text of ["A", "AB", "ABC"]) {
      const next = edit(p, (p) => (p.name = text));
      h.record(p, next, editor("a", text !== "A"));
      p = next;
    }
    expect(h.past).toHaveLength(1);
    expect(h.past[0].patches).toHaveLength(1);
    p = h.step(p, "undo")!.project;
    expect(p).toEqual(first);
    expect(h.breakBefore("a")).toBe(true);
    const next = edit(p, (p) => (p.name = "New"));
    h.record(p, next, editor("a", true));
    expect(h.future).toHaveLength(0);
    expect(h.past).toHaveLength(1);
  });
  it("shares unchanged documents and bounds retained groups", () => {
    const h = new ProjectTimeline(100000, 3);
    let p = fixture();
    for (let i = 0; i < 8; i++) {
      const next = edit(p, (p) => (p.name = "Name " + i));
      expect(next.book).toBe(p.book);
      h.record(p, next);
      p = next;
    }
    expect(h.past).toHaveLength(3);
  });
  it("refuses to apply history over an unrelated external edit atomically", () => {
    const h = new ProjectTimeline();
    const p = fixture(),
      next = edit(p, (p) => (p.name = "Edited"));
    h.record(p, next);
    expect(() => h.step({ ...next, name: "External" }, "undo")).toThrow(
      "outside this editing history",
    );
    expect(h.past).toHaveLength(1);
    expect(h.future).toHaveLength(0);
  });
  it("retains delete/add and structural array ordering through grouped changes", () => {
    const h = new ProjectTimeline();
    const first = fixture();
    let p = first;
    for (const fn of [
      (x: any) => x.book.chapters.push({ id: "chapter-c", text: "Three" }),
      (x: any) => delete x.settings.fontSize,
      (x: any) => (x.settings.newOption = true),
    ]) {
      const next = edit(p, fn);
      h.record(p, next, editor("a", p !== first));
      p = next;
    }
    const final = p;
    p = h.step(p, "undo")!.project;
    expect(p).toEqual(first);
    expect(h.step(p, "redo")!.project).toEqual(final);
  });
});

it("coalesces interleaved text and document fields without retaining every keystroke", () => {
  const h = new ProjectTimeline();
  let p = fixture();
  const first = p;
  for (let i = 0; i < 100; i++) {
    const next = edit(p, (p) => {
      p.book.chapters[0].text += "x";
      p.book.chapters[0].document.content[0].content[0].text += "x";
    });
    h.record(p, next, editor("a", i > 0));
    p = next;
  }
  expect(h.past).toHaveLength(1);
  expect(h.past[0].patches).toHaveLength(2);
  expect(h.step(p, "undo")!.project).toEqual(first);
});
