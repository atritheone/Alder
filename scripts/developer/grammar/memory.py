"""Sample owned inference/rules/backend peaks without adding shipping dependencies."""
import os
from pathlib import Path
import sys
import threading


def physical_memory():
    if sys.platform=='win32':
        import ctypes
        from ctypes import wintypes
        class Status(ctypes.Structure):
            _fields_=[('length',wintypes.DWORD),('load',wintypes.DWORD)]+[(name,ctypes.c_ulonglong) for name in
                ('totalPhysical','availablePhysical','totalPageFile','availablePageFile','totalVirtual','availableVirtual','availableExtendedVirtual')]
        status=Status();status.length=ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):return status.totalPhysical
    elif hasattr(os,'sysconf'):
        try:return os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')
        except (ValueError,OSError):pass
    return None


def peak_rss(pid):
    if sys.platform=='win32':
        import ctypes
        from ctypes import wintypes
        class Counters(ctypes.Structure):
            _fields_=[('cb',wintypes.DWORD),('PageFaultCount',wintypes.DWORD)]+[(name,ctypes.c_size_t) for name in
                ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage',
                 'QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        psapi=ctypes.WinDLL('psapi',use_last_error=True)
        kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        psapi.GetProcessMemoryInfo.argtypes=[wintypes.HANDLE,ctypes.POINTER(Counters),wintypes.DWORD]
        handle=kernel.OpenProcess(0x410,False,pid)
        if not handle:return None
        try:
            counters=Counters();counters.cb=ctypes.sizeof(counters)
            if not psapi.GetProcessMemoryInfo(handle,ctypes.byref(counters),counters.cb):return None
            return counters.PeakWorkingSetSize
        finally:kernel.CloseHandle(handle)
    if sys.platform.startswith('linux'):
        try:
            for line in Path(f'/proc/{pid}/status').read_text().splitlines():
                if line.startswith('VmHWM:'):return int(line.split()[1])*1024
        except (OSError,ValueError):pass
    return None


class Monitor:
    def __init__(self,service):
        self.service=service;self.peaks={'backend':None,'model':None,'rules':None}
        self.stop=threading.Event();self.thread=threading.Thread(target=self.run,daemon=True)
    def sample(self):
        processes={'backend':os.getpid(),'model':self.service.model.process,'rules':self.service.rules.process}
        for name,value in processes.items():
            if value is None:continue
            pid=value if isinstance(value,int) else value.pid
            peak=peak_rss(pid)
            if peak is not None:self.peaks[name]=max(self.peaks[name] or 0,peak)
    def run(self):
        while not self.stop.wait(.1):self.sample()
    def start(self):self.thread.start()
    def result(self):
        self.sample();values=self.peaks.copy()
        return {'componentPeakRSSBytes':values,'sumComponentPeakRSSBytes':sum(values.values()) if all(v is not None for v in values.values()) else None,
                'scope':'Conservative sum of owned component lifetime RSS peaks; development host, not reference-hardware qualification'}
    def close(self):self.stop.set();self.thread.join(timeout=2)
