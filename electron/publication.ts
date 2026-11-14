import { BrowserWindow } from "electron";
import { createHash } from "node:crypto";
import { SharedWork } from "./sharedWork";
import { mark } from "./performance";

const prepared = new SharedWork<{ metadata: any; data: Buffer | null }>(
  32 * 1024 * 1024,
  4,
  30_000,
  (value) =>
    (value.data?.byteLength || 0) + JSON.stringify(value.metadata).length * 2,
  (value) => ({
    metadata: structuredClone(value.metadata),
    data: value.data ? Buffer.from(value.data) : null,
  }),
);

let queue: Promise<unknown> = Promise.resolve();

/** One detached renderer at a time bounds memory without blocking the visible
 * editor or its audio. Every job receives an already frozen semantic snapshot. */
export function renderPublicationPdf(
  input: unknown,
  preload: string,
  pdf = true,
  signal?: AbortSignal,
) {
  if ((input as any)?.fontIdentity) {
    const { id, ...snapshot } = input as any;
    const key = createHash("sha256")
      .update(JSON.stringify([snapshot, preload, pdf]))
      .digest("hex");
    return prepared.run(
      key,
      (current) => renderUncached(input, preload, pdf, current),
      signal,
    );
  }
  return renderUncached(input, preload, pdf, signal);
}
function renderUncached(
  input: unknown,
  preload: string,
  pdf: boolean,
  signal?: AbortSignal,
) {
  const work = queue
    .catch(() => {})
    .then(async () => {
      signal?.throwIfAborted();
      const renderer = new BrowserWindow({
        show: false,
        focusable: false,
        width: 1440,
        height: 1000,
        webPreferences: {
          preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      renderer.setMenu(null);
      const cancel = () => {
        if (!renderer.isDestroyed()) renderer.destroy();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      renderer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      renderer.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      const timeout = setTimeout(() => {
        if (!renderer.isDestroyed()) renderer.destroy();
      }, 120000);
      try {
        const started = performance.now();
        await renderer.loadURL("alder://app/index.html?publication=1");
        mark("publication.renderer-create", performance.now() - started);
        signal?.throwIfAborted();
        const layoutStarted = performance.now();
        const metadata = await renderer.webContents.executeJavaScript(
          `window.alderPublication.then(render => render(${JSON.stringify(input)}))`,
        );
        mark("publication.layout", performance.now() - layoutStarted);
        signal?.throwIfAborted();
        const pdfStarted = performance.now();
        const data = pdf
          ? await renderer.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              generateTaggedPDF: true,
              generateDocumentOutline: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            })
          : null;
        mark("publication.pdf", performance.now() - pdfStarted);
        signal?.throwIfAborted();
        return { metadata, data };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        if (!renderer.isDestroyed()) renderer.destroy();
      }
    });
  queue = work;
  return work;
}
