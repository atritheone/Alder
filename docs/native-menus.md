# Desktop menus

Windows uses a small Node-API C++ module in `electron/native/windows-menu`.
It attaches a Win32 HMENU to the Electron HWND, so both the bar and dropdowns are
native Windows menus. Only the top bar labels/background use Win32 owner drawing
to blend with the adjoining Alder surface, without a bottom separator. Dropdowns
keep Windows painting and menu navigation. macOS retains Electron's native system menu; Linux retains
Electron's existing menu implementation. Renderer context menus are unchanged.

`electron/windows-menu.ts` translates the shared Electron Menu model, dispatches
WM_COMMAND to its existing click handlers/roles, and handles application shortcuts
and Alt/F10 navigation. Menu replacements wait until the native menu loop exits,
so an open menu cannot be freed while Windows is using it. Fullscreen detaches the
bar and restores it on exit. Window destruction and environment cleanup release
native resources. No native API is exposed to the sandboxed renderer.

`npm run build` compiles the module on Windows with the locked node-gyp and the
installed Electron version's headers and import library (including its delay-load
hook). Visual Studio Build Tools 2022 or newer, the C++ workload and a Windows SDK
are required. The build uses Alder's bundled Python when available. `start.cmd`
performs this build in its external testing workspace. The `.node` binary is copied
to `dist-electron` and explicitly unpacked from ASAR in packaged releases. Mac and
Linux builds skip it. There is no compiler requirement to run a packaged release.

Run `scripts/test-windows-menu-desktop.mjs` against an isolated Windows desktop
build to inspect the actual HMENU, exercise commands and shortcuts, and capture
the Alder window without reading the rest of the desktop. Native menu-loop checks
are opt-in with `ALDER_MENU_INTERACTIVE=1` on a dedicated foreground test desktop. The Python probe uses Win32 APIs only for
integration testing; runtime menu handling lives entirely in Electron's process.

Chromium retains ownership of client geometry (`WM_NCCALCSIZE`) so its renderer,
compositor and pointer coordinates agree. The native bridge only paints the menu
and its bottom edge. Painting is coalesced into one posted message after native
frame/menu updates; there is no timer or continuous repaint, and no forced frame
recalculation or changes to the client rectangle.

`scripts/test-menu-repaint-desktop.mjs` checks existing non-client pixels with
`GetPixel` after menu/frame redraws, resize, maximise/restore, show/hide, theme
updates and fullscreen, on both the start screen and workspace. It never uses
`WM_PRINT`/`PrintWindow` to validate the separator. For native menu open/close
coverage without interrupting the user's desktop, run the script through
`scripts/windows-test-desktop.py` with the Node executable and script path; the
helper creates a temporary desktop, enables `ALDER_MENU_INTERACTIVE`, and leaves
the user's desktop selected.

`scripts/test-window-geometry-desktop.mjs` launches the actual visible startup
path on that separate desktop. It compares renderer dimensions with the native
client rectangle, checks the start/form layout, and sends Windows client mouse
messages to exercise native hit coordinates on New, Cancel, document types,
Create and the workspace toolbar. This catches input-coordinate regressions that
renderer-only Playwright clicks miss.
