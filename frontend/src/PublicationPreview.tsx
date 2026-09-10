import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDocument,
  PDFWorker,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { api, download, mediaUrl } from "./api";
import type { Project } from "./types";
import "./publication-preview.css";

type Props = { project: Project; refreshKey: number; htmlUrl: string };
type Proof = {
  downloadUrl: string;
  filename: string;
  sourceRevision: number;
  warnings?: string[];
};

// PDF.js 6's binary factory keeps its standard fonts and decoders inside Vite's
// asset graph. No reader font or decoder is fetched from a CDN or system path.
const binaryAssets = import.meta.glob(
  "../../node_modules/pdfjs-dist/{standard_fonts,wasm,cmaps}/*",
  {
    query: "?url",
    import: "default",
    eager: true,
  },
) as Record<string, string>;
class BundledPdfData {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory = {
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
      cMapUrl: "cmaps",
    }[kind];
    const url =
      directory &&
      binaryAssets[`../../node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url)
      throw new Error(
        `The bundled PDF reader resource is missing: ${filename}`,
      );
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Unable to read bundled PDF resource: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export default function PublicationPreview({
  project,
  refreshKey,
  htmlUrl,
}: Props) {
  const [mode, setMode] = useState<"print" | "reading">("print");
  const [retry, setRetry] = useState(0);
  const [proof, setProof] = useState<Proof | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState("fit");
  const [readerWidth, setReaderWidth] = useState("760");
  const [readerFont, setReaderFont] = useState("18");
  const [readerHtml, setReaderHtml] = useState("");
  const [readerError, setReaderError] = useState("");
  const [readerSection, setReaderSection] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Building the PDF proof…");
  const [rendering, setRendering] = useState(false);
  const [pageText, setPageText] = useState("");
  const [panelWidth, setPanelWidth] = useState(800);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const readerFrame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReaderHtml("");
    setReaderError("");
    setReaderSection("");
    void fetch(htmlUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            `Unable to load the reading preview (${response.status}).`,
          );
        const html = await response.text();
        if (!controller.signal.aborted) setReaderHtml(html);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setReaderError((cause as Error).message);
      });
    return () => controller.abort();
  }, [htmlUrl, project.id, refreshKey, retry]);

  const reading = useMemo(() => {
    if (!readerHtml)
      return { source: "", sections: [] as { id: string; title: string }[] };
    const document = new DOMParser().parseFromString(readerHtml, "text/html");
    const style = document.createElement("style");
    style.textContent = `body{font-size:${Number(readerFont)}px!important}main{max-width:none;padding:1.4em}main p,main li,main td,main th,main span{font-size:inherit!important}html{scroll-behavior:smooth}`;
    document.head.append(style);
    const sections = [...document.querySelectorAll("main section")].map(
      (section, index) => {
        section.id ||= `reader-section-${index}`;
        return {
          id: section.id,
          title:
            section.querySelector("h1,h2,h3")?.textContent ||
            `Section ${index + 1}`,
        };
      },
    );
    return {
      source: "<!DOCTYPE html>" + document.documentElement.outerHTML,
      sections,
    };
  }, [readerHtml, readerFont]);
  const navigateReading = (id: string) => {
    setReaderSection(id);
    if (id)
      readerFrame.current?.contentDocument
        ?.getElementById(id)
        ?.scrollIntoView({ block: "start" });
    else readerFrame.current?.contentWindow?.scrollTo(0, 0);
  };

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setPanelWidth(entries[0].contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    let worker: Worker | undefined;
    let pdfWorker: PDFWorker | undefined;
    let task: ReturnType<typeof getDocument> | undefined;
    setPdf(null);
    setProof(null);
    setError("");
    setPage(1);
    setPageText("");
    setStatus("Building the PDF proof from the saved collation…");
    void (async () => {
      try {
        const result = await api<Proof>(
          `/api/projects/${project.id}/export`,
          "POST",
          { format: "pdf" },
        );
        if (!current) return;
        setProof(result);
        setStatus(`Loading PDF proof · revision ${result.sourceRevision}…`);
        const response = await fetch(mediaUrl(result.downloadUrl), {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Unable to load the PDF proof (${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (!current) return;
        // Supplying the port directly also works on Electron's alder: origin;
        // PDF.js does not need to manufacture a cross-origin blob worker.
        worker = new Worker(workerUrl, { type: "module" });
        pdfWorker = PDFWorker.create({ port: worker });
        task = getDocument({
          data,
          worker: pdfWorker,
          useWorkerFetch: false,
          BinaryDataFactory: BundledPdfData,
          useSystemFonts: false,
          disableFontFace: true,
          stopAtErrors: true,
        });
        const document = await task.promise;
        if (!current) return;
        setPdf(document);
        setStatus(`PDF proof · saved revision ${result.sourceRevision}`);
      } catch (cause) {
        if (current) {
          setError(
            (cause as Error).message || "The PDF proof could not be prepared.",
          );
          setStatus("PDF proof unavailable");
        }
      }
    })();
    return () => {
      current = false;
      controller.abort();
      // Finish any reader work before terminating the shared message port.
      void Promise.resolve(task?.destroy())
        .catch(() => {})
        .finally(() => {
          pdfWorker?.destroy();
          worker?.terminate();
        });
    };
    // A revision change may be an optimistic edit. Only the caller's completed
    // flush/refresh token (or an explicit retry of saved content) requests a proof.
  }, [project.id, refreshKey, retry]);

  useEffect(() => {
    if (!pdf || mode !== "print" || !canvas.current) return;
    let current = true;
    let render: RenderTask | undefined;
    const target = canvas.current;
    setRendering(true);
    setPageText("");
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (!current) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const scale =
          zoom === "fit"
            ? Math.max(0.15, Math.min(2, (panelWidth - 48) / original.width))
            : Number(zoom);
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        target.width = Math.ceil(viewport.width * ratio);
        target.height = Math.ceil(viewport.height * ratio);
        target.style.width = `${viewport.width}px`;
        target.style.height = `${viewport.height}px`;
        render = pdfPage.render({
          canvas: target,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
        const content = await pdfPage.getTextContent();
        if (current)
          setPageText(
            content.items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
      } catch (cause) {
        if (current && (cause as Error).name !== "RenderingCancelledException")
          setError(`Page ${page}: ${(cause as Error).message}`);
      } finally {
        if (current) setRendering(false);
      }
    })();
    return () => {
      current = false;
      render?.cancel();
    };
  }, [pdf, page, zoom, panelWidth, mode]);

  const saveProof = async () => {
    if (!proof) return;
    try {
      const path = await download(proof.downloadUrl, proof.filename);
      setStatus(
        path
          ? `Saved PDF proof · revision ${proof.sourceRevision}`
          : "PDF save cancelled",
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const earlier = proof && proof.sourceRevision !== project.revision;
  return (
    <section
      className="workspace pane publication-preview"
      aria-label="Publication preview"
    >
      <div className="publication-toolbar">
        <strong>Publication preview</strong>
        <div
          className="publication-modes"
          role="group"
          aria-label="Publication preview mode"
        >
          <button
            aria-pressed={mode === "print"}
            onClick={() => setMode("print")}
          >
            Print PDF
          </button>
          <button
            aria-pressed={mode === "reading"}
            onClick={() => setMode("reading")}
          >
            Reflowable reading
          </button>
        </div>
        {mode === "print" ? (
          <>
            <button
              aria-label="Previous PDF page"
              disabled={!pdf || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <label>
              Page{" "}
              <input
                aria-label="PDF page number"
                type="number"
                min={1}
                max={pdf?.numPages || 1}
                value={page}
                disabled={!pdf}
                onChange={(event) =>
                  setPage(
                    Math.max(
                      1,
                      Math.min(
                        pdf?.numPages || 1,
                        Number(event.target.value) || 1,
                      ),
                    ),
                  )
                }
              />
              <span>of {pdf?.numPages || "—"}</span>
            </label>
            <button
              aria-label="Next PDF page"
              disabled={!pdf || page >= pdf.numPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
            <label>
              Zoom{" "}
              <select
                aria-label="PDF zoom"
                value={zoom}
                onChange={(event) => setZoom(event.target.value)}
              >
                <option value="fit">Fit width</option>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                  <option value={value} key={value}>
                    {value * 100}%
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!proof} onClick={() => void saveProof()}>
              Save this PDF
            </button>
          </>
        ) : (
          <>
            <label>
              Reading width{" "}
              <select
                aria-label="Reading preview width"
                value={readerWidth}
                onChange={(event) => setReaderWidth(event.target.value)}
              >
                <option value="360">Phone · 360 px</option>
                <option value="600">Small reader · 600 px</option>
                <option value="760">Book · 760 px</option>
                <option value="100%">Full width</option>
              </select>
            </label>
            <label>
              Type size{" "}
              <select
                aria-label="Reading preview type size"
                value={readerFont}
                onChange={(event) => setReaderFont(event.target.value)}
              >
                {[14, 16, 18, 20, 24, 28].map((size) => (
                  <option value={size} key={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
            <label>
              Contents{" "}
              <select
                aria-label="Reading preview contents"
                value={readerSection}
                onChange={(event) => navigateReading(event.target.value)}
              >
                <option value="">Start of publication</option>
                {reading.sections.map((section) => (
                  <option value={section.id} key={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="publication-proof-status" role="status">
        <span>
          {mode === "print"
            ? status
            : "Reflowable HTML · current saved collation; ebook readers may wrap differently."}
        </span>
        {mode === "print" && earlier && (
          <strong>
            Earlier revision; reopen Page Preview after saving to refresh.
          </strong>
        )}
        {rendering && mode === "print" && <span>Rendering page…</span>}
      </div>
      {error && (
        <div className="publication-error" role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              setError("");
              setRetry((n) => n + 1);
            }}
          >
            Retry saved collation
          </button>
        </div>
      )}
      {!!proof?.warnings?.length && (
        <details className="publication-warnings">
          <summary>
            {proof.warnings.length} publication{" "}
            {proof.warnings.length === 1 ? "notice" : "notices"}
          </summary>
          <ul>
            {proof.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      {mode === "print" ? (
        <div
          className="publication-canvas-scroll"
          ref={scroller}
          aria-busy={rendering || (!pdf && !error)}
        >
          {pdf ? (
            <>
              <canvas
                ref={canvas}
                role="img"
                aria-label={`PDF page ${page} of ${pdf.numPages}. Text is available below.`}
              />
              <details className="publication-page-text">
                <summary>Read page text</summary>
                <p>
                  {pageText ||
                    (rendering
                      ? "Rendering…"
                      : "This page contains no selectable text.")}
                </p>
              </details>
            </>
          ) : (
            <p className="publication-loading">
              {error
                ? "Resolve the error above to view the PDF."
                : "Preparing the same PDF file used for export…"}
            </p>
          )}
        </div>
      ) : (
        <div className="publication-reading-scroll">
          {readerError ? (
            <p role="alert">
              {readerError}
              <button onClick={() => setRetry((n) => n + 1)}>
                Retry reading preview
              </button>
            </p>
          ) : reading.source ? (
            <iframe
              ref={readerFrame}
              title="Reflowable publication preview"
              sandbox="allow-same-origin"
              srcDoc={reading.source}
              onLoad={() => navigateReading(readerSection)}
              style={{
                width: readerWidth === "100%" ? "100%" : `${readerWidth}px`,
              }}
            />
          ) : (
            <p className="publication-loading">Preparing reading preview…</p>
          )}
        </div>
      )}
    </section>
  );
}
