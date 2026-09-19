"""Conservative model admission; estimates are not a reservation of system memory."""
import ctypes
import re
import subprocess
import sys
from pathlib import Path


def available_memory():
    try:
        if sys.platform == "win32":
            class Status(ctypes.Structure):
                _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
                    (name, ctypes.c_ulonglong) for name in ("total", "available", "totalPage", "availablePage", "totalVirtual", "availableVirtual", "extended")]
            status = Status()
            status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.available
        elif sys.platform.startswith("linux"):
            match = re.search(r"^MemAvailable:\s+(\d+) kB", Path("/proc/meminfo").read_text(), re.M)
            if match:
                return int(match[1]) * 1024
        elif sys.platform == "darwin":
            output = subprocess.check_output(["/usr/bin/vm_stat"], text=True, timeout=3)
            page = re.search(r"page size of (\d+) bytes", output)
            counts = re.findall(r"Pages (?:free|inactive|speculative):\s+(\d+)", output)
            if page and counts:
                return int(page[1]) * sum(map(int, counts))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return None


def require_model_memory():
    free = available_memory()
    if free is not None and free < 6 * 2**30:
        raise RuntimeError("Advanced grammar needs about 6 GB of available memory. Close other applications or use fast checks.")
