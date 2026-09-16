import { describe, it, expect } from "vitest";
import { platformMenu } from "../../electron/platform";
import { shortcutLabel } from "./platform";
describe("platform menus", () => {
  it("places Mac app/window roles without a duplicate File quit command", () => {
    const menu: Electron.MenuItemConstructorOptions[] = [
      { label: "File", submenu: [{ label: "Save" }, { role: "quit" }] },
    ];
    const mac = platformMenu(menu, "darwin");
    expect(mac[0].role).toBe("appMenu");
    expect(mac.at(-1)?.role).toBe("windowMenu");
    expect(mac[1].submenu).toEqual([{ label: "Save" }]);
    expect(platformMenu(menu, "linux")).toBe(menu);
    expect(menu[0].submenu).toHaveLength(2);
  });
  it("shows the platform's modifier labels", () => {
    expect(shortcutLabel("Bold (Ctrl+B)", "darwin")).toBe("Bold (⌘+B)");
    expect(shortcutLabel("Ctrl+S", "linux")).toBe("Ctrl+S");
  });
});
