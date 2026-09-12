import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  session,
  clipboard,
  globalShortcut,
  Tray,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  window?.restore();
  window?.focus();
});
protocol.registerSchemesAsPrivileged([
  {
    scheme: "alder",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
let window: BrowserWindow | null = null,
  backend: ChildProcess | null = null,
  base = "",
  token = randomBytes(32).toString("hex"),
  log: fs.WriteStream | null = null;
let closeAllowed = false,
  closeInFlight = false;
const flushRequests = new Map<
  string,
  (value: { ok: boolean; message?: string }) => void
>();
const root = path.resolve(__dirname, "..");
const resources = app.isPackaged
  ? process.resourcesPath
  : path.join(root, "work", "bundle-resources");
const backendRoot = app.isPackaged
  ? path.join(resources, "backend")
  : path.join(root, "backend");
const appRoot = path.join(root, "dist");
const trusted = (event: Electron.IpcMainInvokeEvent) => {
  if (
    !event.senderFrame ||
    event.senderFrame.url.split("?")[0] !== "alder://app/index.html"
  )
    throw new Error("Untrusted application frame");
};
function apiPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/api/") ||
    /[\x00-\x1f\\]/.test(value) ||
    value.includes("..")
  )
    throw new Error("Invalid application request");
  return value;
}
async function request(method: string, p: string, body?: unknown) {
  if (!["GET", "POST", "PUT", "DELETE"].includes(method))
    throw new Error("Unsupported request");
  const response = await fetch(base + apiPath(p), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail || data),
    );
  return data;
}
const command = (name: string) =>
  window?.webContents.send("alder:command", name);
