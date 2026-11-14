import { WindowsMenu } from "./windows-menu";
import { TextWorkspaces } from "./textWorkspaces";
import { openPrintProof } from "./printProof";
import { renderPublicationPdf } from "./publication";
import { RequestCancellation } from "./requestCancellation";
import {
  DocumentFiles,
  atomicDocumentWrite,
  type SaveMode,
} from "./documentFiles";
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
  nativeImage,
  screen,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executable, dataDirectory, platformMenu } from "./platform";
import { mark, performanceReport } from "./performance";
const cancellable = new RequestCancellation();

app.setAppUserModelId("org.alder.language");
if (process.platform === "linux")
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", (_event, argv) => {
  queueFiles(argv);
  void reopenWindow();
});
const pendingFiles: string[] = [];
let rendererReady = false;
app.on("open-file", (event, file) => {
  event.preventDefault();
  queueFiles([file]);
  if (app.isReady()) void reopenWindow();
});
function queueFiles(files: string[]) {
  pendingFiles.push(
    ...files.filter(
      (file) => path.isAbsolute(file) && file.toLowerCase().endsWith(".alder"),
    ),
  );
  sendFiles();
}
function sendFiles() {
  if (rendererReady && backendIsReady && window && !window.isDestroyed() && pendingFiles.length)
    window.webContents.send("alder:open-files", pendingFiles.splice(0));
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: "alder",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);
let windowsMenu: WindowsMenu | null = null;
let applicationMenu: Menu | null = null;
let applicationMenuBackground = "#e1e1e1";
let workspaceWindow = false;
let workspaceBounds: Electron.Rectangle | null = null;
function sizeWindow(mode: "start" | "workspace", width = 480, height = 342) {
  if (!window || window.isDestroyed()) return;
  const workspace = mode === "workspace";
  if (workspace && workspaceWindow) return;
  const previous = window.getBounds();
  if (!workspace && workspaceWindow) {
    workspaceBounds = window.getNormalBounds();
    if (window.isMaximized()) window.unmaximize();
  }
  workspaceWindow = workspace;
  window.setMinimumSize(workspace ? 900 : 480, workspace ? 680 : 300);
  if (window.isMaximized() || window.isFullScreen()) return;
  const area = screen.getDisplayMatching(previous).workArea;
  const content = window.getContentBounds();
  const desired = workspace
    ? (workspaceBounds ?? { width: 1550, height: 980 })
    : {
        width: width + previous.width - content.width,
        height: height + previous.height - content.height,
      };
  const w = Math.min(desired.width, area.width),
    h = Math.min(desired.height, area.height);
  window.setBounds({
    width: w,
    height: h,
    x: Math.max(
      area.x,
      Math.min(
        area.x + area.width - w,
        Math.round(previous.x + (previous.width - w) / 2),
      ),
    ),
    y: Math.max(
      area.y,
      Math.min(
        area.y + area.height - h,
        Math.round(previous.y + (previous.height - h) / 2),
      ),
    ),
  });
  if (workspace) window.maximize();
}
function installMenu(menu: Menu, background: string) {
  applicationMenu = menu;
  applicationMenuBackground = background;
  if (process.platform === "win32") {
    if (windowsMenu) windowsMenu.set(menu, background);
    else Menu.setApplicationMenu(null);
  } else Menu.setApplicationMenu(menu);
}
let window: BrowserWindow | null = null,
  backend: ChildProcess | null = null,
  base = "",
  token = randomBytes(32).toString("hex"),
  log: fs.WriteStream | null = null;
let closeAllowed = false,
  closeInFlight = false;
let quitting = false;
let reopening: Promise<void> | null = null;
let backendReady: Promise<void> | null = null;
let backendIsReady = false;
let startupAbort = new AbortController();
let initializing = true;
const flushRequests = new Map<
  string,
  (value: { ok: boolean; message?: string }) => void
