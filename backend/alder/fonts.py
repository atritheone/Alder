"""Discover the running user's font collection without copying font files."""
import os
import struct
from functools import lru_cache
from pathlib import Path


def _font_paths():
    system = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    personal = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Microsoft/Windows/Fonts"
    paths = set()
    for directory in (system, personal):
        if directory.is_dir():
            paths.update(p for p in directory.iterdir() if p.suffix.lower() in {".ttf", ".otf", ".ttc", ".otc"})
    # Registry entries may point to fonts installed outside standard directories.
    try:
        import winreg
        for hive, base in ((winreg.HKEY_LOCAL_MACHINE, system), (winreg.HKEY_CURRENT_USER, personal)):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts") as key:
                    for index in range(winreg.QueryInfoKey(key)[1]):
                        _, value, _ = winreg.EnumValue(key, index)
                        if isinstance(value, str):
                            path = Path(os.path.expandvars(value))
                            paths.add(path if path.is_absolute() else base / path)
            except OSError:
                continue
    except ImportError:
        # These locations support source builds on macOS/Linux as well.
        for directory in (Path('/Library/Fonts'), Path('/System/Library/Fonts'), Path.home()/'Library/Fonts', Path('/usr/share/fonts'), Path.home()/'.local/share/fonts', Path.home()/'.fonts'):
            if directory.is_dir():
                paths.update(p for p in directory.rglob('*') if p.suffix.lower() in {'.ttf', '.otf', '.ttc', '.otc'})
    return paths


@lru_cache(maxsize=2048)
def _faces(path: str, modified: int, size: int):
    """Read family names from SFNT tables, including every face in a collection."""
    result = []
    try:
        with open(path, 'rb') as file:
            header = file.read(12)
            offsets = [0]
            if header[:4] == b'ttcf':
                count = struct.unpack_from('>I', header, 8)[0]
                if count > 1024: return ()
                offsets = list(struct.unpack(f'>{count}I', file.read(count * 4)))
            for index, offset in enumerate(offsets):
                file.seek(offset)
                sfnt = file.read(12)
                if sfnt[:4] not in (b'\x00\x01\x00\x00', b'OTTO', b'true'): continue
                count = struct.unpack_from('>H', sfnt, 4)[0]
                if count > 512: continue
                tables = [struct.unpack('>4sIII', file.read(16)) for _ in range(count)]
                embedding = 0
                os2 = next((t for t in tables if t[0] == b'OS/2'), None)
                if os2 and os2[3] >= 10:
                    file.seek(os2[2] + 8)
                    embedding = struct.unpack('>H', file.read(2))[0]
                table = next((t for t in tables if t[0] == b'name'), None)
                if not table or table[3] > 2_000_000: continue
                file.seek(table[2]); data = file.read(table[3])
                _, count, strings = struct.unpack_from('>HHH', data)
                names = {}
                for i in range(count):
                    platform, encoding, language, name_id, length, start = struct.unpack_from('>6H', data, 6 + i * 12)
                    if name_id not in (1, 2, 4, 16, 17): continue
                    raw = data[strings + start:strings + start + length]
                    try: value = raw.decode('utf-16-be' if platform in (0, 3) else 'mac_roman').strip()
                    except UnicodeError: continue
                    priority = (3 if platform == 3 and language == 0x409 else 2 if platform == 0 else 1)
                    if value and (name_id not in names or priority > names[name_id][0]): names[name_id] = (priority, value)
                family = names.get(16, names.get(1, (0, '')))[1]
                style = names.get(17, names.get(2, (0, 'Regular')))[1]
                if family and not family.startswith('@'):
                    result.append({'family': family, 'style': style, 'path': path, 'index': index, 'embedding': embedding})
                    legacy = names.get(1, (0, ''))[1]
                    if legacy and legacy != family and not legacy.startswith('@'):
                        result.append({'family': legacy, 'style': names.get(2, (0, style))[1], 'path': path, 'index': index, 'embedding': embedding})
    except (OSError, struct.error, ValueError):
        pass
    return tuple(result)


def installed_faces():
    faces = []
    for path in sorted(_font_paths(), key=str):
        try:
            stat = path.stat()
            faces.extend(_faces(str(path), stat.st_mtime_ns, stat.st_size))
        except OSError:
            continue
    return faces