let readingTray: Tray | null = null;
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
  });
}
async function startBackend() {
  const python = path.join(resources, "python", "python.exe");
  if (!fs.existsSync(python))
    throw new Error(
      "Alder’s bundled language runtime is missing. Restore the complete Alder application folder.",
    );
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const data =
    process.env.ALDER_DATA_DIR ||
    path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "Alder");
  fs.mkdirSync(data, { recursive: true });
  log = fs.createWriteStream(path.join(data, "service.log"), { flags: "a" });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: backendRoot,
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    ALDER_DATA_DIR: data,
    ALDER_RESOURCES_DIR: resources,
    ALDER_PROJECT_ROOT: root,
    ALDER_SESSION_TOKEN: token,
  };
  delete env.PYTHONHOME;
  backend = spawn(
    python,
    ["-s", "-m", "alder", "--port", String(port), "--log-level", "warning"],
    {
      cwd: backendRoot,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend.stdout?.pipe(log);
  backend.stderr?.pipe(log);
  let failure = "";
  backend.on("error", (e) => {
    failure = e.message;
  });
  backend.on("exit", (code) => {
    failure = `Language service exited (${code}).`;
  });
  for (let i = 0; i < 200; i++) {
    if (failure) throw new Error(failure);
    try {
      const response = await request("GET", "/api/health");
      if (response.status) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    "The language service did not start. See service.log in Alder’s application data folder.",
  );
}
async function registerProtocols() {
  protocol.handle("alder", async (req) => {
    const url = new URL(req.url);
    if (url.hostname === "local") {
      try {
        const p = apiPath(url.pathname + url.search);
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        const range = req.headers.get("range");
        if (range) headers.Range = range;
        const response = await fetch(base + p, { headers });
        return new Response(response.body, {
          status: response.status,
          headers: {
            "Content-Type":
              response.headers.get("content-type") ||
              "application/octet-stream",
            "Access-Control-Allow-Origin": "alder://app",
            ...(response.headers.get("content-length")
              ? { "Content-Length": response.headers.get("content-length")! }
              : {}),
            "Accept-Ranges": "bytes",
            ...(response.headers.get("content-range")
              ? { "Content-Range": response.headers.get("content-range")! }
              : {}),
            "Content-Security-Policy":
              "default-src 'self' data: blob:; img-src 'self' data: blob: alder:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-ancestors alder://app",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    if (url.hostname !== "app")
      return new Response("Not found", { status: 404 });
    const relative =
      decodeURIComponent(
        url.pathname === "/" ? "index.html" : url.pathname,
      ).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(appRoot, relative);
    if (!file.startsWith(appRoot + path.sep))
      return new Response("Not found", { status: 404 });
    try {
      const response = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: alder:; media-src 'self' blob: alder:; frame-src alder://local; connect-src 'self' alder://local; object-src 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
function registerIPC() {
  ipcMain.handle("alder:clipboard-text", async (e) => {
    trusted(e);
    const text = await clipboard.readText();
    if (text.length > 2_000_000)
      throw new Error(
        "Clipboard text exceeds the two-million-character limit.",
      );
    return text;
  });
  ipcMain.on("alder:flush-response", (event, id, ok, message) => {
    if (event.sender === window?.webContents) {
      flushRequests.get(id)?.({ ok: Boolean(ok), message });
      flushRequests.delete(id);
    }
  });
  ipcMain.handle("alder:request", (e, method, p, body) => {
    trusted(e);
    return request(method, p, body);
  });
  ipcMain.handle("alder:upload", async (e, p, name, bytes, fields) => {
    trusted(e);
    if (!Array.isArray(bytes) || bytes.length > 100 * 1024 * 1024)
      throw new Error("File exceeds the 100 MB import limit");
    if (!/\/(import|assets|voices)$/.test(apiPath(p)))
      throw new Error("Unsupported upload destination");
    const form = new FormData();
    form.append(
      "file",
      new Blob([Uint8Array.from(bytes)]),
      path.basename(String(name)),
    );
    for (const [k, v] of Object.entries(fields || {})) {
      if (k === "name") form.append(k, String(v));
    }
    const response = await fetch(base + p, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : JSON.stringify(result.detail),
      );
    return result;
  });
  ipcMain.handle("alder:save-text", async (e, name, text) => {
    trusted(e);
    if (typeof text !== "string" || text.length > 2 * 1024 * 1024)
      throw new Error("Invalid text export.");
    const result = await dialog.showSaveDialog(window!, {
      title: "Save Alder rule pack",
      defaultPath: path.basename(String(name)),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.promises.writeFile(result.filePath, text, "utf8");
    return result.filePath;
  });
  ipcMain.handle("alder:save-path", async (e) => {
    trusted(e);
    const result = await dialog.showSaveDialog(window!, {
      title: "Save Alder project",
      defaultPath: "Untitled.alder",
      filters: [{ name: "Alder project", extensions: ["alder"] }],
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle("alder:open-path", async (e) => {
    trusted(e);
    const result = await dialog.showOpenDialog(window!, {
      title: "Open Alder project",
      filters: [{ name: "Alder project", extensions: ["alder"] }],
      properties: ["openFile"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("alder:download", async (e, p, name) => {
    trusted(e);
    const allowed = apiPath(p);
    if (!/\/(exports\/|definition|speech\/jobs\/)/.test(allowed))
      throw new Error("Unsupported export resource");
    const safeName = path.basename(String(name));
    const result = await dialog.showSaveDialog(window!, {
      title: "Save Alder output",
      defaultPath: safeName,
    });
    if (result.canceled || !result.filePath) return null;
    const response = await fetch(base + allowed, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Unable to read this output");
    const dest = result.filePath;
    const temporary = dest + ".alder-tmp";
    await fs.promises.writeFile(
      temporary,
      Buffer.from(await response.arrayBuffer()),
    );
    await fs.promises.rename(temporary, dest);
    return dest;
  });
}
function setMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "New project",
            accelerator: "CmdOrCtrl+N",
            click: () => command("new"),
          },
          {
            label: "Open project",
            accelerator: "CmdOrCtrl+O",
            click: () => command("open"),
          },
          {
            label: "Save project",
            accelerator: "CmdOrCtrl+S",
            click: () => command("save"),
          },
          { label: "Export", click: () => command("export") },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
        ],
      },
    ]),
  );
}
app.whenReady().then(async () => {
  try {
    await startBackend();
    await registerProtocols();
    registerIPC();
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    setMenu();
    window = new BrowserWindow({
      width: 1550,
      height: 980,
      minWidth: 900,
      minHeight: 680,
      backgroundColor: "#e6e6e6",
      title: "Alder",
      show:
        !process.argv.includes("--smoke-test") &&
        !process.argv.includes("--headless-test"),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    window.on("close", (event) => {
      if (!closeAllowed) {
        event.preventDefault();
        void closeApplication();
      }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== "alder://app/index.html") event.preventDefault();
    });
    await window.loadURL("alder://app/index.html");
    if (
      !process.argv.includes("--headless-test") &&
      !process.argv.includes("--smoke-test")
    ) {
      readingTray = new Tray(await app.getFileIcon(process.execPath));
      readingTray.setToolTip("Alder · document reading");
      readingTray.setContextMenu(
        Menu.buildFromTemplate([
          {
            label: "Show Alder",
            click: () => {
              window?.restore();
              window?.show();
              window?.focus();
            },
          },
          { label: "Read document", click: () => command("reading-read") },
          {
            label: "Pause / resume reading",
            click: () => command("reading-toggle"),
          },
          { label: "Stop reading", click: () => command("reading-stop") },
          { type: "separator" },
          { label: "Quit Alder", click: () => window?.close() },
        ]),
      );
      for (const [key, action] of [
        ["CommandOrControl+Alt+Space", "reading-toggle"],
        ["CommandOrControl+Alt+R", "reading-read"],
        ["CommandOrControl+Alt+S", "reading-stop"],
      ])
        if (!globalShortcut.register(key, () => command(action)))
          console.warn(`Reading shortcut unavailable: ${key}`);
    }
    if (process.argv.includes("--smoke-test")) {
      await new Promise((r) => setTimeout(r, 4000));
      const text = await window.webContents.executeJavaScript(
        "document.body.innerText",
      );
      const result = {
        ok:
          text.includes("Alder") &&
          text.includes("New") &&
          text.includes("Open"),
        title: window.getTitle(),
        text: text.slice(0, 1000),
        resources,
        python: path.join(resources, "python", "python.exe"),
      };
      fs.writeFileSync(
        process.env.ALDER_SMOKE_OUTPUT ||
          path.join(app.getPath("userData"), "smoke-result.json"),
        JSON.stringify(result, null, 2),
      );
      app.quit();
    }
  } catch (e) {
    if (process.argv.includes("--smoke-test")) {
      console.error(e);
      app.exit(1);
    } else {
      dialog.showErrorBox("Alder could not start", (e as Error).message);
      app.quit();
    }
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  readingTray?.destroy();
});
app.on("before-quit", (event) => {
  if (!closeAllowed) {
    event.preventDefault();
    void closeApplication();
  }
});
async function closeApplication() {
  if (closeInFlight || closeAllowed) return;
  closeInFlight = true;
  try {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      const id = randomBytes(12).toString("hex");
      const result = await new Promise<{ ok: boolean; message?: string }>(
        (resolve) => {
          const timeout = setTimeout(() => {
            flushRequests.delete(id);
            resolve({
              ok: false,
              message: "Saving did not finish before closing.",
            });
          }, 15000);
          flushRequests.set(id, (value) => {
            clearTimeout(timeout);
            resolve(value);
          });
          window!.webContents.send("alder:flush-request", id);
        },
      );
      if (!result.ok && !process.argv.includes("--smoke-test")) {
        const answer = await dialog.showMessageBox(window, {
          type: "warning",
          title: "Save before closing Alder",
          message: result.message || "Alder could not save the latest changes.",
          buttons: ["Return to Alder", "Close without saving"],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer.response === 0) {
          closeInFlight = false;
          return;
        }
      }
    }
    try {
      await fetch(base + "/api/lifecycle/shutdown", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch {}
    if (backend?.pid) {
      const pid = backend.pid;
      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn(
            path.join(
              process.env.SystemRoot || "C:/Windows",
              "System32",
              "taskkill.exe",
            ),
            ["/PID", String(pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.on("exit", () => resolve());
          killer.on("error", () => resolve());
        });
      } else backend.kill();
    }
    log?.end();
    closeAllowed = true;
    window?.destroy();
    app.quit();
  } catch (e) {
    console.error(e);
    closeInFlight = false;
  }
}
