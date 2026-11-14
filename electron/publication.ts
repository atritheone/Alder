import { BrowserWindow } from "electron";

let queue: Promise<unknown> = Promise.resolve();

/** One detached renderer at a time bounds memory without blocking the visible
 * editor or its audio. Every job receives an already frozen semantic snapshot. */
export function renderPublicationPdf(
  input: unknown,
  preload: string,
  pdf = true,
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
      const cancel = () => { if (!renderer.isDestroyed()) renderer.destroy(); };
      signal?.addEventListener("abort", cancel, { once: true });
      renderer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      renderer.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      const timeout = setTimeout(() => {
        if (!renderer.isDestroyed()) renderer.destroy();
      }, 120000);
      try {
        await renderer.loadURL("alder://app/index.html?publication=1");
        signal?.throwIfAborted();
        const metadata = await renderer.webContents.executeJavaScript(
          `window.alderPublication.then(render => render(${JSON.stringify(input)}))`,
        );
        signal?.throwIfAborted();
        const data = pdf
          ? await renderer.webContents.printToPDF({
              preferCSSPageSize: true,
              printBackground: true,
              generateTaggedPDF: true,
              generateDocumentOutline: true,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
            })
          : null;
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