def _windows_families():
    """Ask Windows for its typeface names, including named variable instances.

    https://learn.microsoft.com/windows/win32/api/wingdi/nf-wingdi-enumfontfamiliesexw
    """
    if os.name != 'nt':
        return set()
    import ctypes as ct
    from ctypes import wintypes as wt

    class LogFont(ct.Structure):
        _fields_ = [(name, wt.LONG) for name in ('height', 'width', 'escapement', 'orientation', 'weight')] + [
            (name, wt.BYTE) for name in ('italic', 'underline', 'strikeout', 'charset', 'outPrecision', 'clipPrecision', 'quality', 'pitchAndFamily')
        ] + [('faceName', wt.WCHAR * 32)]

    callback_type = ct.WINFUNCTYPE(ct.c_int, ct.POINTER(LogFont), ct.c_void_p, wt.DWORD, wt.LPARAM)
    user32, gdi32 = ct.WinDLL('user32'), ct.WinDLL('gdi32')
    user32.GetDC.argtypes, user32.GetDC.restype = [wt.HWND], wt.HDC
    user32.ReleaseDC.argtypes, user32.ReleaseDC.restype = [wt.HWND, wt.HDC], ct.c_int
    gdi32.EnumFontFamiliesExW.argtypes = [wt.HDC, ct.POINTER(LogFont), callback_type, wt.LPARAM, wt.DWORD]
    gdi32.EnumFontFamiliesExW.restype = ct.c_int
    names = set()

    @callback_type
    def receive(logfont, _metrics, _kind, _parameter):
        name = logfont.contents.faceName
        if name and not name.startswith('@'):
            names.add(name)
        return 1

    dc = user32.GetDC(None)
    if dc:
        try:
            pattern = LogFont()
            pattern.charset = 1  # DEFAULT_CHARSET enumerates every character set.
            gdi32.EnumFontFamiliesExW(dc, ct.byref(pattern), receive, 0, 0)
        finally:
            user32.ReleaseDC(None, dc)
    return names


def installed_families():
    return sorted(_windows_families() | {face['family'] for face in installed_faces()}, key=str.casefold)


def register_pdf_font(family, faces=None):
    """Embed a supported installed family in a document, respecting its flags."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import hashlib
    matches = [face for face in (installed_faces() if faces is None else faces) if face['family'].casefold() == family.casefold()]
    if not matches: return None
    key = 'AlderInstalled' + hashlib.sha256(repr(matches).encode()).hexdigest()[:16]
    def choose(bold, italic):
        def score(face):
            style = face['style'].casefold()
            is_bold = any(token in style for token in ('bold', 'black', 'heavy'))
            is_italic = any(token in style for token in ('italic', 'oblique'))
            return 10 * (is_bold != bold) + 10 * (is_italic != italic) + (0 if style in ('regular', 'roman', 'normal', 'book', 'bold', 'italic', 'bold italic') else 1)
        return min(matches, key=score)
    try:
        for suffix, bold, italic in (('', False, False), ('-Bold', True, False), ('-Italic', False, True), ('-BoldItalic', True, True)):
            name = key + suffix
            if name not in pdfmetrics.getRegisteredFontNames():
                face = choose(bold, italic)
                # Restricted, bitmap-only, or no-subsetting licences cannot use
                # ReportLab's outline subsetting. They remain selectable in the UI.
                if face.get('embedding', 0) & (0x0002 | 0x0100 | 0x0200):
                    return None
                pdfmetrics.registerFont(TTFont(name, face['path'], subfontIndex=face['index']))
        pdfmetrics.registerFontFamily(key, normal=key, bold=key+'-Bold', italic=key+'-Italic', boldItalic=key+'-BoldItalic')
        return key
    except Exception:
        # CFF, unsupported variable faces, or restricted embedding must not break export.
        return None


def aptos_directory() -> Path | None:
    directories = [Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "Microsoft/Windows/Fonts",
                   Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"]
    for directory in directories:
        if all((directory / name).is_file() for name in ("Aptos.ttf", "Aptos-Bold.ttf", "Aptos-Italic.ttf", "Aptos-Bold-Italic.ttf")):
            return directory
    return None
