import path from "node:path";
import os from "node:os";
import layouts from "../backend/alder/runtime-layout.json";

export type Platform = keyof typeof layouts;
export function executable(root: string, name: keyof typeof layouts.win32, platform = process.platform) {
  if (!(platform in layouts)) throw new Error(`Unsupported Alder platform: ${platform}`);
  return path.join(root, layouts[platform as Platform][name]);
}
export function dataDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (env.ALDER_DATA_DIR) return path.resolve(env.ALDER_DATA_DIR);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData/Local"), "Alder");
  if (platform === "darwin") return path.join(home, "Library/Application Support/Alder");
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local/share"), "Alder");
}
export function platformMenu(template: Electron.MenuItemConstructorOptions[], platform = process.platform) {
  if (platform !== "darwin") return template;
  const groups = template.map(group => ({...group,
    submenu: Array.isArray(group.submenu) ? group.submenu.filter(item => item.role !== "quit") : group.submenu,
  }));
  return [{role: "appMenu" as const}, ...groups, {role: "windowMenu" as const}];
}
