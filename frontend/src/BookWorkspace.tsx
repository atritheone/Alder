import { useEffect, useMemo, useState, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FilePlus2,
  Plus,
  Trash2,
  Volume2,
} from "lucide-react";
import Editor, { type EditorHandle } from "./Editor";
import PublicationPreview from "./PublicationPreview";
import { newChapter } from "./book";
import { words } from "./api";
import type { Annotation, Chapter, Project } from "./types";
import type { FlowPage } from "./pageFlow";
import "./book-workspace.css";
import DocumentReader from "./DocumentReader";
import { sourceForChapter, parseRawSource, rawTextDocument } from "./rawSource";
import { documentText } from "./textProjection";

type Props = {
  flush: () => Promise<void>;
  externalPlayback?: boolean;
  project: Project;
  change: (fn: (p: Project) => void) => void;
  view: string;
  showStructure: boolean;
  onToggleStructure: () => void;
  chapterId: string | null;
  onChapter: (id: string) => void;
  editorRef: RefObject<EditorHandle | null>;
  onSelection: (word: string, selection: string) => void;
  onFocus: () => void;
  onImage: () => void;
  onLink: () => void;
  onComplete?: () => void;
  onRead: (chapter: Chapter) => void;
  annotations?: Annotation[];
  readingRange?: { start: number; end: number } | null;
  previewActive: boolean;
  onPreview: (open: boolean) => void;
  previewUrl: string;
  previewKey: number;
};
export default function BookWorkspace(p: Props) {
  const isBook = !["txt", "docx"].includes(p.project.settings.documentKind);
  const chapters = p.project.book?.chapters || [];
  const chapter = chapters.find((c) => c.id === p.chapterId) || chapters[0];
  const [rawActive, setRawActive] = useState(false);
  const [rawOpenError, setRawOpenError] = useState("");
  useEffect(() => {
    setRawActive(false);
    setRawOpenError("");
  }, [chapter?.id]);
  const showRaw = rawActive && p.view === "Write" && !p.previewActive;
  const rawDocument = useMemo(
    () => rawTextDocument(chapter?.rawSource?.text || ""),
    [chapter?.rawSource?.text],
  );
  const [pages, setPages] = useState<FlowPage[]>([]);
  const [pageNumber, setPageNumber] = useState("1");
  useEffect(() => setPageNumber("1"), [chapter?.id]);
  const [zoom, setZoom] = useState(0.8);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const [readingRange, setReadingRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const layout = useMemo(() => {
    const size: Record<string, [number, number]> = {
      A4: [210, 297],
      A5: [148, 210],
      Letter: [215.9, 279.4],
      Legal: [215.9, 355.6],
      "6x9": [152.4, 228.6],
    };
    const dimensions = size[p.project.settings.pageSize] || size.A4;
    const [w, h] =
      p.project.settings.orientation === "landscape"
        ? [dimensions[1], dimensions[0]]
        : dimensions;
    return {
      width: (w * 96) / 25.4,
      height: (h * 96) / 25.4,
      margin: (Math.min(p.project.settings.marginMm, w / 3, h / 3) * 96) / 25.4,
      lineHeight: p.project.settings.lineHeight,
      zoom,
    };
  }, [
    p.project.settings.orientation,
    p.project.settings.pageSize,
    p.project.settings.marginMm,
    p.project.settings.lineHeight,
    zoom,
  ]);
  if (!chapter) return null;
  const update = (fn: (c: Chapter) => void) =>
    p.change((project) => {
      const target = project.book!.chapters.find((c) => c.id === chapter.id);
      if (target) fn(target);
    });
  const toggleRaw = () => {
    if (showRaw) {
      setRawActive(false);
      return;
    }
    try {
      const source = sourceForChapter({
        ...chapter,
        rawFormat:
          chapter.rawFormat ||
          (p.project.settings.preferredFormat === "md" ||
          (chapters.length === 1 &&
            /\.(md|markdown)$/i.test(p.project.lastImport?.name || ""))
            ? "markdown"
            : "html"),
      });
      update((c) => {
        c.rawSource = source;
        c.rawFormat = source.format;
      });
      setRawOpenError("");
      setRawActive(true);
    } catch (error) {
      setRawOpenError((error as Error).message);
    }
  };
  const editRaw = (text: string) => {
    const source = { format: chapter.rawSource!.format, text };
    try {
      const document = parseRawSource(source);
      update((c) => {
        c.rawSource = source;
        c.document = document;
        c.text = documentText(document);
      });
    } catch (error) {
      update((c) => {
        c.rawSource = { ...source, error: (error as Error).message };
      });
    }
  };
  const add = () => {
    const next = newChapter(`Chapter ${chapters.length + 1}`);
    p.change((project) => project.book!.chapters.push(next));
    p.onChapter(next.id);
  };
  const moveChapter = (id: string, offset: number) =>
    p.change((project) => {
      const list = project.book!.chapters,
        at = list.findIndex((c) => c.id === id),
        to = at + offset;
      if (to >= 0 && to < list.length)
        list.splice(to, 0, list.splice(at, 1)[0]);
    });
  return (
    <section
      className={`workspace pane book-workspace${speechPlaying || p.externalPlayback ? " speech-playing" : ""}`}
      aria-label="Book workspace"
    >
      {isBook && (
        <nav className="book-outline" aria-label="Book chapters">
          <header>
            <BookOpen size={15} />
            <strong>
              {p.project.settings.documentKind &&
              p.project.settings.documentKind !== "book"
                ? "Document"
                : "Book"}
            </strong>
            <button onClick={add} aria-label="Add chapter">
              <Plus size={14} />
            </button>
          </header>
          <div className="chapter-list">
            {chapters.map((item, index) => (
              <div
                key={item.id}
                className={`chapter-entry ${item.id === chapter.id ? "selected" : ""}`}
              >
                <button
                  className="chapter-select"
                  aria-label={`Open chapter ${item.title}`}
                  aria-current={item.id === chapter.id ? "page" : undefined}
                  onClick={() => {
                    p.onChapter(item.id);
                    setPages([]);
                  }}
                >
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <span>
                    {item.title || p.project.name}
                    <small>
                      {words(item.text)} words
                      {!item.include ? " · excluded" : ""}
                    </small>
                  </span>
                </button>
                <div className="chapter-actions">
                  <button
                    aria-label={`Move ${item.title} earlier`}
                    disabled={index === 0}
                    onClick={() => moveChapter(item.id, -1)}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    aria-label={`Move ${item.title} later`}
                    disabled={index === chapters.length - 1}
                    onClick={() => moveChapter(item.id, 1)}
                  >
                    <ArrowDown size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={add}>
            <FilePlus2 size={13} /> Add chapter
          </button>
        </nav>
      )}
      <div className="book-main">
        {!showRaw && (
          <DocumentReader
            project={p.project}
            chapter={chapter}
            editorRef={p.editorRef}
            flush={p.flush}
            change={p.change}
            onChapter={p.onChapter}
            onHighlight={setReadingRange}
            onPlaybackChange={setSpeechPlaying}
          />
        )}
        {isBook && (
          <header className="chapter-toolbar">
            <input
              aria-label="Chapter title"
              value={chapter.title}
              onChange={(e) =>
                update((c) => {
                  c.title = e.target.value || "Untitled chapter";
                })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={chapter.include}
                onChange={(e) =>
                  update((c) => {
                    c.include = e.target.checked;
                  })
                }
              />
              Include in book
            </label>
            <button
              aria-label="Delete chapter"
              disabled={chapters.length === 1}
              onClick={() => {
                const next = chapters.find((c) => c.id !== chapter.id)!;
                p.change((project) => {
                  project.book!.chapters = project.book!.chapters.filter(
                    (c) => c.id !== chapter.id,
                  );
                });
                p.onChapter(next.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </header>
        )}
        {rawOpenError && <p role="alert">{rawOpenError}</p>}
        {showRaw && chapter.rawSource?.error && (
          <p className="raw-source-error" role="alert">
            {chapter.rawSource.error}
          </p>
        )}
        {p.previewActive && (
          <PublicationPreview
            onClose={() => p.onPreview(false)}
            project={p.project}
            refreshKey={p.previewKey}
            htmlUrl={p.previewUrl}
          />
        )}
        <>
          {p.view === "Pages" && (
            <div
              className="page-arranger"
              aria-label="Arrange pages"
              data-help="Drag pages into reading order, or use the arrows. Moving a page adds explicit page breaks to preserve its boundaries. Undo typing reverses the move."
            >
              <div className="page-card-grid">
                {pages.map((page, i) => (
                  <article
                    className="page-card"
                    key={i}
                    draggable
                    onDragStart={() => setDragged(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragged !== null)
                        p.editorRef.current?.movePage(dragged, i);
                      setDragged(null);
                    }}
                  >
                    <header>Page {i + 1}</header>
                    <p>{page.text.slice(0, 750) || "Blank page"}</p>
                    <footer>
                      <button
                        aria-label={`Move page ${i + 1} earlier`}
                        disabled={i === 0}
                        onClick={() => p.editorRef.current?.movePage(i, i - 1)}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        aria-label={`Move page ${i + 1} later`}
                        disabled={i === pages.length - 1}
                        onClick={() => p.editorRef.current?.movePage(i, i + 1)}
                      >
                        <ArrowDown size={12} />
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            </div>
          )}
          <div
            className={
              p.view === "Pages" || p.previewActive
                ? "book-editor measuring-editor"
                : "book-editor"
            }
          >
            <Editor
              ref={p.editorRef}
              label={showRaw ? "Raw text editor" : "Chapter text editor"}
              document={showRaw ? rawDocument : chapter.document}
              identity={chapter.id + (showRaw ? ":raw" : ":formatted")}
              rawMode={showRaw}
              onToggleRaw={p.view === "Write" ? toggleRaw : undefined}
              rawDisabled={
                speechPlaying ||
                !!p.externalPlayback ||
                (showRaw && !!chapter.rawSource?.error)
              }
              onChange={(document, text) =>
                showRaw
                  ? editRaw(text)
                  : update((c) => {
                      c.document = document;
                      c.text = text;
                      delete c.rawSource;
                    })
              }
              onSelection={p.onSelection}
              onFocus={p.onFocus}
              annotations={showRaw ? [] : p.annotations}
              readingRange={showRaw ? null : readingRange}
              persistentCaret
              pageLayout={layout}
              layoutVisible={p.view === "Write" && !p.previewActive}
              onVisiblePage={(page) => {
                if (
                  document.activeElement?.getAttribute("aria-label") !==
                  "Go To Page"
                )
                  setPageNumber(String(page + 1));
              }}
              onPages={(next) =>
                setPages((old) =>
                  JSON.stringify(old) === JSON.stringify(next) ? old : next,
                )
              }
              showStructure={p.showStructure}
              onToggleStructure={p.onToggleStructure}
              onImage={p.onImage}
              onLink={p.onLink}
              onComplete={p.onComplete}
              fontFamily={showRaw ? "monospace" : p.project.settings.fontFamily}
              fontSize={(p.project.settings.fontSize * 96) / 72}
              styles={p.project.styles}
            />
          </div>
          {!p.previewActive && ["Write", "Pages"].includes(p.view) && (
            <form
              className="page-navigation"
              aria-label="Chapter Pages"
              onSubmit={(e) => {
                e.preventDefault();
                const value = Number(pageNumber);
                if (
                  Number.isInteger(value) &&
                  value >= 1 &&
                  value <= Math.max(1, pages.length)
                )
                  p.editorRef.current?.navigatePage(value - 1);
              }}
            >
              <label>
                Page{" "}
                <input
                  aria-label="Go To Page"
                  type="number"
                  min="1"
                  max={Math.max(1, pages.length)}
                  step="1"
                  value={pageNumber}
                  style={{ width: `${Math.max(1, pageNumber.length)}ch` }}
                  onChange={(e) => setPageNumber(e.target.value)}
                  data-help="Type a page number and press Enter to go to that page."
                />
              </label>
              <span>of {Math.max(1, pages.length)}</span>
              <span className="writing-counts">
                {words(chapters.map((c) => c.text).join(" "))} Words
                {isBook && ` · ${chapters.length} Chapters`}
              </span>
              <label className="writing-zoom">
                Zoom{" "}
                <select
                  aria-label="Page zoom"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  {[0.5, 0.65, 0.8, 1, 1.25].map((z) => (
                    <option key={z} value={z}>
                      {Math.round(z * 100)}%
                    </option>
                  ))}
                </select>
              </label>
              {p.view === "Write" && (
                <button
                  type="button"
                  aria-label="Preview"
                  disabled={!!chapter.rawSource?.error}
                  data-help="Preview the saved publication layout. Back To Write returns to editing at your current position."
                  onClick={() => p.onPreview(true)}
                >
                  Preview
                </button>
              )}
            </form>
          )}
        </>
      </div>
    </section>
  );
}
