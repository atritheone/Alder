import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/** Display the exported PDF itself. The PDF viewer enables its print control
 * when its document is ready; printing its loading page can produce blank paper. */
export async function openPrintProof(
  parent: BrowserWindow,
  bytes: Buffer,
  name: string,
) {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")))
    throw new Error("The print proof is not a PDF document.");
  const directory = await fs.mkdtemp(
    path.join(app.getPath("temp"), "alder-print-"),
  );
  const pdf = path.join(directory, "document.pdf");
  const clean = async () => {
    await fs.unlink(pdf).catch(() => {});
    await fs.rmdir(directory).catch(() => {});
  };
  let proof: BrowserWindow | undefined;
  try {
    await fs.writeFile(pdf, bytes);
    proof = new BrowserWindow({
      parent,
      title: `Print — ${name}`,
      width: 1000,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#dadada",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    proof.setMenu(null);
    proof.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    proof.webContents.on("will-navigate", (event) => event.preventDefault());
    proof.on("page-title-updated", (event) => event.preventDefault());
    proof.on("closed", () => {
      void clean();
    });
    await proof.loadFile(pdf);
    proof.show();
    return { opened: true };
  } catch (error) {
    if (proof && !proof.isDestroyed()) proof.destroy();
    await clean();
    throw error;
  }
}
