#include <node_api.h>
#include <windows.h>
#include <commctrl.h>
#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>
#include <memory>

namespace {
constexpr UINT_PTR kSubclass = 0x414c444d;
const UINT kFinishFramePaint = RegisterWindowMessageW(L"Alder.NativeMenu.FinishFramePaint");
struct NativeMenu { HMENU handle; HBRUSH background; std::unique_ptr<std::vector<std::wstring>> labels; bool paintPending = false; };
std::unordered_map<HWND, NativeMenu> menus;

HFONT MenuFont(HWND hwnd) {
  NONCLIENTMETRICSW metrics = {}; metrics.cbSize = sizeof(metrics);
  SystemParametersInfoForDpi(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0, GetDpiForWindow(hwnd));
  return CreateFontIndirectW(&metrics.lfMenuFont);
}
void PaintSeam(HWND hwnd, HDC target = nullptr) {
  auto found = menus.find(hwnd);
  if (found == menus.end() || !GetMenu(hwnd)) return;
  MENUBARINFO bar = {}; bar.cbSize = sizeof(bar);
  RECT bounds, client; POINT origin = {};
  if (!GetMenuBarInfo(hwnd, OBJID_MENU, 0, &bar) || !GetWindowRect(hwnd, &bounds) || !GetClientRect(hwnd, &client) || !ClientToScreen(hwnd, &origin)) return;
  HDC dc = target ? target : GetWindowDC(hwnd);
  if (!dc) return;
  // Owner-drawn labels retain native menu navigation. Paint the unused bar space
  // and its bottom edge too: themed Windows ignores MIM_BACKGROUND there.
  RECT last = bar.rcBar;
  const int count = GetMenuItemCount(found->second.handle);
  if (count) GetMenuItemRect(hwnd, found->second.handle, count - 1, &last);
  RECT blank = {last.right - bounds.left, bar.rcBar.top - bounds.top,
                origin.x + client.right - bounds.left, origin.y - bounds.top};
  FillRect(dc, &blank, found->second.background);
  RECT seam = {origin.x - bounds.left, bar.rcBar.bottom - bounds.top - 1,
               origin.x + client.right - bounds.left, origin.y - bounds.top};
  if (seam.bottom >= seam.top && seam.bottom - seam.top < 8)
    FillRect(dc, &seam, found->second.background);
  if (!target) ReleaseDC(hwnd, dc);
}

void QueueFramePaint(HWND hwnd) {
  auto found = menus.find(hwnd);
  if (found == menus.end() || found->second.paintPending || !GetMenu(hwnd)) return;
  found->second.paintPending = PostMessageW(hwnd, kFinishFramePaint, 0, 0) != FALSE;
}
void RefreshMenu(HWND hwnd) {
  DrawMenuBar(hwnd);
  QueueFramePaint(hwnd);
}

napi_value Fail(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}
napi_value Undefined(napi_env env) {
  napi_value result; napi_get_undefined(env, &result); return result;
}
HWND Window(napi_env env, napi_value value) {
  bool buffer = false; napi_is_buffer(env, value, &buffer);
  void* data = nullptr; size_t size = 0;
  if (!buffer || napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(HWND)) return nullptr;
  HWND hwnd; std::memcpy(&hwnd, data, sizeof(hwnd));
  DWORD process = 0;
  const DWORD thread = GetWindowThreadProcessId(hwnd, &process);
  return IsWindow(hwnd) && process == GetCurrentProcessId() && thread == GetCurrentThreadId() ? hwnd : nullptr;
}
napi_value Property(napi_env env, napi_value value, const char* name) {
  napi_value result; napi_get_named_property(env, value, name, &result); return result;
}
bool Boolean(napi_env env, napi_value value, const char* name, bool fallback) {
  bool result = fallback; napi_get_value_bool(env, Property(env, value, name), &result); return result;
}
std::wstring String(napi_env env, napi_value value) {
  size_t length = 0;
  if (napi_get_value_string_utf16(env, value, nullptr, 0, &length) != napi_ok || length > 512) return L"";
  std::vector<char16_t> text(length + 1);
  napi_get_value_string_utf16(env, value, text.data(), text.size(), &length);
  return std::wstring(reinterpret_cast<wchar_t*>(text.data()), length);
}
HMENU Build(napi_env env, napi_value entries, bool popup, unsigned depth = 0, std::vector<std::wstring>* labels = nullptr) {
  bool array = false; napi_is_array(env, entries, &array);
  uint32_t count = 0;
  if (!array || depth > 5 || napi_get_array_length(env, entries, &count) != napi_ok || count > 256) return nullptr;
  HMENU menu = popup ? CreatePopupMenu() : CreateMenu();
  if (!menu) return nullptr;
  if (labels) labels->reserve(count);
  for (uint32_t i = 0; i < count; ++i) {
    napi_value entry; napi_get_element(env, entries, i, &entry);
    MENUITEMINFOW item = {}; item.cbSize = sizeof(item);
    item.fMask = MIIM_FTYPE | MIIM_STATE;
    item.fType = Boolean(env, entry, "separator", false) ? MFT_SEPARATOR : MFT_STRING;
    if (Boolean(env, entry, "radio", false)) item.fType |= MFT_RADIOCHECK;
    item.fState = Boolean(env, entry, "enabled", true) ? MFS_ENABLED : MFS_DISABLED;
    if (Boolean(env, entry, "checked", false)) item.fState |= MFS_CHECKED;
    std::wstring label = String(env, Property(env, entry, "label"));
    if (!(item.fType & MFT_SEPARATOR)) {
      item.fMask |= MIIM_STRING; item.dwTypeData = label.data();
      if (labels) {
        labels->push_back(label);
        item.fType |= MFT_OWNERDRAW; item.fMask |= MIIM_DATA;
        item.dwItemData = reinterpret_cast<ULONG_PTR>(&labels->back());
      }
    }
    napi_value children = Property(env, entry, "children");
    bool hasChildren = false; napi_is_array(env, children, &hasChildren);
    if (hasChildren) {
      item.fMask |= MIIM_SUBMENU; item.hSubMenu = Build(env, children, true, depth + 1);
      if (!item.hSubMenu) { DestroyMenu(menu); return nullptr; }
    } else {
      uint32_t id = 0; napi_get_value_uint32(env, Property(env, entry, "id"), &id);
      if (id > 0xffff) { DestroyMenu(menu); return nullptr; }
      item.fMask |= MIIM_ID; item.wID = id;
    }
    if (!InsertMenuItemW(menu, i, TRUE, &item)) {
      if (item.hSubMenu) DestroyMenu(item.hSubMenu);
      DestroyMenu(menu); return nullptr;
    }
  }
  return menu;
}
LRESULT CALLBACK Subclass(HWND hwnd, UINT message, WPARAM wp, LPARAM lp, UINT_PTR, DWORD_PTR) {
  if (message == kFinishFramePaint) {
    auto found = menus.find(hwnd);
    if (found != menus.end()) {
      found->second.paintPending = false;
      PaintSeam(hwnd);
    }
    return 0;
  }
  // Chromium owns client geometry and its input/compositor transforms. Never
  // change WM_NCCALCSIZE results after it has cached those coordinates.
  if (message == WM_MEASUREITEM) {
    auto item = reinterpret_cast<MEASUREITEMSTRUCT*>(lp);
    if (item->CtlType == ODT_MENU && item->itemData) {
      const auto& label = *reinterpret_cast<std::wstring*>(item->itemData);
      HDC dc = GetDC(hwnd); HFONT font = MenuFont(hwnd);
      auto previous = SelectObject(dc, font);
      RECT text = {}; DrawTextW(dc, label.c_str(), -1, &text, DT_CALCRECT | DT_SINGLELINE);
      item->itemWidth = text.right; // Windows supplies the menu's horizontal padding.
      item->itemHeight = GetSystemMetricsForDpi(SM_CYMENU, GetDpiForWindow(hwnd));
      SelectObject(dc, previous); DeleteObject(font); ReleaseDC(hwnd, dc);
      return TRUE;
    }
  }
  if (message == WM_DRAWITEM) {
    auto item = reinterpret_cast<DRAWITEMSTRUCT*>(lp);
    if (item->CtlType == ODT_MENU && item->itemData) {
      auto found = menus.find(hwnd);
      if (found != menus.end()) {
        bool selected = (item->itemState & (ODS_SELECTED | ODS_HOTLIGHT)) != 0;
        FillRect(item->hDC, &item->rcItem, selected ? GetSysColorBrush(COLOR_HIGHLIGHT) : found->second.background);
        const auto& label = *reinterpret_cast<std::wstring*>(item->itemData);
        HFONT font = MenuFont(hwnd); auto previous = SelectObject(item->hDC, font);
        int saved = SaveDC(item->hDC);
        SetBkMode(item->hDC, TRANSPARENT);
        SetTextColor(item->hDC, GetSysColor(selected ? COLOR_HIGHLIGHTTEXT : COLOR_MENUTEXT));
        RECT rect = item->rcItem;
        UINT flags = DT_CENTER | DT_VCENTER | DT_SINGLELINE;
        if (item->itemState & ODS_NOACCEL) flags |= DT_HIDEPREFIX;
        DrawTextW(item->hDC, label.c_str(), -1, &rect, flags);
        RestoreDC(item->hDC, saved); SelectObject(item->hDC, previous); DeleteObject(font);
        QueueFramePaint(hwnd);
        return TRUE;
      }
    }
  }
  if (message == WM_PRINT) {
    LRESULT result = DefSubclassProc(hwnd, message, wp, lp);
    if (lp & PRF_NONCLIENT) PaintSeam(hwnd, reinterpret_cast<HDC>(wp));
    return result;
  }
  // Chromium handles its own Alt navigation. Native menus use Windows' menu loop.
  if ((message == WM_SYSCOMMAND && (wp & 0xfff0) == SC_KEYMENU) ||
      (message == WM_NCLBUTTONDOWN && wp == HTMENU)) {
    LRESULT result = DefWindowProcW(hwnd, message, wp, lp);
    QueueFramePaint(hwnd);
    return result;
  }
  if (message == WM_NCPAINT || message == WM_NCACTIVATE) {
    LRESULT result = DefSubclassProc(hwnd, message, wp, lp);
    PaintSeam(hwnd);
    QueueFramePaint(hwnd);
    return result;
  }
  if (message == WM_WINDOWPOSCHANGED || message == WM_DPICHANGED ||
      message == WM_THEMECHANGED || message == WM_SETTINGCHANGE ||
      message == WM_EXITMENULOOP || message == WM_SHOWWINDOW) {
    LRESULT result = DefSubclassProc(hwnd, message, wp, lp);
    QueueFramePaint(hwnd);
    return result;
  }
  if (message == WM_NCDESTROY) {
    // Windows destroys an attached HMENU. A fullscreen window has it detached.
    auto found = menus.find(hwnd);
    if (found != menus.end()) {
      if (GetMenu(hwnd) != found->second.handle) DestroyMenu(found->second.handle);
      DeleteObject(found->second.background);
      menus.erase(found);
    }
    RemoveWindowSubclass(hwnd, Subclass, kSubclass);
  }
  return DefSubclassProc(hwnd, message, wp, lp);
}
napi_value Set(napi_env env, napi_callback_info info) {
  size_t argc = 3; napi_value args[3]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  HWND hwnd = argc >= 2 ? Window(env, args[0]) : nullptr;
  if (!hwnd) return Fail(env, "Native menus require a window owned by the calling UI thread.");
  auto labels = std::make_unique<std::vector<std::wstring>>();
  HMENU next = Build(env, args[1], false, 0, labels.get());
  if (!next) return Fail(env, "Unable to create the Windows menu.");
  uint32_t color = 0x909090;
  if (argc > 2) napi_get_value_uint32(env, args[2], &color);
  HBRUSH brush = CreateSolidBrush(RGB((color >> 16) & 255, (color >> 8) & 255, color & 255));
  MENUINFO style = {}; style.cbSize = sizeof(style); style.fMask = MIM_BACKGROUND; style.hbrBack = brush;
  if (!brush || !SetMenuInfo(next, &style) || !SetWindowSubclass(hwnd, Subclass, kSubclass, 0) || !SetMenu(hwnd, next)) {
    if (brush) DeleteObject(brush);
    DestroyMenu(next); return Fail(env, "Unable to attach the Windows menu.");
  }
  auto previous = menus.find(hwnd);
  if (previous != menus.end()) { DestroyMenu(previous->second.handle); DeleteObject(previous->second.background); }
  menus[hwnd] = {next, brush, std::move(labels)};
  RefreshMenu(hwnd);
  return Undefined(env);
}
napi_value Activate(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  HWND hwnd = argc >= 1 ? Window(env, args[0]) : nullptr;
  if (!hwnd || !menus.count(hwnd)) return Fail(env, "No Windows menu attached.");
  uint32_t character = 0;
  if (argc > 1) napi_get_value_uint32(env, args[1], &character);
  PostMessageW(hwnd, WM_SYSCOMMAND, SC_KEYMENU, character);
  return Undefined(env);
}
napi_value Visible(napi_env env, napi_callback_info info) {
  size_t argc = 2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  HWND hwnd = argc == 2 ? Window(env, args[0]) : nullptr;
  if (!hwnd || !menus.count(hwnd)) return Fail(env, "No Windows menu attached.");
  bool visible = true; napi_get_value_bool(env, args[1], &visible);
  SetMenu(hwnd, visible ? menus[hwnd].handle : nullptr); RefreshMenu(hwnd);
  return Undefined(env);
}
napi_value Dispose(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  HWND hwnd = argc == 1 ? Window(env, args[0]) : nullptr;
  auto found = menus.find(hwnd);
  if (found != menus.end()) {
    SetMenu(hwnd, nullptr); DestroyMenu(found->second.handle); DeleteObject(found->second.background); menus.erase(found);
    RemoveWindowSubclass(hwnd, Subclass, kSubclass); RefreshMenu(hwnd);
  }
  return Undefined(env);
}
void Cleanup(void*) {
  for (const auto& pair : menus) {
    if (IsWindow(pair.first)) { SetMenu(pair.first, nullptr); RemoveWindowSubclass(pair.first, Subclass, kSubclass); }
    DestroyMenu(pair.second.handle); DeleteObject(pair.second.background);
  }
  menus.clear();
}
napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    {"set", nullptr, Set, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"activate", nullptr, Activate, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"visible", nullptr, Visible, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"dispose", nullptr, Dispose, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, methods);
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  return exports;
}
} // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
