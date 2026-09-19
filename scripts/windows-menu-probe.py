"""Native-window probes for the isolated desktop menu test (Windows only)."""
import ctypes as c
from ctypes import wintypes as w
import json
import sys

u = c.WinDLL('user32', use_last_error=True)
u.SetProcessDPIAware()
u.GetMenu.argtypes = [w.HWND]; u.GetMenu.restype = w.HMENU
u.GetSubMenu.argtypes = [w.HMENU, c.c_int]; u.GetSubMenu.restype = w.HMENU
u.GetMenuItemID.argtypes = [w.HMENU, c.c_int]; u.GetMenuItemID.restype = w.UINT
u.GetMenuItemCount.argtypes = [w.HMENU]; u.GetMenuItemCount.restype = c.c_int
u.GetMenuStringW.argtypes = [w.HMENU, w.UINT, w.LPWSTR, c.c_int, w.UINT]
u.GetMenuItemRect.argtypes = [w.HWND, w.HMENU, w.UINT, c.POINTER(w.RECT)]
u.GetMenuState.argtypes = [w.HMENU, w.UINT, w.UINT]; u.GetMenuState.restype = w.UINT
u.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
u.GetWindowRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
u.GetClientRect.argtypes = [w.HWND, c.POINTER(w.RECT)]
u.ClientToScreen.argtypes = [w.HWND, c.POINTER(w.POINT)]
u.GetGUIThreadInfo.argtypes = [w.DWORD, c.c_void_p]
u.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]; u.GetWindowThreadProcessId.restype = w.DWORD
class GUI(c.Structure):
    _fields_ = [('cbSize', w.DWORD), ('flags', w.DWORD), ('active', w.HWND), ('focus', w.HWND), ('capture', w.HWND), ('owner', w.HWND), ('move', w.HWND), ('caret', w.HWND), ('rect', w.RECT)]
class MENUINFO(c.Structure):
    _fields_ = [('cbSize',w.DWORD),('fMask',w.DWORD),('dwStyle',w.DWORD),('cyMax',w.UINT),('hbrBack',w.HBRUSH),('dwContextHelpID',w.DWORD),('dwMenuData',c.c_size_t)]
u.GetMenuInfo.argtypes = [w.HMENU,c.POINTER(MENUINFO)]
gdi = c.WinDLL('gdi32')
def color(hwnd):
    info=MENUINFO(); info.cbSize=c.sizeof(info); info.fMask=2
    if u.GetMenuInfo(u.GetMenu(hwnd),c.byref(info)):
        return info.hbrBack
    return None

def walk(hwnd, menu):
    result = []
    for i in range(u.GetMenuItemCount(menu)):
        text = c.create_unicode_buffer(512)
        u.GetMenuStringW(menu, i, text, 512, 0x400)
        rect = w.RECT(); u.GetMenuItemRect(hwnd, menu, i, c.byref(rect))
        sub = u.GetSubMenu(menu, i)
        result.append(dict(label=text.value, id=u.GetMenuItemID(menu, i), state=u.GetMenuState(menu, i, 0x400), rect=[rect.left, rect.top, rect.right, rect.bottom], children=walk(hwnd, sub) if sub else []))
    return result
hwnd = int(sys.argv[1]); action = sys.argv[2]
if action == 'inspect':
    gui = GUI(); gui.cbSize = c.sizeof(gui)
    u.GetGUIThreadInfo(u.GetWindowThreadProcessId(hwnd, None), c.byref(gui))
    client = w.RECT(); u.GetClientRect(hwnd, c.byref(client))
    origin = w.POINT(); u.ClientToScreen(hwnd, c.byref(origin))
    print(json.dumps(dict(menu=walk(hwnd, u.GetMenu(hwnd)), background=color(hwnd), flags=gui.flags, client=[origin.x, origin.y, client.right, client.bottom])))
elif action == 'command':
    u.PostMessageW(hwnd, 0x111, int(sys.argv[3]), 0)
elif action == 'open':
    u.PostMessageW(hwnd, 0x112, 0xf100, ord(sys.argv[3]))
elif action == 'close':
    u.PostMessageW(hwnd, 0x1f, 0, 0)  # WM_CANCELMODE exits the native menu loop.
elif action == 'client-click':
    # Native client coordinates exercise Chromium's Windows input transform,
    # unlike Playwright clicks which bypass the native HWND coordinate path.
    x, y = int(sys.argv[3]), int(sys.argv[4])
    position = (y & 0xffff) << 16 | (x & 0xffff)
    u.PostMessageW(hwnd, 0x200, 0, position)
    u.PostMessageW(hwnd, 0x201, 1, position)
    u.PostMessageW(hwnd, 0x202, 0, position)
