import { app, dialog, shell } from "electron";
import path from "node:path";
import { dataDirectory } from "./platform";
import { requireIsolatedTestPaths } from "./testIsolation";

export const hiddenTestMode =
  process.argv.includes("--headless-test") ||
  process.argv.includes("--smoke-test");

/** Test renderers still have real layout, input and native menus, but cannot
 * surface a window or OS dialog. Tests must supply native-dialog responses
 * explicitly through the main-process API, using isolated fixture data. */
export function configureHiddenTests() {
  if (!hiddenTestMode) return;
  // Fail before the single-instance lock can activate the user's Alder.
  // Installed smoke verification has its own managed data/profile contract.
  if (process.argv.includes("--headless-test")) {
    try {
      requireIsolatedTestPaths(process.argv, process.env.ALDER_DATA_DIR, [
        path.join(app.getPath("appData"), app.getName()),
        path.join(app.getPath("appData"), "Alder"),
        dataDirectory(process.platform, {
          ...process.env,
          ALDER_DATA_DIR: undefined,
        }),
      ]);
    } catch (error) {
      console.error(String(error));
      process.exit(1);
    }
  }
  void app.whenReady().then(() => app.dock?.hide());
  app.on("browser-window-created", (_event, window) => {
    window.setSkipTaskbar(true);
    window.webContents.openDevTools = () => {};
    window.webContents.toggleDevTools = () => {};
    // Every Alder BrowserWindow is constructed with show:false in this mode.
    // Also protect against activation callbacks and older test helpers.
    for (const method of [
      "show",
      "showInactive",
      "focus",
      "maximize",
      "restore",
      "setFullScreen",
      "setKiosk",
    ] as const)
      window[method] = () => {};
  });
  const unexpected = (name: string) => {
    throw new Error(
      `Hidden test requested ${name}. Supply a fixture response through the main-process test API.`,
    );
  };
  dialog.showOpenDialog = async () => unexpected("an Open dialog");
  dialog.showSaveDialog = async () => unexpected("a Save dialog");
  dialog.showMessageBox = async () => unexpected("a message dialog");
  dialog.showOpenDialogSync = () => unexpected("an Open dialog");
  dialog.showSaveDialogSync = () => unexpected("a Save dialog");
  dialog.showMessageBoxSync = () => unexpected("a message dialog");
  dialog.showErrorBox = (title, message) =>
    console.error(`${title}: ${message}`);
  shell.showItemInFolder = () => unexpected("a file-manager window");
  shell.openPath = async () => unexpected("an external application");
  shell.openExternal = async () => unexpected("an external link");
}
