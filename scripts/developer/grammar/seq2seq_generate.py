"""Measure a research-only task-specific generator through the real service."""
import argparse
import hashlib
from pathlib import Path
import sys
import generate
from alder.proofreading import engines


def main():
    parser=argparse.ArgumentParser(description=__doc__,add_help=False)
    parser.add_argument('--runtime-python',type=Path,required=True)
    options,remaining=parser.parse_known_args()
    if not options.runtime_python.is_file():raise ValueError('Use an explicit existing developer runtime.')
    if '--model-manifest' not in remaining:raise ValueError('Use the pinned external model manifest.')
    sys.argv=[sys.argv[0],*remaining]
    service_type=generate.ProofreadingService
    def service(*args,**kwargs):
        instance=service_type(*args,**kwargs);instance.resources.python=options.runtime_python.resolve()
        return instance
    generate.ProofreadingService=service
    snapshot=generate.source_snapshot
    def source_snapshot():
        result=snapshot()
        for name in ('seq2seq_generate.py','seq2seq_worker.py'):
            path=Path(__file__).with_name(name)
            result[str(path.relative_to(generate.ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
        return result
    generate.source_snapshot=source_snapshot
    runtime=generate.runtime_snapshot
    def runtime_snapshot(instance):
        result=runtime(instance)
        site=instance.resources.python.parent.parent/'Lib/site-packages'
        for package in ('torch','transformers','tokenizers','safetensors','huggingface_hub'):
            for path in sorted((site/package).rglob('*')):
                if path.is_file() and path.suffix in ('.py','.pyd','.dll','.json','.so'):
                    hasher=hashlib.sha256()
                    with path.open('rb') as stream:
                        for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
                    result[str(path.resolve())]=hasher.hexdigest()
        return result
    generate.runtime_snapshot=runtime_snapshot
    launch=engines.launch;worker=(generate.ROOT/'backend/alder/proofreading/worker.py').resolve()
    def seq2seq_launch(argv,**kwargs):
        return launch([str(Path(__file__).with_name('seq2seq_worker.py')) if str(arg)==str(worker)
                       else arg for arg in argv],**kwargs)
    engines.launch=seq2seq_launch
    generate.main()


if __name__=='__main__':main()
