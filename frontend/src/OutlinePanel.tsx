import { useDeferredValue, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, X } from "lucide-react";
import { schema } from "./Editor";
import { documentOutline, type OutlineHeading } from "./documentOutline";
import { documentBookmarks } from "./documentBookmarks";
import { documentComments } from "./documentComments";
import type { Chapter, DocNode } from "./types";
import "./word-processing.css";

type Selected = { chapter: string; heading: string };
const navigationCache = new WeakMap<
  DocNode,
  {
    headings: OutlineHeading[];
    bookmarks: ReturnType<typeof documentBookmarks>;
    comments: ReturnType<typeof documentComments>;
  }
>();
function navigation(document: DocNode) {
  let cached = navigationCache.get(document);
  if (!cached) {
    const doc = schema.nodeFromJSON(document);
    cached = {
      headings: documentOutline(doc),
      bookmarks: documentBookmarks(doc),
      comments: documentComments(doc),
    };
    navigationCache.set(document, cached);
  }
  return cached;
}
export default function DocumentOutline({
  chapters,
  onSelect,
  onBookmark,
  onComment,
  onMove,
  onClose,
}: {
  chapters: Chapter[];
  onSelect: (chapter: string, heading: string) => void;
  onBookmark: (chapter: string, bookmark: string) => void;
  onComment: (chapter: string, comment: string) => void;
  onMove: (
    chapter: string,
    source: string,
    target: string,
    after: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("headings");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [dragging, setDragging] = useState<Selected | null>(null);
  const [drop, setDrop] = useState<(Selected & { after: boolean }) | null>(
    null,
  );
  const deferredChapters = useDeferredValue(chapters);
  const groups = useMemo(
    () =>
      deferredChapters.map((chapter) => ({
        chapter,
        ...navigation(chapter.document),
      })),
    [deferredChapters],
  );
  const selectedGroup = groups.find(
    (group) => group.chapter.id === selected?.chapter,
  );
  const current = selectedGroup?.headings.find(
    (item) => item.id === selected?.heading,
  );
  const peers =
    selectedGroup?.headings.filter(
      (item) => item.movable && item.parent === current?.parent,
    ) || [];
  const index = peers.findIndex((item) => item.id === current?.id);
  const move = (direction: number) => {
    const target = peers[index + direction];
    if (selected && current?.movable && target)
      onMove(selected.chapter, current.id, target.id, direction > 0);
  };
  return (
    <aside
      className="word-find-panel document-outline"
      aria-label="Document outline"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>Outline</strong>
        <button aria-label="Close outline" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <label>
        Show
        <select
          aria-label="Outline contents"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setQuery("");
          }}
        >
          <option value="headings">Headings</option>
          <option value="bookmarks">Bookmarks</option>
          <option value="comments">Comments</option>
        </select>
      </label>
      <label>
        {kind === "headings"
          ? "Find heading"
          : kind === "comments"
            ? "Find comment"
            : "Find bookmark"}
        <input
          autoFocus
          type="search"
          aria-label={
            kind === "headings"
              ? "Find heading"
              : kind === "comments"
                ? "Find comment"
                : "Find bookmark"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {kind === "comments" ? (
        <nav aria-label="Document comments">
          {groups.map(({ chapter, comments }) => {
            const visible = comments.filter((item) =>
              item.thread.entries.some((entry) =>
                `${entry.author} ${entry.text}`
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              ),
            );
            return (
              <section key={chapter.id}>
                {chapters.length > 1 && (
                  <strong className="outline-chapter">{chapter.title}</strong>
                )}
                {visible.map((item) => (
                  <div className="outline-row" key={item.id}>
                    <button
                      className="outline-heading"
                      title={item.context}
                      onClick={() => onComment(chapter.id, item.id)}
                    >
                      {item.thread.entries[0].author || "Unknown author"}:{" "}
                      {item.thread.entries[0].text.slice(0, 160)}
                      {item.thread.resolved ? " · Resolved" : ""}
                      {item.incomplete ? " · Anchor incomplete" : ""}
                    </button>
                  </div>
                ))}
                {!visible.length && (
                  <small>
                    {comments.length
                      ? "No matching comments"
                      : "No comments in this chapter"}
                  </small>
                )}
              </section>
            );
          })}
        </nav>
      ) : kind === "bookmarks" ? (
        <nav aria-label="Document bookmarks">
          {groups.map(({ chapter, bookmarks }) => {
            const visible = bookmarks.filter((item) =>
              item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
            );
            return (
              <section key={chapter.id}>
                {chapters.length > 1 && (
                  <strong className="outline-chapter">{chapter.title}</strong>
                )}
                {visible.map((item) => (
                  <div className="outline-row" key={item.id}>
                    <button
                      className="outline-heading"
                      title={item.context}
                      onClick={() => onBookmark(chapter.id, item.id)}
                    >
                      {item.name}
                    </button>
                  </div>
                ))}
                {!visible.length && (
                  <small>
                    {bookmarks.length
                      ? "No matching bookmarks"
                      : "No bookmarks in this chapter"}
                  </small>
                )}
              </section>
            );
          })}
        </nav>
      ) : (
        <nav aria-label="Document headings">
          {groups.map(({ chapter, headings }) => {
            const byId = new Map(headings.map((item) => [item.id, item]));
            const parents = new Set(headings.map((item) => item.parent));
            const hidden = (item: OutlineHeading): boolean => {
              const parent = item.parent && byId.get(item.parent);
              return Boolean(
                parent &&
                (collapsed.has(`${chapter.id}:${parent.id}`) || hidden(parent)),
              );
            };
            const visible = headings.filter((item) =>
              query
                ? item.title
                    .toLocaleLowerCase()
                    .includes(query.toLocaleLowerCase())
                : !hidden(item),
            );
            return (
              <section key={chapter.id}>
                {chapters.length > 1 && (
                  <strong className="outline-chapter">{chapter.title}</strong>
                )}
                {visible.map((item) => {
                  const key = `${chapter.id}:${item.id}`;
                  const hasChildren = parents.has(item.id);
                  const active =
                    selected?.chapter === chapter.id &&
                    selected.heading === item.id;
                  const targeted =
                    drop?.chapter === chapter.id && drop.heading === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`outline-row${active ? " selected" : ""}${targeted ? (drop.after ? " drop-after" : " drop-before") : ""}`}
                      style={{ paddingLeft: `${(item.level - 1) * 0.7}rem` }}
                      onDragOver={(event) => {
                        if (
                          dragging?.chapter !== chapter.id ||
                          !item.movable ||
                          dragging.heading === item.id
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        setDrop({
                          chapter: chapter.id,
                          heading: item.id,
                          after: event.clientY > rect.top + rect.height / 2,
                        });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (dragging && drop?.chapter === dragging.chapter)
                          onMove(
                            dragging.chapter,
                            dragging.heading,
                            drop.heading,
                            drop.after,
                          );
                        setDragging(null);
                        setDrop(null);
                      }}
                    >
                      {hasChildren ? (
                        <button
                          className="outline-collapse"
                          aria-label={`${collapsed.has(key) ? "Expand" : "Collapse"} ${item.title}`}
                          aria-expanded={!collapsed.has(key)}
                          onClick={() =>
                            setCollapsed((old) => {
                              const next = new Set(old);
                              next.has(key) ? next.delete(key) : next.add(key);
                              return next;
                            })
                          }
                        >
                          {collapsed.has(key) ? (
                            <ChevronRight size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                        </button>
                      ) : (
                        <span className="outline-collapse" />
                      )}
                      <button
                        className="outline-heading"
                        aria-current={active ? "location" : undefined}
                        draggable={item.movable}
                        title={
                          item.movable
                            ? "Drag to move this heading and its content"
                            : item.title
                        }
                        onDragStart={(event) => {
                          setDragging({
                            chapter: chapter.id,
                            heading: item.id,
                          });
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", item.title);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDrop(null);
                        }}
                        onClick={() => {
                          setSelected({
                            chapter: chapter.id,
                            heading: item.id,
                          });
                          onSelect(chapter.id, item.id);
                        }}
                      >
                        {item.title}
                      </button>
                    </div>
                  );
                })}
                {!visible.length && (
                  <small>
                    {headings.length
                      ? "No matching headings"
                      : "Add a heading using the style selector."}
                  </small>
                )}
              </section>
            );
          })}
        </nav>
      )}
      {kind === "headings" && (
        <footer className="find-navigation">
          <small>Move heading and content</small>
          <button
            aria-label="Move heading up"
            disabled={!current?.movable || index <= 0}
            onClick={() => move(-1)}
          >
            <ArrowUp size={15} />
          </button>
          <button
            aria-label="Move heading down"
            disabled={
              !current?.movable || index < 0 || index >= peers.length - 1
            }
            onClick={() => move(1)}
          >
            <ArrowDown size={15} />
          </button>
        </footer>
      )}
    </aside>
  );
}
