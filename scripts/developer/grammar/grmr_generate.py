"""Measure the restricted GRMR research generator through unchanged service guards."""
import hashlib
from pathlib import Path
import generate
from alder.proofreading import engines


def main():
    snapshot=generate.source_snapshot
    def source_snapshot():
        result=snapshot()
        for name in ('grmr_generate.py','grmr_worker.py'):
            path=Path(__file__).with_name(name)
            result[str(path.relative_to(generate.ROOT))]=hashlib.sha256(path.read_bytes()).hexdigest()
        return result
    generate.source_snapshot=source_snapshot
    launch=engines.launch;worker=(generate.ROOT/'backend/alder/proofreading/worker.py').resolve()
    def task_launch(argv,**kwargs):
        return launch([str(Path(__file__).with_name('grmr_worker.py')) if str(arg)==str(worker)
                       else arg for arg in argv],**kwargs)
    engines.launch=task_launch
    generate.main()


if __name__=='__main__':main()
