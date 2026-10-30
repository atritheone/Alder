import { screenPageGeometry } from "./pageGeometry";
import { chapterRunningMatter } from "./runningMatter";
import { chapterHeadingContext } from "./runningHeadings";
import { chapterCaptionStarts } from "./documentCaptions";
import { chapterNoteStarts } from "./documentNotes";
import { chapterHeadingStarts } from "./headingNumbering";
import {
  documentPositionKey,
  readDocumentPosition,
  saveDocumentPosition,
  type DocumentPosition,
} from "./documentPosition";
import { useStoredPreference } from "./useStoredPreference";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FilePlus2,
  Ellipsis,
  Plus,
  Trash2,
  Volume2,
} from "lucide-react";
import Editor, { type EditorHandle } from "./Editor";
import PageArrangement from "./PageArrangement";
import PublicationPreview from "./PublicationPreview";
import { newChapter } from "./book";
import ChapterDialog from "./ChapterDialog";
import {
  chapterMatter,
  chapterRoleLabel,
  matterLabels,
  insertStructuredChapter,
} from "./bookStructure";
import { words } from "./api";
import {
  indexWords,
  countWords,
  estimatedReadingTime,
} from "./readingEstimate";
import { usePlaybackSettings } from "./usePlaybackSettings";
import { countSentences } from "./textCounts";
import type { Annotation, Chapter, Project } from "./types";
import { pageAtPosition, type FlowPage } from "./pageFlow";
import { pagesInRange } from "./pageRanges";
import "./book-workspace.css";
import DocumentReader from "./DocumentReader";
import { sourceForChapter, parseRawSource, rawTextDocument } from "./rawSource";
import { documentText } from "./textProjection";
import type { ReadingPosition } from "./readingCursor";

