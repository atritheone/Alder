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


def process_parents():
    """Snapshot lineage only; include Windows venv redirector children."""
    if sys.platform=='win32':
        import ctypes
        from ctypes import wintypes
        class Entry(ctypes.Structure):
            _fields_=[('dwSize',wintypes.DWORD),('cntUsage',wintypes.DWORD),
              ('th32ProcessID',wintypes.DWORD),('th32DefaultHeapID',ctypes.c_size_t),
              ('th32ModuleID',wintypes.DWORD),('cntThreads',wintypes.DWORD),
              ('th32ParentProcessID',wintypes.DWORD),('pcPriClassBase',wintypes.LONG),
              ('dwFlags',wintypes.DWORD),('szExeFile',wintypes.WCHAR*260)]
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateToolhelp32Snapshot.argtypes=[wintypes.DWORD,wintypes.DWORD]
        kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE
        kernel.Process32FirstW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
        kernel.Process32FirstW.restype=wintypes.BOOL
        kernel.Process32NextW.argtypes=[wintypes.HANDLE,ctypes.POINTER(Entry)]
        kernel.Process32NextW.restype=wintypes.BOOL
        kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        handle=kernel.CreateToolhelp32Snapshot(2,0)
        if handle==wintypes.HANDLE(-1).value:return None
        try:
            row=Entry();row.dwSize=ctypes.sizeof(row);result={}
            if not kernel.Process32FirstW(handle,ctypes.byref(row)):return None
            while True:
                result[row.th32ProcessID]=row.th32ParentProcessID
                if not kernel.Process32NextW(handle,ctypes.byref(row)):
                    return result if ctypes.get_last_error()==18 else None
        finally:kernel.CloseHandle(handle)
    if sys.platform.startswith('linux'):
        result={}
        try:
            for path in Path('/proc').iterdir():
                if not path.name.isdecimal():continue
                try:result[int(path.name)]=int((path/'stat').read_text().rsplit(')',1)[1].split()[1])
                except (OSError,ValueError,IndexError):continue  # Exited between inventory and read.
            return result
        except OSError:return None
    return None


def descendants(pid,parents):
    owned={pid};pending=[pid];children={}
    for child,parent in parents.items():children.setdefault(parent,[]).append(child)
    while pending:
        for child in children.get(pending.pop(),[]):
            if child not in owned:owned.add(child);pending.append(child)
    return owned


class Monitor:
    def __init__(self,service):
        self.service=service;self.peaks={'backend':None,'model':None,'rules':None}
        self.coverage_lost=set()
        self.stop=threading.Event();self.thread=threading.Thread(target=self.run,daemon=True)
    def sample(self):
        processes={'backend':os.getpid(),'model':self.service.model.process,'rules':self.service.rules.process}
        parents=process_parents() if any(value is not None for key,value in processes.items() if key!='backend') else {}
        for name,value in processes.items():
            if value is None:continue
            pid=value if isinstance(value,int) else value.pid
            # Backend descendants contain the separately measured model/rules;
            # count only the backend itself to avoid counting them twice.
            if name!='backend' and parents is None:
                self.coverage_lost.add(name);continue
            owned={pid} if name=='backend' else descendants(pid,parents)
            values=[peak_rss(child) for child in owned]
            if any(peak is None for peak in values):
                self.coverage_lost.add(name);continue
            peak=sum(values)
            self.peaks[name]=max(self.peaks[name] or 0,peak)
    def run(self):
        while not self.stop.wait(.1):self.sample()
    def start(self):self.thread.start()
    def result(self):
        self.sample();values=self.peaks.copy()
        complete=not self.coverage_lost and all(v is not None for v in values.values())
        return {'componentPeakRSSBytes':values,'sumComponentPeakRSSBytes':sum(values.values()) if complete else None,
                'processTreeCoverage':complete,'incompleteComponents':sorted(self.coverage_lost),
                'scope':'Conservative sum of owned component/descendant lifetime RSS peaks, with backend counted once; development host, not reference-hardware qualification'}
    def close(self):self.stop.set();self.thread.join(timeout=2)
