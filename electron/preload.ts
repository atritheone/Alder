import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("alder", {
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
  version: "0.1.0",
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
