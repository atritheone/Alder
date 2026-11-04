"""One fresh-process saved-snapshot/export/import baseline; output stays external."""
import argparse
import json
import os
from pathlib import Path
import platform
import time
from alder.document_exports import DocumentExports
from alder.models import document_text, text_document
from alder.store import Store


def peak_bytes():
    if os.name != 'nt':
        import resource
        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return value if platform.system() == 'Darwin' else value * 1024
    import ctypes as c
    from ctypes import wintypes as w
    class Counters(c.Structure):
        _fields_ = [('cb', w.DWORD), ('faults', w.DWORD)] + [(name, c.c_size_t) for name in
            ('peakWorkingSet', 'workingSet', 'peakPaged', 'paged', 'peakNonpaged', 'nonpaged', 'pagefile', 'peakPagefile')]
    kernel = c.WinDLL('kernel32'); api = c.WinDLL('psapi')
    kernel.GetCurrentProcess.restype = w.HANDLE
    api.GetProcessMemoryInfo.argtypes = [w.HANDLE, c.POINTER(Counters), w.DWORD]
    values = Counters(); values.cb = c.sizeof(values)
    if not api.GetProcessMemoryInfo(kernel.GetCurrentProcess(), c.byref(values), values.cb): raise c.WinError()
    return values.peakWorkingSet


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pages', type=int, choices=[10, 100, 500, 1000], required=True)
    parser.add_argument('--format', choices=['txt', 'docx', 'html'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[1]
    directory = args.output.resolve()
    if directory.is_relative_to(repository): raise ValueError('Benchmark output must be outside the checkout.')
    directory.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'authoredSheets': args.pages, 'format': args.format,
              'platform': platform.platform(), 'cpu': platform.processor(), 'python': platform.python_version(),
              'font': 'Cambria 12', 'cache': 'Fresh Python process; OS cache not cleared.',
              'scope': 'Backend saved snapshots and semantic export/import, not renderer or native Word pagination.'}
    store = Store(directory / 'data'); service = DocumentExports(store)
    try:
        project = store.create('Publication baseline', 'blank')
        project['settings'].update(documentKind='docx', includeTitle=False, includeToc=False, fontFamily='Cambria', fontSize=12)
        content = []
        sentence = 'The traveller studied the old map beside the river and considered the journey ahead. '
        for sheet in range(args.pages):
            if sheet: content.append({'type': 'page_break'})
            for paragraph in range(2):
                content.extend(text_document(f'SHEET_{sheet + 1}_PASSAGE_{paragraph + 1} ' + sentence * 10)['content'])
        document = {'type': 'doc', 'content': content}
        project['book'] = {'version': 1, 'chapters': [{'id': 'main', 'title': 'Text', 'include': True, 'document': document}]}
        report['words'] = len(document_text(document).split())
        start = time.perf_counter(); project = store.update(project['id'], project, project['revision'])
        report['saveMilliseconds'] = round((time.perf_counter() - start) * 1000, 2)
        start = time.perf_counter(); reopened = store.get(project['id'])
        report['reopenMilliseconds'] = round((time.perf_counter() - start) * 1000, 2)
        assert reopened['book']['chapters'][0]['document'] == project['book']['chapters'][0]['document']
        start = time.perf_counter(); job = service.start(project['id'], args.format, expected_revision=project['revision'])
        service.jobs[job['id']]['future'].result(timeout=300)
        if service.get(job['id'])['status'] != 'ready': raise RuntimeError(service.get(job['id']))
        result = service.complete(job['id'])
        report['exportMilliseconds'] = round((time.perf_counter() - start) * 1000, 2)
        report['bytes'] = Path(result['path']).stat().st_size
        report['exportPeakProcessBytes'] = peak_bytes()
        from alder.publishing import import_document
        start = time.perf_counter(); imported = import_document(Path(result['path']))
        report['importMilliseconds'] = round((time.perf_counter() - start) * 1000, 2)
        assert document_text(imported['document']).split() == document_text(document).split()
        assert store.get(project['id']) == project
        report['peakProcessBytes'] = peak_bytes(); report['authoredWordsIntact'] = True; report['status'] = 'passed'
    finally:
        service.shutdown(); service.pool.shutdown(wait=True, cancel_futures=True)
        (directory / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__': main()