>();
const root = path.resolve(__dirname, "..");
// A branded development executable still loads through Electron's default app.
const packaged = app.isPackaged && !process.defaultApp;
const resources = packaged
  ? process.resourcesPath
  : process.env.ALDER_RESOURCES_DIR ||
    path.join(root, "work", "bundle-resources");
const backendRoot = packaged
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
async function request(method: string, p: string, body?: unknown, signal?: AbortSignal) {
  if (p !== "/api/health") await startBackend();
  if (!["GET", "POST", "PUT", "DELETE"].includes(method))
    throw new Error("Unsupported request");
  const operation = (body as any)?.operationId;
  const encodeStarted = performance.now();
  const encoded = body ? JSON.stringify(body) : undefined;
  if (operation) mark('save.main-encode', performance.now()-encodeStarted, operation);
  const fetchStarted = performance.now();
  const response = await fetch(base + apiPath(p), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: encoded,
    signal,
  });
  if (operation) mark('save.main-fetch', performance.now()-fetchStarted, operation);
  const decodeStarted = performance.now();
  const data = await response.json();
  if (operation) mark('save.main-decode', performance.now()-decodeStarted, operation);
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
function startBackend(): Promise<void> {
  if (!backendReady && (quitting || closeInFlight)) return Promise.reject(new Error("Alder is closing."));
  return backendReady ??= launchBackend();
}
async function launchBackend() {
  const abort = startupAbort.signal;
  const python = executable(resources, "python");
  if (!fs.existsSync(python))
    throw new Error(
      "Alder’s bundled language runtime is missing. Restore the complete Alder application folder.",
    );
  const port = await freePort();
  abort.throwIfAborted();
  base = `http://127.0.0.1:${port}`;
  const data = dataDirectory();
  fs.mkdirSync(data, { recursive: true });
  log = fs.createWriteStream(path.join(data, "service.log"), { flags: "a" });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: backendRoot,
    PYTHONNOUSERSITE: "1",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUTF8: "1",
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
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  mark("backend.spawn");
  backend.stdout?.pipe(log);
  backend.stderr?.pipe(log);
  let failure = "";
  backend.on("error", (e) => {
    failure = e.message;
  });
  backend.on("exit", (code) => {
    failure = `Language service exited (${code}).`;
  });
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    abort.throwIfAborted();
    if (failure) throw new Error(failure);
    try {
      const signal = AbortSignal.any([abort, AbortSignal.timeout(Math.max(1, Math.min(750, Math.ceil(deadline - performance.now()))))]);
      const response = await request("GET", "/api/health", undefined, signal);
      if (response.status === "ok") {
        backendIsReady = true;
        mark("backend.ready");
        sendFiles();
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 40));
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
        await startBackend();
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' alder://local; img-src 'self' data: blob: alder:; media-src 'self' blob: alder:; frame-src alder://local; connect-src 'self' alder://local; object-src 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
function registerIPC() {
  ipcMain.handle("alder:ready", async (event) => {
    trusted(event);
    await startBackend();
    return { ready: true };
  });
  ipcMain.handle("alder:performance", (event, name?: string, duration?: number) => {
    trusted(event);
    if (name) mark(name, duration);
    return performanceReport();
  });
  ipcMain.handle(
    "alder:window-layout",
    (event, mode: unknown, width = 480, height = 342) => {
      trusted(event);
      if (
        (mode !== "start" && mode !== "workspace") ||
        !Number.isFinite(width) ||
        !Number.isFinite(height)
      )
        throw new Error("Invalid window layout");
      sizeWindow(
        mode,
        Math.max(480, Math.min(2000, Math.ceil(width))),
        Math.max(300, Math.min(1600, Math.ceil(height))),
      );
    },
  );

  ipcMain.handle("alder:files-ready", (event) => {
    trusted(event);
    rendererReady = true;
    sendFiles();
  });
  ipcMain.handle(
    "alder:set-menu",
    (event, menus: unknown, background = "#909090") => {
      if (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background))
        throw new Error("Invalid menu background");
      trusted(event);
      if (menus === null) {
        setMenu();
        return;
      }
      if (!Array.isArray(menus) || menus.length > 12)
        throw new Error("Invalid menu");
      const template: Electron.MenuItemConstructorOptions[] = menus.map(
        (group) => {
          if (
            typeof group.label !== "string" ||
            group.label.length > 50 ||
            !Array.isArray(group.items) ||
            group.items.length > 60
          )
            throw new Error("Invalid menu group");
          const buildItems = (
            items: unknown[],
            depth = 0,
          ): Electron.MenuItemConstructorOptions[] =>
            items.map((value) => {
              if (!value || typeof value !== "object" || depth > 3)
                throw new Error("Invalid menu item");
              const item = value as {
                id: string;
                label: string;
                checked?: boolean;
                submenu?: unknown[];
              };
              if (
                typeof item.label !== "string" ||
                item.label.length > 120 ||
                typeof item.id !== "string" ||
                !/^native:[A-Za-z]+:\d+(?::\d+){0,3}$/.test(item.id) ||
                (item.checked !== undefined &&
                  typeof item.checked !== "boolean")
              )
                throw new Error("Invalid menu item");
              if (item.submenu !== undefined) {
                if (!Array.isArray(item.submenu) || item.submenu.length > 60)
                  throw new Error("Invalid submenu");
                return {
                  label: item.label,
                  submenu: buildItems(item.submenu, depth + 1),
                };
              }
              const accelerator = item.label.startsWith("New Project")
                ? "CmdOrCtrl+N"
                : item.label.startsWith("Open Document")
                  ? "CmdOrCtrl+O"
                  : item.label === "Close Document"
                    ? "CmdOrCtrl+W"
                    : /^Save (Document|Project)/.test(item.label)
                      ? "CmdOrCtrl+S"
                      : item.label === "Save As…"
                        ? "CmdOrCtrl+Shift+S"
                        : item.label.startsWith("Find And Replace")
                          ? "CmdOrCtrl+F"
                          : item.label === "Settings…"
                            ? "CmdOrCtrl+,"
                            : item.label === "Print…"
                              ? "CmdOrCtrl+P"
                              : undefined;
              return {
                label: item.label,
                type: item.checked === undefined ? "normal" : "radio",
                checked: item.checked,
                accelerator,
                click: () => command(item.id),
              };
            });
          const submenu = buildItems(group.items);
          if (group.label === "File")
            submenu.push({ type: "separator" }, { role: "quit" });
          if (group.label === "Edit")
            submenu.push(
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            );
          if (group.label === "View")
            submenu.push({ type: "separator" }, { role: "togglefullscreen" });
          return { label: group.label, submenu };
        },
      );
      installMenu(Menu.buildFromTemplate(platformMenu(template)), background);
      if (process.platform !== "win32") window?.setMenuBarVisibility(true);
    },
  );
  ipcMain.handle("alder:edit-command", (event, command: string) => {
    trusted(event);
    switch (command) {
      case "undo":
        event.sender.undo();
        break;
      case "redo":
        event.sender.redo();
        break;
      case "cut":
        event.sender.cut();
        break;
      case "copy":
        event.sender.copy();
        break;
      case "paste":
        event.sender.paste();
        break;
      case "selectAll":
        event.sender.selectAll();
        break;
      default:
        throw new Error("Unsupported editing command.");
    }
  });
  ipcMain.handle("alder:clipboard-text", async (e) => {
    trusted(e);
    const text = await clipboard.readText();
    if (text.length > 2_000_000)
      throw new Error(
        "Clipboard text exceeds the two-million-character limit.",
      );
    return text;
  });
  ipcMain.handle("alder:clipboard-write-text", async (event, text) => {
    trusted(event);
    if (typeof text !== "string" || text.length > 2_000_000)
      throw new Error(
        "Clipboard text exceeds the two-million-character limit.",
      );
    await clipboard.writeText(text);
  });
  ipcMain.on("alder:flush-response", (event, id, ok, message) => {
    if (event.sender === window?.webContents) {
      flushRequests.get(id)?.({ ok: Boolean(ok), message });
      flushRequests.delete(id);
    }
  });
  const publicationRequest = async (method:string,p:string,body:any,signal?:AbortSignal) => {
    signal?.throwIfAborted();
    const fieldsOnly = /^\/api\/projects\/[^/?#]+\/layout-fields$/.test(p);
    const word = /^\/api\/projects\/[^/?#]+\/export(?:-jobs)?$/.test(p) && body?.format === 'docx';
    if (
      method === "POST" &&
      (fieldsOnly || word ||
        (/^\/api\/projects\/[^/?#]+\/export$/.test(p) &&
          (body?.format === "pdf" || word)))
    ) {
      const snapshot = await request(
        "POST",
        p.replace(/\/(?:export(?:-jobs)?|layout-fields)$/, "/publication-layout"),
        {
          options: word ? {...body.options,reviewView:body.options?.reviewView==='original'?'original':'final',measureMoveSources:!body.options?.reviewView||body.options.reviewView==='markup'} : body.options,
          ...(word ? {ephemeral:true} : {}),
          ...(fieldsOnly ? { project: body.project, ephemeral: true } : {}),
        },
        signal,
      );
      if (!fieldsOnly && body?.expectedRevision != null && body.expectedRevision !== snapshot.sourceRevision)
        throw Error('The document changed during export preparation. Export the current version again.');
      if(word){
        const needsWordLayout=(node:any):boolean=>(node.type==='table_row'&&!node.attrs?.allowSplit)||node.type==='text_box'||node.type==='equation'||node.type==='shape'||node.type==='document_note'||!!node.content?.some(needsWordLayout);
        if(!needsWordLayout(snapshot.document))return request(method,p,{...body,expectedRevision:snapshot.sourceRevision,options:{...body.options,measuredRowSplits:[]}});
      }
      const rendered = await renderPublicationPdf(
        snapshot,
        path.join(__dirname, "preload.cjs"),
        !fieldsOnly && !word,
        signal,
      );
      if (fieldsOnly) return rendered.metadata.referenceValues;
      if(word){
        const rows=new Set<string>(rendered.metadata.overflowingRows||[]);
        const boxes={...rendered.metadata.textBoxes};
        let mixedNoteGeometry=!!rendered.metadata.mixedNoteGeometry;
        if(Object.keys(snapshot.moveSourceIds||{}).length){
          // Source copies can have different available widths and page frames.
          // Measure the original view; never reuse the destination's geometry.
          const original=await request('POST',p.replace(/\/export(?:-jobs)?$/, '/publication-layout'),{options:{...body.options,reviewView:'original'},ephemeral:true});
          if(original.sourceRevision!==snapshot.sourceRevision)throw Error('The document changed during layout. Export again from the current document.');
          const measured=await renderPublicationPdf(original,path.join(__dirname,'preload.cjs'),false);
          const originalRows=new Set<string>(measured.metadata.overflowingRows||[]);
          for(const [source,target] of Object.entries(snapshot.moveSourceIds) as [string,string][]){
            if(measured.metadata.textBoxes?.[target])boxes[source]=measured.metadata.textBoxes[target];
            if(originalRows.has(target))rows.add(source);
          }
          mixedNoteGeometry ||= !!measured.metadata.mixedNoteGeometry;
        }
        return request(method,p,{...body,expectedRevision:snapshot.sourceRevision,options:{...body.options,measuredRowSplits:[...rows],measuredTextBoxes:boxes,measuredNoteGeometry:mixedNoteGeometry}});
      }
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(rendered.data!)], { type: "application/pdf" }),
        "publication.pdf",
      );
      form.append("metadata", JSON.stringify(rendered.metadata));
      const response = await fetch(
        base + `/api/exports/${snapshot.id}/rendered-pdf`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
          signal,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.detail === "string"
            ? result.detail
            : "The generated PDF could not be verified.",
        );
      return result;
    }
    const result = await request(method, p, body, signal);
    if (
      method === "POST" &&
      p === "/api/projects/open" &&
      result?.id &&
      typeof body?.path === "string"
    )
      await documentFiles.bind(result.id, body.path, "alder", true);
    return result;
  };
  ipcMain.handle("alder:cancel-request", (e,id) => {
    trusted(e);
    if (typeof id === "string") cancellable.cancel(id);
  });
  ipcMain.handle("alder:request", async (e,method,p,body,id) => {
    trusted(e);
    const owned = id === undefined ? undefined : cancellable.begin(id, method, apiPath(p), body);
    try { return await publicationRequest(method,p,body,owned?.signal); }
    finally { owned?.finish(); }
  });
  ipcMain.handle("alder:upload", async (e, p, name, bytes, fields) => {
    trusted(e);
    await startBackend();
    // Retain the legacy array bridge for existing integrations; normal file
    // opening uses one binary IPC payload on every OS.
    if (Array.isArray(bytes) && bytes.length <= 100 * 1024 * 1024 && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) bytes = Uint8Array.from(bytes);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 100 * 1024 * 1024)
      throw new Error("File exceeds the 100 MB import limit");
    const destination = apiPath(p);
    if (
      destination !== "/api/projects/open-file" &&
      !/\/(import|assets|voices)$/.test(destination) &&
      !/^\/api\/projects\/[A-Za-z0-9_.-]+\/txt-reopen\?encoding=(?:utf-8|utf-16-le|utf-16-be|cp1252)$/.test(
        destination,
      ) &&
      !/^\/api\/projects\/[A-Za-z0-9_.-]+\/assets\?register=false$/.test(
        destination,
      )
    )
      throw new Error("Unsupported upload destination");
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes as Uint8Array<ArrayBuffer>]),
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
  const documentFiles = new DocumentFiles(
    path.join(app.getPath("userData"), "document-files.json"),
  );
  const textWorkspaces = new TextWorkspaces(
    path.join(app.getPath("userData"), "text-workspaces.json"),
    path.join(dataDirectory(), "backups", "text-replacements"),
    (bytes, sourceDigest, edits) =>
      request("POST", "/api/text-files/prepare-replacement", {
        sourceBytes: bytes.toString("base64"),
        sourceDigest,
        edits,
      }),
  );
  ipcMain.handle("alder:text-workspaces", async (event) => {
    trusted(event);
    return textWorkspaces.list();
  });
  ipcMain.handle("alder:choose-text-workspace", async (event) => {
    trusted(event);
    const chosen = await dialog.showOpenDialog(window!, {
      title: "Choose text folder workspace",
      properties: ["openDirectory"],
    });
    return chosen.canceled || !chosen.filePaths[0]
      ? null
      : textWorkspaces.register(chosen.filePaths[0]);
  });
  ipcMain.handle(
    "alder:scan-text-workspace",
    async (event, id, include, exclude) => {
      trusted(event);
      return textWorkspaces.scan(
        String(id),
        String(include || "*.txt"),
        String(exclude || ".git/**;node_modules/**;.venv/**"),
      );
    },
  );
  ipcMain.handle("alder:cancel-text-workspace", async (event, id) => {
    trusted(event);
    textWorkspaces.cancel(String(id));
  });
  ipcMain.handle("alder:read-workspace-text", async (event, id, relative) => {
    trusted(event);
    return textWorkspaces.read(String(id), String(relative));
  });
  ipcMain.handle("alder:open-workspace-text", async (event, id, relative) => {
    trusted(event);
    return textWorkspaces.fileForOpen(String(id), String(relative));
  });
  ipcMain.handle(
    "alder:bind-workspace-text",
    async (event, id, relative, targetId, digest) => {
      trusted(event);
      const filename = await textWorkspaces.pathForBinding(
        String(id),
        String(relative),
        String(digest),
      );
      await documentFiles.bind(
        String(targetId),
        filename,
        "txt",
        true,
        String(digest),
      );
    },
  );
  ipcMain.handle(
    "alder:prepare-folder-replacement",
    async (event, id, plans) => {
      trusted(event);
      return textWorkspaces.prepare(String(id), plans);
    },
  );
  ipcMain.handle("alder:commit-folder-replacement", async (event, token) => {
    trusted(event);
    return textWorkspaces.commit(String(token));
  });
  ipcMain.handle("alder:restore-folder-replacement", async (event, token) => {
    trusted(event);
    return textWorkspaces.restore(String(token));
  });
  ipcMain.handle("alder:clipboard-content", async (event) => {
    trusted(event);
    const contents = { text: "", html: "" };
    for (const item of await clipboard.read()) {
      for (const [type, key] of [
        ["text/plain", "text"],
        ["text/html", "html"],
      ] as const) {
        if (!item.types.includes(type) || contents[key]) continue;
        const blob = (await item.getType(type)) as Blob;
        if (blob.size > 8_000_000)
          throw new Error(
            "Clipboard content exceeds the eight-megabyte limit.",
          );
        contents[key] = await blob.text();
      }
    }
    return contents;
  });
  let savingDocument = false;
  ipcMain.handle("alder:document-file-info", async (event, id) => {
    trusted(event);
    return documentFiles.info(String(id));
  });
  ipcMain.handle("alder:complete-text-path", async (event, id, prefix) => {
    trusted(event);
    if (
      typeof prefix !== "string" ||
      prefix.length > 4096 ||
      prefix.includes("\0")
    )
      throw new Error("Invalid path prefix.");
    const bound = await documentFiles.pathFor(String(id)),
      base = bound ? path.dirname(bound) : null;
    if (!path.isAbsolute(prefix) && !base) return [];
    const separator = Math.max(
        prefix.lastIndexOf("/"),
        prefix.lastIndexOf("\\"),
      ),
      parentPrefix = prefix.slice(0, separator + 1),
      partial = prefix.slice(separator + 1);
    const directory = path.isAbsolute(prefix)
      ? /[\\/]$/.test(prefix)
        ? path.resolve(prefix)
        : path.dirname(prefix)
      : path.resolve(base!, parentPrefix || ".");
    try {
      return (await fs.promises.readdir(directory, { withFileTypes: true }))
        .filter((entry) =>
          process.platform === "win32"
            ? entry.name.toLowerCase().startsWith(partial.toLowerCase())
            : entry.name.startsWith(partial),
        )
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) ||
            a.name.localeCompare(b.name),
        )
        .slice(0, 200)
        .map((entry) => ({
          label:
            parentPrefix + entry.name + (entry.isDirectory() ? path.sep : ""),
          directory: entry.isDirectory(),
        }));
    } catch {
      return [];
    }
  });
  ipcMain.handle("alder:read-document-file", async (event, id) => {
    trusted(event);
    return documentFiles.readTextFile(String(id));
  });
  ipcMain.handle(
    "alder:bind-reopened-document",
    async (event, sourceId, targetId, digest) => {
      trusted(event);
      await documentFiles.bindReopened(
        String(sourceId),
        String(targetId),
        String(digest),
      );
    },
  );
  ipcMain.handle("alder:reveal-document-file", async (event, id) => {
    trusted(event);
    const info = await documentFiles.info(String(id));
    if (info) shell.showItemInFolder(info.path);
  });
  ipcMain.handle(
    "alder:bind-document-file",
    async (e, id, filename, format, direct) => {
      trusted(e);
      if (!["txt", "md", "docx", "odt", "rtf", "alder"].includes(format)) return;
      await documentFiles.bind(
        String(id),
        String(filename),
        format,
        Boolean(direct),
      );
    },
  );
  ipcMain.handle(
    "alder:save-document",
    async (e, id, requestedFormat, name, mode: SaveMode = "save") => {
      trusted(e);
      if (
        !/^[\w.-]+$/.test(id) ||
        !["txt", "md", "docx", "odt", "rtf", "alder"].includes(requestedFormat) ||
        !["save", "saveAs", "copy"].includes(mode)
      )
        throw new Error("Invalid document save request.");
      if (savingDocument) return null;
      savingDocument = true;
      try {
        const format = await documentFiles.formatFor(id, requestedFormat);
        const destination = await documentFiles.destination(
          id,
          format,
          mode,
          async (suggested) => {
            const result = await dialog.showSaveDialog(window!, {
              title: mode === "copy" ? "Save a Copy" : "Save As",
              defaultPath:
                suggested || `${path.basename(String(name))}.${format}`,
              filters: [
                {
                  name:
                    format === "alder"
                      ? "Alder project"
                      : `${format.toUpperCase()} document`,
                  extensions: [format],
                },
              ],
            });
            return result.canceled ? null : result.filePath || null;
          },
        );
        if (!destination) return null;
        let written = destination;
        if (format === "alder") {
          await documentFiles.assertUnchanged(id, destination, mode);
          const result = await request("POST", `/api/projects/${id}/save`, {
            path: destination,
          });
          written = result.path;
        } else {
          const result = await publicationRequest("POST", `/api/projects/${id}/export`, {
            format,
          });
          if (result.warnings?.length) {
            const answer = await dialog.showMessageBox(window!, {
              type: "warning",
              title: "Save document",
              message: "This format cannot retain all document features.",
              detail: result.warnings.join("\n"),
              buttons: ["Cancel", "Save"],
              defaultId: 0,
              cancelId: 0,
            });
            if (answer.response !== 1) return null;
          }
          const response = await fetch(base + apiPath(result.downloadUrl), {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!response.ok)
            throw new Error("Unable to prepare the saved document.");
          const bytes = Buffer.from(await response.arrayBuffer());
          await documentFiles.assertUnchanged(id, destination, mode);
          await atomicDocumentWrite(destination, bytes);
        }
        await documentFiles.written(id, written, format, mode);
        return written;
      } finally {
        savingDocument = false;
      }
    },
  );
  ipcMain.handle("alder:print-proof", async (event, resource, name) => {
    trusted(event);
    if (
      typeof resource !== "string" ||
      !/^\/api\/exports\/export_[a-f0-9]{32}$/.test(resource)
    )
      throw new Error("Invalid print proof.");
    const response = await fetch(base + resource, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Unable to load the print proof.");
    return openPrintProof(
      window!,
      Buffer.from(await response.arrayBuffer()),
      String(name || "Alder document").slice(0, 200),
    );
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
  installMenu(
    Menu.buildFromTemplate(
      platformMenu([
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
            { type: "separator" },
            {
              label: "Settings…",
              accelerator: "CmdOrCtrl+,",
              click: () => command("settings"),
            },
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
            ...(!packaged ? [{ role: "toggleDevTools" as const }] : []),
          ],
        },
      ]),
    ),
    "#e1e1e1",
  );
}
async function createWindow() {
  rendererReady = false;
  setMenu();
  const appIcon = nativeImage.createFromPath(
    path.join(appRoot, "branding", "alder-icon.png"),
  );
  if (appIcon.isEmpty())
    throw new Error(
      "The Alder application icon is missing. Rebuild the application.",
    );
  workspaceWindow = false;
  window = new BrowserWindow({
    icon: appIcon,
    width: 480,
    height: 342,
    useContentSize: true,
    minWidth: 480,
    minHeight: 300,
    backgroundColor: "#e1e1e1",
    title: "Alder",
    show:
      !process.argv.includes("--smoke-test") &&
      !process.argv.includes("--headless-test"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Word highlighting follows the audio clock even when reading in the background.
      backgroundThrottling: false,
    },
  });
  mark("window.created");
  window.once("show", () => mark("window.shown"));
  window.webContents.once("dom-ready", () => mark("renderer.dom-ready"));
  if (process.platform === "win32") {
    windowsMenu = new WindowsMenu(window);
    if (applicationMenu)
      windowsMenu.set(applicationMenu, applicationMenuBackground);
  }
  window.on("close", (event) => {
    if (!closeAllowed) {
      event.preventDefault();
      void closeApplication(process.platform !== "darwin");
    }
  });
  window.on("closed", () => {
    cancellable.dispose();
    windowsMenu = null;
    window = null;
    rendererReady = false;
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
    for (const [key, action] of [
      ["CommandOrControl+Alt+Space", "reading-toggle"],
      ["CommandOrControl+Alt+R", "reading-read"],
      ["CommandOrControl+Alt+S", "reading-stop"],
    ])
      if (!globalShortcut.register(key, () => command(action)))
        console.warn(`Reading shortcut unavailable: ${key}`);
  }
  if (process.argv.includes("--smoke-test")) {
    await startBackend();
    await new Promise((r) => setTimeout(r, 4000));
    const text = await window.webContents.executeJavaScript(
      "document.body.innerText",
    );
    const result = {
      version: app.getVersion(),
      backendVersion: (await request("GET", "/api/health")).version,
      ok:
        text.includes("Alder") && text.includes("New") && text.includes("Open"),
      title: window.getTitle(),
      text: text.slice(0, 1000),
      resources,
      python: executable(resources, "python"),
    };
    fs.writeFileSync(
      process.env.ALDER_SMOKE_OUTPUT ||
        path.join(app.getPath("userData"), "smoke-result.json"),
      JSON.stringify(result, null, 2),
    );
    app.quit();
  }
}
app.whenReady().then(async () => {
  mark("electron.ready");
  try {
    await registerProtocols();
    registerIPC();
    session.defaultSession.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    queueFiles(process.argv);
    await Promise.all([startBackend(), createWindow()]);
  } catch (e) {
    if (quitting || closeInFlight) return;
    if (process.argv.includes("--smoke-test")) {
      console.error(e);
      app.exit(1);
    } else {
      dialog.showErrorBox("Alder could not start", (e as Error).message);
      app.quit();
    }
  } finally {
    initializing = false;
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  void reopenWindow();
});
async function reopenWindow() {
  if (!app.isReady() || initializing || closeInFlight || quitting) return;
  if (window && !window.isDestroyed()) {
    window.show();
    window.restore();
    window.focus();
    sendFiles();
    return;
  }
  if (!reopening)
    reopening = (async () => {
      await Promise.all([startBackend(), createWindow()]);
    })()
      .catch((error) => {
        dialog.showErrorBox("Alder could not reopen", String(error));
        app.quit();
      })
      .finally(() => {
        reopening = null;
      });
  await reopening;
}
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
app.on("before-quit", (event) => {
  if (!closeAllowed) {
    event.preventDefault();
    void closeApplication();
  }
});
async function closeApplication(quit = true) {
  quitting ||= quit;
  if (closeInFlight || closeAllowed) return;
  closeInFlight = true;
  try {
    if (rendererReady && window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
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
          quitting = false;
          return;
        }
      }
    }
    startupAbort.abort();
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
      } else {
        // The backend owns a separate process group, including speech/converters.
        // Never signal Alder's or the launching terminal's process group.
        try {
          process.kill(-pid, "SIGTERM");
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
    }
    log?.end();
    backend = null;
    backendReady = null;
    backendIsReady = false;
    startupAbort = new AbortController();
    globalShortcut.unregisterAll();
    closeAllowed = true;
    window?.destroy();
    if (quitting) app.quit();
    else {
      closeAllowed = false;
      closeInFlight = false;
      setMenu();
    }
  } catch (e) {
    console.error(e);
    closeInFlight = false;
  }
}
