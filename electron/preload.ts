import { contextBridge, ipcRenderer, webUtils } from "electron";
import { version } from "../package.json";
contextBridge.exposeInMainWorld("alder", {
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
  request: (method: string, path: string, body?: unknown) =>
    ipcRenderer.invoke("alder:request", method, path, body),
  upload: (
    path: string,
    name: string,
    bytes: number[],
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
    const handler = (_event: Electron.IpcRendererEvent, paths: string[]) =>
      callback(paths);
    ipcRenderer.on("alder:open-files", handler);
    void ipcRenderer.invoke("alder:files-ready");
    return () => ipcRenderer.removeListener("alder:open-files", handler);
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
    const handler = (_event: Electron.IpcRendererEvent, command: string) =>
      callback(command);
    ipcRenderer.on("alder:command", handler);
    return () => ipcRenderer.removeListener("alder:command", handler);
  },
});
