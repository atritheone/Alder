import { BrowserWindow, Menu, type MenuItem, type Input } from "electron";
import path from "node:path";

type Entry = {
  id: number;
  label: string;
  enabled: boolean;
  checked: boolean;
  separator: boolean;
  radio: boolean;
  children?: Entry[];
};
type Bridge = {
  set: (handle: Buffer, entries: Entry[], background: number) => void;
  activate: (handle: Buffer, character: number) => void;
  visible: (handle: Buffer, visible: boolean) => void;
  dispose: (handle: Buffer) => void;
};
const WM_COMMAND = 0x111,
  WM_ENTERMENULOOP = 0x211,
  WM_EXITMENULOOP = 0x212;

function invoke(
  item: MenuItem,
  window: BrowserWindow,
  triggeredByAccelerator: boolean,
) {
  // Electron's constructed MenuItem.click is a dispatcher: event, window,
  // webContents. It invokes the public callback with its documented arguments.
  Reflect.apply(item.click, item, [
    { triggeredByAccelerator },
    window,
    window.webContents,
  ]);
}

/** Windows owns the visual menus; Electron's model still owns commands and roles. */
export class WindowsMenu {
  private bridge: Bridge;
  private handle: Buffer;
  private commands = new Map<number, MenuItem>();
  private accelerators: MenuItem[] = [];
  private pending: { menu: Menu; background: string } | null = null;
  private open = false;
  private altOnly = false;
  private closed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private window: BrowserWindow) {
    // Kept outside the JS bundle and unpacked from ASAR by electron-builder.
    this.bridge = require(
      path.join(__dirname, "alder_windows_menu.node"),
    ) as Bridge;
    this.handle = window.getNativeWindowHandle();
    window.hookWindowMessage(WM_COMMAND, (wp, lp) => {
      if (lp.some((byte) => byte !== 0)) return; // Ignore child-control notifications.
      const id = wp.readUInt32LE(0) & 0xffff;
      const item = this.commands.get(id);
      if (item?.enabled && item.visible) invoke(item, window, false);
    });
    window.hookWindowMessage(WM_ENTERMENULOOP, () => {
      this.open = true;
    });
    window.hookWindowMessage(WM_EXITMENULOOP, () => {
      // WM_COMMAND follows menu dismissal. Keep its old command mapping until it arrives.
      this.open = false;
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (!this.closed && this.pending) {
          const menu = this.pending;
          this.pending = null;
          this.set(menu.menu, menu.background);
        }
      }, 0);
    });
    window.webContents.on("before-input-event", this.onInput);
    window.on("enter-full-screen", () =>
      this.bridge.visible(this.handle, false),
    );
    window.on("leave-full-screen", () =>
      this.bridge.visible(this.handle, true),
    );
    window.on("closed", () => {
      this.closed = true;
      if (this.timer) clearTimeout(this.timer);
      this.commands.clear();
      this.pending = null;
    });
  }
  set(menu: Menu, background: string) {
    if (this.closed) return;
    if (this.open || this.timer) {
      this.pending = { menu, background };
      return;
    }
    const commands = new Map<number, MenuItem>();
    const accelerators: MenuItem[] = [];
    let id = 0x4000;
    const convert = (items: MenuItem[], top = false): Entry[] =>
      items
        .filter((item) => item.visible)
        .map((item) => {
          const commandId = id++;
          commands.set(commandId, item);
          const shortcut = item.accelerator;
          if (shortcut && item.enabled) accelerators.push(item);
          const label = top
            ? `&${item.label.replace(/&/g, "&&")}`
            : item.label.replace(/&/g, "&&");
          return {
            id: commandId,
            label:
              label +
              (shortcut
                ? `\t${shortcut.replace(/CommandOrControl|CmdOrCtrl|Control/g, "Ctrl")}`
                : ""),
            enabled: item.enabled,
            checked: item.checked,
            separator: item.type === "separator",
            radio: item.type === "radio",
            children: item.submenu ? convert(item.submenu.items) : undefined,
          };
        });
    const entries = convert(menu.items, true);
    // Retain the shared model for command inspection, but remove Chromium's visual bar.
    Menu.setApplicationMenu(menu);
    this.window.setMenu(null);
    this.bridge.set(this.handle, entries, parseInt(background.slice(1), 16));
    if (this.window.isFullScreen()) this.bridge.visible(this.handle, false);
    this.commands = commands;
    this.accelerators = accelerators;
  }
  private onInput = (event: Electron.Event, input: Input) => {
    if (input.key === "Alt") {
      if (input.type === "keyDown") this.altOnly = true;
      else if (this.altOnly) {
        event.preventDefault();
        this.bridge.activate(this.handle, 0);
        this.altOnly = false;
      }
      return;
    }
    if (input.type !== "keyDown") return;
    this.altOnly = false;
    if (
      (input.key === "F10" && !input.shift) ||
      (input.alt && !input.control && !input.meta && /^[a-z]$/i.test(input.key))
    ) {
      event.preventDefault();
      this.bridge.activate(
        this.handle,
        input.key === "F10" ? 0 : input.key.toLowerCase().charCodeAt(0),
      );
      return;
    }
    for (const item of this.accelerators) {
      if (!matches(item.accelerator!, input)) continue;
      event.preventDefault();
      invoke(item, this.window, true);
      return;
    }
  };
}
function matches(accelerator: string, input: Input) {
  const parts = accelerator
    .toLowerCase()
    .replace(/commandorcontrol|cmdorctrl|control/g, "ctrl")
    .split("+");
  const key = parts.pop()!;
  return (
    input.control === parts.includes("ctrl") &&
    input.alt === parts.includes("alt") &&
    input.shift ===
      (parts.includes("shift") ||
        (key === "plus" && input.key === "+" && input.shift)) &&
    !input.meta &&
    (input.key.toLowerCase() === key || (key === "plus" && input.key === "+"))
  );
}
