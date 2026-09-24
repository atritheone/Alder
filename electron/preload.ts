import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("alder", {
  filePath: (file: File) => webUtils.getPathForFile(file),
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
  version: "0.12.0",
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