type Props = {
  flush: () => Promise<void>;
  externalPlayback?: boolean;
  onPlaybackChange?: (playing: boolean) => void;
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
  onCollectImage: (file:File)=>Promise<Project["assets"][number]>;
  onLink: () => void;
  onComplete?: () => void;
  onRead: (chapter: Chapter) => void;
  annotations?: Annotation[];
  annotationText?: string;
  readingRange?: { start: number; end: number } | null;
  previewActive: boolean;
  onPreview: (open: boolean) => void;
  previewUrl: string;
  previewKey: number;
};
export default function BookWorkspace(p: Props) {
  const isBook = !["txt", "docx"].includes(p.project.settings.documentKind);
  const chapters = p.project.book?.chapters || [];
  const wordIndexes = useMemo(
    () => chapters.map((chapter) => indexWords(chapter.text)),
    [chapters],
  );
  const wordCounts = wordIndexes.map((index) => index.length);
  const totalWords = wordCounts.reduce((total, count) => total + count, 0);
  const totalSentences = useMemo(
    () => chapters.reduce((sum, item) => sum + countSentences(item.text), 0),
    [chapters],
  );
  const chapter = chapters.find((c) => c.id === p.chapterId) || chapters[0];
  const headingStarts = useMemo(
    () => chapterHeadingStarts(p.project, chapter?.id || ""),
    [chapters, p.project.styles, chapter?.id],
  );
  const [rawActive, setRawActive] = useState(false);
  const [chapterDialog, setChapterDialog] = useState<{
    initial: Chapter;
    creating: boolean;
  } | null>(null);
  useEffect(() => {
    const add = () =>
      setChapterDialog({
        initial: newChapter(`Chapter ${chapters.length + 1}`),
        creating: true,
      });
    window.addEventListener("alder-add-chapter", add);
    return () => window.removeEventListener("alder-add-chapter", add);
  }, [chapters.length]);
  useEffect(() => setChapterDialog(null), [p.project.id]);
  const [rawOpenError, setRawOpenError] = useState("");
  useEffect(() => {
    const showFormatted = () => setRawActive(false);
    const showRaw = () => setRawActive(true);
    window.addEventListener("alder-show-formatted-document", showFormatted);
    window.addEventListener("alder-show-raw-document", showRaw);
    return () => {
      window.removeEventListener("alder-show-raw-document", showRaw);
      window.removeEventListener(
        "alder-show-formatted-document",
        showFormatted,
      );
    };
  }, []);
  useEffect(() => {
    setRawActive(false);
    setRawOpenError("");
  }, [chapter?.id]);
  const showRaw = rawActive && p.view === "Write" && !p.previewActive;
  const [selected, setSelected] = useState<{
    chapterId: string;
    text: string;
    from: number;
    to: number;
    start: number;
    end: number;
    words: number;
    sentences: number;
  } | null>(null);
  useEffect(() => setSelected(null), [chapter?.id, showRaw]);
  const selection =
    p.view === "Write" && selected?.chapterId === chapter?.id ? selected : null;
  const rawDocument = useMemo(
    () => rawTextDocument(chapter?.rawSource?.text || ""),
    [chapter?.rawSource?.text],
  );
  const [pages, setPages] = useState<FlowPage[]>([]);
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const arrangementRef = useRef<HTMLDivElement>(null);
  const [pageNumber, setPageNumber] = useState("1");
  useEffect(() => setPageNumber("1"), [chapter?.id]);
  const [zoom, setZoom] = useState(0.8);
  const [arrangementZoom, setArrangementZoom] = useState(0.8);
  const [rememberPosition] = useStoredPreference(
    "alder.rememberDocumentPosition",
    "true",
  );
  const positionKey = documentPositionKey(p.project.id);
  const pendingPosition = useRef<DocumentPosition | null>(null);
  const positionReady = useRef(false);
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePosition = useRef(() => {});
  savePosition.current = () => {
    if (!positionReady.current || showRaw || p.view !== "Write") return;
    const position = p.editorRef.current?.getDocumentPosition();
    if (position)
      saveDocumentPosition(
        positionKey,
        {
          ...position,
          offset:
            speechPlaying && readingPosition?.chapterId === chapter?.id
              ? readingPosition.offset
              : position.offset,
          chapter: Math.max(
            0,
            chapters.findIndex((c) => c.id === chapter?.id),
          ),
          zoom,
        },
        rememberPosition === "true",
      );
  };
  const queuePosition = () => {
    if (positionTimer.current) clearTimeout(positionTimer.current);
    positionTimer.current = setTimeout(() => savePosition.current(), 250);
  };
  useEffect(() => {
    const saved = readDocumentPosition(positionKey);
    pendingPosition.current = saved;
    positionReady.current = !saved;
    if (saved) {
      setZoom(saved.zoom);
      p.onChapter(
        chapters[Math.min(saved.chapter, chapters.length - 1)]?.id ||
          chapters[0]?.id,
      );
    }
    const save = () => savePosition.current();
    window.addEventListener("beforeunload", save);
    window.addEventListener("alder-save-document-position", save);
    return () => {
      if (positionTimer.current) clearTimeout(positionTimer.current);
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("alder-save-document-position", save);
    };
  }, [p.project.id]);
  useEffect(() => {
    const saved = pendingPosition.current;
    if (
      !saved ||
      !pages.length ||
      zoom !== saved.zoom ||
      chapter?.id !== chapters[Math.min(saved.chapter, chapters.length - 1)]?.id
    )
      return;
    const frame = requestAnimationFrame(() => {
      p.editorRef.current?.restoreDocumentPosition(saved);
      pendingPosition.current = null;
      positionReady.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [pages, chapter?.id, zoom]);
  useEffect(queuePosition, [zoom]);
  const [speechPlaying, setSpeechPlaying] = useState(false);
  useEffect(() => {
    p.onPlaybackChange?.(speechPlaying);
  }, [speechPlaying, p.onPlaybackChange]);
  useEffect(() => () => p.onPlaybackChange?.(false), [p.onPlaybackChange]);
  const [readingPosition, setReadingPosition] =
    useState<ReadingPosition | null>(null);
  const { speed } = usePlaybackSettings("reading");
  const selectedPages = selection
    ? Math.max(1, pagesInRange(pages, selection.from, selection.to).length)
    : 0;
  let estimateWords = selection?.words ?? totalWords;
  const readingIndex = chapters.findIndex(
    (item) => item.id === readingPosition?.chapterId,
  );
  const showingRemaining =
    speechPlaying && readingPosition !== null && readingIndex >= 0 && !showRaw;
  if (showingRemaining) {
    if (selection) {
      if (selection.chapterId === readingPosition.chapterId)
        estimateWords = countWords(
          wordIndexes[readingIndex],
          Math.max(selection.start, readingPosition.offset),
          selection.end,
        );
    } else {
      estimateWords =
        countWords(wordIndexes[readingIndex], readingPosition.offset) +
        wordCounts
          .slice(readingIndex + 1)
          .reduce((sum, count) => sum + count, 0);
    }
  }
  const [readerKeyboardOpen, setReaderKeyboardOpen] = useState(false);
  const [readingRange, setReadingRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const annotations = useMemo(
    () => (showRaw ? [] : p.annotations),
    [showRaw, p.annotations],
  );
  useEffect(() => {
    if (
      !speechPlaying ||
      showRaw ||
      !readingPosition ||
      readingPosition.chapterId !== chapter?.id
    )
      return;
    const page = p.editorRef.current?.pageAtTextOffset(
      readingPosition.offset,
      readingPosition.note,
    );
    if (page !== null && page !== undefined) setPageNumber(String(page + 1));
  }, [speechPlaying, readingPosition, pages, chapter?.id, showRaw]);
  const layout = useMemo(() => {
    const running = chapterRunningMatter(p.project, chapter?.id || "");
    return {
      ...screenPageGeometry(p.project.settings),
      lineHeight: p.project.settings.lineHeight,
      language: p.project.language,
      header: p.project.settings.header,
      footer: p.project.settings.footer,
      runningMatter:
        p.project.settings.runningMatter || running.sectionId
          ? running.matter
          : undefined,
      runningSectionId: running.sectionId,
      headingContext: chapterHeadingContext(p.project, chapter?.id || ""),
      noteStarts: chapterNoteStarts(p.project, chapter?.id || ""),
      noteOptions: p.project.settings.noteOptions,
      runningStyles: p.project.styles,
      firstPageNumber: p.project.settings.firstPageNumber || 1,
      pageNumberFormat: p.project.settings.pageNumberFormat,
      fontFamily: p.project.settings.fontFamily,
      zoom,
    };
  }, [
    p.project.settings.orientation,
    p.project.language,
    p.project.settings.pageSize,
    p.project.settings.marginMm,
    p.project.settings.marginTopMm,
    p.project.settings.marginRightMm,
    p.project.settings.marginBottomMm,
    p.project.settings.marginLeftMm,
    p.project.settings.gutterMm,
    p.project.settings.mirrorMargins,
    p.project.settings.columns,
    p.project.settings.pageBorder,
    p.project.settings.watermark,
    p.project.settings.lineNumbering,
    p.project.settings.pageWidthMm,
    p.project.settings.pageHeightMm,
    p.project.settings.lineHeight,
    p.project.settings.header,
    p.project.settings.footer,
    p.project.settings.runningMatter,
    p.project.settings.noteOptions,
    chapters,
    chapter?.id,
    p.project.styles,
    p.project.settings.firstPageNumber,
    p.project.settings.pageNumberFormat,
    p.project.settings.fontFamily,
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
    setChapterDialog({ initial: next, creating: true });
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
      onScrollCapture={queuePosition}
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
                data-context-actions="button"
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
                      {item.role !== "chapter" &&
                        `${chapterRoleLabel(item.role)} · `}
                      {wordCounts[index]} words
                      {!item.include ? " · excluded" : ""}
                    </small>
                  </span>
                </button>
                <div className="chapter-actions">
                  <button
                    aria-label={`Properties for ${item.title}`}
                    onClick={() =>
                      setChapterDialog({ initial: item, creating: false })
                    }
                  >
                    <Ellipsis size={13} />
                  </button>
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
      <div
        className={`book-main${p.view === "Pages" ? " arranging-pages" : ""}`}
      >
        {!showRaw && (
          <div
            className="reader-reveal"
            data-keyboard-open={readerKeyboardOpen}
            onFocus={(event) => {
              if (
                event.target === event.currentTarget &&
                event.target.matches(":focus-visible")
              )
                setReaderKeyboardOpen(true);
            }}
            onKeyDown={() => setReaderKeyboardOpen(true)}
            onPointerEnter={() => setReaderKeyboardOpen(false)}
            onPointerLeave={() => setReaderKeyboardOpen(false)}
            tabIndex={p.view === "Pages" ? 0 : undefined}
            aria-label={p.view === "Pages" ? "Reading controls" : undefined}
          >
            <DocumentReader
              project={p.project}
              chapter={chapter}
              editorRef={p.editorRef}
              flush={p.flush}
              change={p.change}
              onChapter={p.onChapter}
              onHighlight={setReadingRange}
              onPlaybackChange={setSpeechPlaying}
              onPosition={setReadingPosition}
            />
          </div>
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
            <button
              aria-label="Chapter properties"
              title={`${matterLabels[chapterMatter(chapter)]} · ${chapterRoleLabel(chapter.role)}`}
              onClick={() =>
                setChapterDialog({ initial: chapter, creating: false })
              }
            >
              <Ellipsis size={14} />
            </button>
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
            <PageArrangement
              key={chapter.id}
              snapshots={snapshots}
              pages={pages}
              layout={layout}
              zoom={arrangementZoom}
              onZoom={setArrangementZoom}
              areaRef={arrangementRef}
              onMove={(from, to) => p.editorRef.current?.movePage(from, to)}
              onMoveUnit={(unit, to) => p.editorRef.current?.moveUnit(unit, to)}
            />
          )}
          <div
            className={
              p.view === "Pages" || p.previewActive
                ? "book-editor measuring-editor"
                : "book-editor"
            }
          >
            <Editor
              language={p.project.language}
              ref={p.editorRef}
              review={{
                tracking: p.project.settings.trackChanges === true,
                author:
                  p.project.settings.reviewAuthor ||
                  p.project.settings.author ||
                  "",
              }}
              onReviewPreferences={(value) =>
                p.change((project) => {
                  project.settings.trackChanges = value.tracking;
                  project.settings.reviewAuthor = value.author;
                })
              }
              label={showRaw ? "Raw text editor" : "Chapter text editor"}
              document={showRaw ? rawDocument : chapter.document}
              identity={
                p.project.id +
                ":" +
                chapter.id +
                (showRaw ? ":raw" : ":formatted")
              }
              projectId={p.project.id}
              assets={p.project.assets}
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
              onSelection={(word, text, range) => {
                queuePosition();
                p.onSelection(word, text);
                if (!range || range.from === range.to) {
                  if (selected) setSelected(null);
                } else if (
                  !selected ||
                  selected.chapterId !== chapter.id ||
                  selected.from !== range.from ||
                  selected.to !== range.to ||
                  selected.text !== text
                ) {
                  const offsets = p.editorRef.current?.getSelectionOffsets();
                  if (offsets)
                    setSelected({
                      chapterId: chapter.id,
                      text,
                      ...range,
                      ...offsets,
                      words: words(text),
                      sentences: countSentences(text),
                    });
                }
              }}
              onFocus={p.onFocus}
              annotations={annotations}
              annotationText={p.annotationText}
              suppressChecks={speechPlaying || p.externalPlayback}
              readingRange={showRaw ? null : readingRange}
              persistentCaret
              pageLayout={layout}
              layoutVisible={p.view === "Write" && !p.previewActive}
              capturePages={p.view === "Pages"}
              onPageSnapshots={(next) =>
                setSnapshots((old) =>
                  old.length === next.length &&
                  old.every((html, i) => html === next[i])
                    ? old
                    : next,
                )
              }
              onVisiblePage={(page) => {
                if (
                  p.view === "Write" &&
                  !speechPlaying &&
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
              onCollectImage={p.onCollectImage}
              onLink={p.onLink}
              onComplete={p.onComplete}
              fontFamily={showRaw ? "monospace" : p.project.settings.fontFamily}
              fontSize={(p.project.settings.fontSize * 96) / 72}
              styles={p.project.styles}
              captionStarts={chapterCaptionStarts(p.project, chapter.id)}
              headingStarts={headingStarts}
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
                ) {
                  if (p.view === "Pages")
                    arrangementRef.current
                      ?.querySelector(`.page-card[data-page="${value - 1}"]`)
                      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
                  else p.editorRef.current?.navigatePage(value - 1);
                }
              }}
            >
              {selection ? (
                <span
                  className="selection-page-count"
                  title="Pages covered by the selection"
                >
                  {selectedPages} {selectedPages === 1 ? "Page" : "Pages"}
                </span>
              ) : (
                <>
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
                </>
              )}
              <span className="writing-counts">
                <span
                  className="writing-word-count"
                  title={selection ? "Words in selection" : "Words in document"}
                >
                  {selection?.words ?? totalWords} Words
                </span>
                <span
                  className="writing-sentence-count"
                  title={
                    selection
                      ? "Sentences in selection"
                      : "Sentences in document"
                  }
                >
                  {` \u00a0${selection?.sentences ?? totalSentences} Sentences`}
                </span>
                <span
                  className="reading-estimate"
                  title={`Estimated ${showingRemaining ? "time remaining" : "reading time"}${selection ? " for selection" : " for document"} (hours:minutes)`}
                >
                  {estimatedReadingTime(estimateWords, speed)}
                </span>
                {isBook && !selection && ` · ${chapters.length} Chapters`}
              </span>
              {p.view === "Write" &&
                !showRaw &&
                readingPosition?.chapterId === chapter.id && (
                  <span
                    className="reading-progress"
                    aria-label="Reading progress"
                    title="TTS position through this chapter's text"
                  >
                    {Math.max(
                      0,
                      Math.min(
                        100,
                        readingPosition.length
                          ? (100 * readingPosition.offset) /
                              readingPosition.length
                          : 0,
                      ),
                    ).toFixed(0)}
                    %
                  </span>
                )}
              <label className="writing-zoom">
                Zoom{" "}
                <select
                  aria-label="Page zoom"
                  value={p.view === "Pages" ? arrangementZoom : zoom}
                  onChange={(e) =>
                    (p.view === "Pages" ? setArrangementZoom : setZoom)(
                      Number(e.target.value),
                    )
                  }
                >
                  {Array.from({ length: 51 }, (_, i) => (50 + i * 5) / 100).map(
                    (z) => (
                      <option key={z} value={z}>
                        {Math.round(z * 100)}%
                      </option>
                    ),
                  )}
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
      {chapterDialog && (
        <ChapterDialog
          key={chapterDialog.initial.id}
          initial={chapterDialog.initial}
          creating={chapterDialog.creating}
          onClose={() => setChapterDialog(null)}
          onApply={(value) => {
            p.change((project) => {
              if (chapterDialog.creating)
                insertStructuredChapter(project.book!.chapters, value);
              else {
                const target = project.book!.chapters.find(
                  (item) => item.id === value.id,
                );
                if (target)
                  Object.assign(target, {
                    title: value.title,
                    role: value.role,
                    matter: value.matter,
                    showTitle: value.showTitle,
                    include: value.include,
                  });
              }
            });
            p.onChapter(value.id);
            setChapterDialog(null);
          }}
        />
      )}
    </section>
  );
}