elif action == 'surface':
    # Read existing window pixels; never send WM_PRINT or request a redraw here.
    u.GetWindowDC.argtypes = [w.HWND]; u.GetWindowDC.restype = w.HDC
    u.ReleaseDC.argtypes = [w.HWND, w.HDC]
    gdi.GetPixel.argtypes = [w.HDC, c.c_int, c.c_int]; gdi.GetPixel.restype = w.DWORD
    bounds = w.RECT(); u.GetWindowRect(hwnd, c.byref(bounds))
    origin = w.POINT(); u.ClientToScreen(hwnd, c.byref(origin))
    client = w.RECT(); u.GetClientRect(hwnd, c.byref(client))
    dc = u.GetWindowDC(hwnd)
    try:
        edge = origin.y - bounds.top
        samples = []
        for x in [origin.x - bounds.left + 2, origin.x - bounds.left + client.right // 2, origin.x - bounds.left + client.right - 3]:
            samples.append([int(gdi.GetPixel(dc, x, y)) for y in range(edge - 3, edge)])
        print(json.dumps(samples))
    finally:
        u.ReleaseDC(hwnd, dc)
elif action == 'redraw-menu':
    u.DrawMenuBar.argtypes = [w.HWND]
    u.DrawMenuBar(hwnd)
elif action == 'redraw-frame':
    u.RedrawWindow.argtypes = [w.HWND, c.c_void_p, w.HANDLE, w.UINT]
    u.RedrawWindow(hwnd, None, None, 0x401 | 0x100)  # INVALIDATE | FRAME | UPDATENOW
elif action == 'notify':
    u.PostMessageW(hwnd, int(sys.argv[3], 0), int(sys.argv[4], 0) if len(sys.argv) > 4 else 0, 0)
elif action == 'capture':
    from PIL import Image
    u.GetWindowDC.argtypes = [w.HWND]; u.GetWindowDC.restype = w.HDC
    u.ReleaseDC.argtypes = [w.HWND, w.HDC]
    u.PrintWindow.argtypes = [w.HWND, w.HDC, w.UINT]
    gdi.CreateCompatibleDC.argtypes = [w.HDC]; gdi.CreateCompatibleDC.restype = w.HDC
    gdi.CreateCompatibleBitmap.argtypes = [w.HDC, c.c_int, c.c_int]; gdi.CreateCompatibleBitmap.restype = w.HBITMAP
    gdi.SelectObject.argtypes = [w.HDC, w.HANDLE]; gdi.SelectObject.restype = w.HANDLE
    gdi.GetBitmapBits.argtypes = [w.HBITMAP, w.LONG, c.c_void_p]
    gdi.DeleteObject.argtypes = [w.HANDLE]
    gdi.DeleteDC.argtypes = [w.HDC]
    rect = w.RECT(); u.GetWindowRect(hwnd, c.byref(rect))
    width, height = rect.right - rect.left, rect.bottom - rect.top
    dc = u.GetWindowDC(hwnd); memory = gdi.CreateCompatibleDC(dc)
    bitmap = gdi.CreateCompatibleBitmap(dc, width, height)
    previous = gdi.SelectObject(memory, bitmap)
    try:
        if not u.PrintWindow(hwnd, memory, 2): raise RuntimeError('PrintWindow failed')
        pixels = c.create_string_buffer(width * height * 4)
        gdi.GetBitmapBits(bitmap, len(pixels), pixels)
        image = Image.frombuffer('RGB', (width, height), pixels.raw, 'raw', 'BGRX', 0, 1)
        image.save(sys.argv[3])
        if len(sys.argv) > 4:
            expected = tuple(bytes.fromhex(sys.argv[4].lstrip('#')))
            origin = w.POINT(); u.ClientToScreen(hwnd, c.byref(origin))
            edge = origin.y - rect.top
            # The bottom menu edge and the adjoining UI must be one surface.
            samples = [image.getpixel((width // 2, y)) for y in range(edge - 4, edge + 3)]
            if any(pixel != expected for pixel in samples):
                raise AssertionError(f'Menu seam differs from {expected}: {samples}')
    finally:
        gdi.SelectObject(memory, previous); gdi.DeleteObject(bitmap)
        gdi.DeleteDC(memory); u.ReleaseDC(hwnd, dc)
