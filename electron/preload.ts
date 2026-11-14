import { contextBridge, ipcRenderer, webUtils } from "electron";
import { version } from "../package.json";
let fileListener: ((paths: string[]) => void) | undefined;
const pendingFiles: string[] = [];
ipcRenderer.on("alder:open-files", (_event, paths: string[]) => {
  if (fileListener) fileListener(paths);
  else pendingFiles.push(...paths);
});
const commandListeners = new Set<(command: string) => void>();
const pendingCommands: string[] = [];
ipcRenderer.on("alder:command", (_event, command: string) => {
  if (commandListeners.size) for (const callback of commandListeners) callback(command);
  else pendingCommands.push(command);
});
contextBridge.exposeInMainWorld("alder", {
  ready: () => ipcRenderer.invoke("alder:ready"),
  performance: (event?: string, duration?: number) => ipcRenderer.invoke("alder:performance", event, duration),
  textWorkspaces: () => ipcRenderer.invoke("alder:text-workspaces"),
  chooseTextWorkspace: () => ipcRenderer.invoke("alder:choose-text-workspace"),
  scanTextWorkspace: (id: string, include: string, exclude: string) =>
    ipcRenderer.invoke("alder:scan-text-workspace", id, include, exclude),
  cancelTextWorkspace: (id: string) =>
    ipcRenderer.invoke("alder:cancel-text-workspace", id),
  readWorkspaceText: (id: string, relative: string) =>
    ipcRenderer.invoke("alder:read-workspace-text", id, relative),
  openWorkspaceText: (id: string, relative: string) =>
    ipcRenderer.invoke("alder:open-workspace-text", id, relative),
  bindWorkspaceText: (
    id: string,
    relative: string,
    targetId: string,
    digest: string,
  ) =>
    ipcRenderer.invoke(
      "alder:bind-workspace-text",
      id,
      relative,
      targetId,
      digest,
    ),
  prepareFolderReplacement: (id: string, plans: unknown) =>
    ipcRenderer.invoke("alder:prepare-folder-replacement", id, plans),
  commitFolderReplacement: (token: string) =>
    ipcRenderer.invoke("alder:commit-folder-replacement", token),
  restoreFolderReplacement: (token: string) =>
    ipcRenderer.invoke("alder:restore-folder-replacement", token),
  documentFileInfo: (id: string) =>
    ipcRenderer.invoke("alder:document-file-info", id),
  completeTextPath: (id: string, prefix: string) =>
    ipcRenderer.invoke("alder:complete-text-path", id, prefix),
  readDocumentFile: (id: string) =>
    ipcRenderer.invoke("alder:read-document-file", id),
  bindReopenedDocument: (sourceId: string, targetId: string, digest: string) =>
    ipcRenderer.invoke(
      "alder:bind-reopened-document",
      sourceId,
      targetId,
      digest,
    ),
  revealDocumentFile: (id: string) =>
    ipcRenderer.invoke("alder:reveal-document-file", id),
  printProof: (resource: string, name: string) =>
    ipcRenderer.invoke("alder:print-proof", resource, name),
  filePath: (file: File) => webUtils.getPathForFile(file),
  bindDocumentFile: (id: string, file: File, format: string, direct: boolean) =>
    ipcRenderer.invoke(
      "alder:bind-document-file",
      id,
      webUtils.getPathForFile(file),
      format,
      direct,
    ),
  saveDocument: (
    id: string,
    format: string,
    name: string,
    mode: "save" | "saveAs" | "copy",
  ) => ipcRenderer.invoke("alder:save-document", id, format, name, mode),
  setWindowLayout: (
    mode: "start" | "workspace",
    width?: number,
    height?: number,
  ) => ipcRenderer.invoke("alder:window-layout", mode, width, height),
  setNativeMenu: (menus: unknown, background?: string) =>
    ipcRenderer.invoke("alder:set-menu", menus, background),
  editCommand: (command: string) =>
    ipcRenderer.invoke("alder:edit-command", command),
  readClipboard: () => ipcRenderer.invoke("alder:clipboard-text"),
  writeClipboard: (text: string) =>
    ipcRenderer.invoke("alder:clipboard-write-text", text),
  readClipboardContent: () => ipcRenderer.invoke("alder:clipboard-content"),
  request: (method: string, path: string, body?: unknown, requestId?: string) =>
    ipcRenderer.invoke("alder:request", method, path, body, requestId),
  cancelRequest: (requestId: string) => ipcRenderer.invoke("alder:cancel-request", requestId),
  upload: (
    path: string,
    name: string,
    bytes: Uint8Array | number[],
    fields?: Record<string, string>,
  ) => ipcRenderer.invoke("alder:upload", path, name, bytes, fields),
  saveText: (name: string, text: string) =>
    ipcRenderer.invoke("alder:save-text", name, text),
  savePath: () => ipcRenderer.invoke("alder:save-path"),
  openPath: () => ipcRenderer.invoke("alder:open-path"),
  download: (path: string, name: string) =>
    ipcRenderer.invoke("alder:download", path, name),
  mediaBase: "alder://local",
  platform: process.platform,
  version,
  onOpenFiles: (callback: (paths: string[]) => void) => {
    fileListener = callback;
    queueMicrotask(() => { if (fileListener === callback && pendingFiles.length) callback(pendingFiles.splice(0)); });
    void ipcRenderer.invoke("alder:files-ready");
    return () => { if (fileListener === callback) fileListener = undefined; };
  },
  onCloseRequest: (callback: () => Promise<void>) => {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => {
      Promise.resolve(callback())
        .then(() => ipcRenderer.send("alder:flush-response", id, true))
        .catch((error) =>
          ipcRenderer.send(
            "alder:flush-response",
            id,
            false,
            String(error?.message || error),
          ),
        );
    };
    ipcRenderer.on("alder:flush-request", handler);
    return () => ipcRenderer.removeListener("alder:flush-request", handler);
  },
  onCommand: (callback: (command: string) => void) => {
    commandListeners.add(callback);
    queueMicrotask(() => {
      if (commandListeners.size) for (const command of pendingCommands.splice(0))
        for (const handler of commandListeners) handler(command);
    });
    return () => { commandListeners.delete(callback); };
  },
});
