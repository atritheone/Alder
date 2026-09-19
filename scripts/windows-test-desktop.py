"""Run the existing Electron menu checks on a separate Windows test desktop."""
import ctypes as c
from ctypes import wintypes as w
import os
from pathlib import Path
import subprocess
import sys
import uuid
u=c.WinDLL('user32',use_last_error=True);k=c.WinDLL('kernel32',use_last_error=True)
u.CreateDesktopW.argtypes=[w.LPCWSTR,w.LPCWSTR,c.c_void_p,w.DWORD,w.DWORD,c.c_void_p];u.CreateDesktopW.restype=w.HANDLE
u.CloseDesktop.argtypes=[w.HANDLE]
class STARTUP(c.Structure):
 _fields_=[('cb',w.DWORD),('lpReserved',w.LPWSTR),('lpDesktop',w.LPWSTR),('lpTitle',w.LPWSTR),('dwX',w.DWORD),('dwY',w.DWORD),('dwXSize',w.DWORD),('dwYSize',w.DWORD),('dwXCountChars',w.DWORD),('dwYCountChars',w.DWORD),('dwFillAttribute',w.DWORD),('dwFlags',w.DWORD),('wShowWindow',w.WORD),('cbReserved2',w.WORD),('lpReserved2',c.c_void_p),('hStdInput',w.HANDLE),('hStdOutput',w.HANDLE),('hStdError',w.HANDLE)]
class PROCESS(c.Structure):
 _fields_=[('process',w.HANDLE),('thread',w.HANDLE),('pid',w.DWORD),('tid',w.DWORD)]
k.CreateProcessW.argtypes=[w.LPCWSTR,w.LPWSTR,c.c_void_p,c.c_void_p,w.BOOL,w.DWORD,c.c_void_p,w.LPCWSTR,c.POINTER(STARTUP),c.POINTER(PROCESS)]
k.WaitForSingleObject.argtypes=[w.HANDLE,w.DWORD]
k.GetExitCodeProcess.argtypes=[w.HANDLE,c.POINTER(w.DWORD)]
k.CloseHandle.argtypes=[w.HANDLE]
class BASIC_LIMIT(c.Structure):
 _fields_=[('processTime',c.c_longlong),('jobTime',c.c_longlong),('flags',w.DWORD),('minWorkingSet',c.c_size_t),('maxWorkingSet',c.c_size_t),('processCount',w.DWORD),('affinity',c.c_size_t),('priority',w.DWORD),('scheduling',w.DWORD)]
class EXTENDED_LIMIT(c.Structure):
 _fields_=[('basic',BASIC_LIMIT),('io',c.c_ulonglong*6),('processMemory',c.c_size_t),('jobMemory',c.c_size_t),('peakProcess',c.c_size_t),('peakJob',c.c_size_t)]
k.CreateJobObjectW.argtypes=[c.c_void_p,w.LPCWSTR];k.CreateJobObjectW.restype=w.HANDLE
k.SetInformationJobObject.argtypes=[w.HANDLE,c.c_int,c.c_void_p,w.DWORD]
k.AssignProcessToJobObject.argtypes=[w.HANDLE,w.HANDLE]
k.ResumeThread.argtypes=[w.HANDLE];k.ResumeThread.restype=w.DWORD
job=k.CreateJobObjectW(None,None)
if not job:raise c.WinError(c.get_last_error())
limits=EXTENDED_LIMIT();limits.basic.flags=0x2000 # Kill the isolated test tree when its job closes.
if not k.SetInformationJobObject(job,9,c.byref(limits),c.sizeof(limits)):
 k.CloseHandle(job);raise c.WinError(c.get_last_error())
name='AlderMenuTest-'+uuid.uuid4().hex
desk=u.CreateDesktopW(name,None,None,0,0x01ff,None)
if not desk:
 k.CloseHandle(job);raise c.WinError(c.get_last_error())
startup=STARTUP();startup.cb=c.sizeof(startup);startup.lpDesktop='winsta0\\'+name
process=PROCESS()
os.environ['ALDER_MENU_INTERACTIVE']='1'
try:
 if not k.CreateProcessW(None,c.create_unicode_buffer(subprocess.list2cmdline(sys.argv[1:])),None,None,False,0x08000004,None,os.getcwd(),c.byref(startup),c.byref(process)): raise c.WinError(c.get_last_error())
 if not k.AssignProcessToJobObject(job,process.process):
  k.TerminateProcess.argtypes=[w.HANDLE,w.UINT];k.TerminateProcess(process.process,1)
  raise c.WinError(c.get_last_error())
 if k.ResumeThread(process.thread)==0xffffffff:raise c.WinError(c.get_last_error())
 if k.WaitForSingleObject(process.process,45000)!=0: raise RuntimeError('Isolated desktop test exceeded 45 seconds')
 result=w.DWORD();k.GetExitCodeProcess(process.process,c.byref(result));sys.exit(result.value)
finally:
 k.CloseHandle(job)
 if process.thread:k.CloseHandle(process.thread)
 if process.process:k.CloseHandle(process.process)
 u.CloseDesktop(desk)
