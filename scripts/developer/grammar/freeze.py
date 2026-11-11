"""Create a verified external source snapshot for a long-running experiment.

Content-identical archived sources can resume their own fingerprints while the
main checkout advances. This does not create a Git branch or touch an installation.
"""
import argparse
import hashlib
from pathlib import Path
from common import ROOT,read,write,output_path,digest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-manifest');parser.add_argument('--directory',required=True)
    parser.add_argument('--backend-archive',type=Path,help='Compose a verified old backend with the current developer harness')
    args=parser.parse_args();run=read(args.run_manifest) if args.run_manifest else None
    expected=run['settings']['implementation'] if run else {}
    root=output_path(Path(args.directory)/'source-snapshot.json').parent
    copied={}
    for name,value in expected.items():
        if name.startswith('developer'):continue
        source=(ROOT/name).resolve()
        if not source.is_relative_to(ROOT) or not source.is_file():raise ValueError('Invalid experiment source path.')
        if hashlib.sha256(source.read_bytes()).hexdigest()!=value:raise ValueError('Checkout no longer matches the running experiment: '+name)
    sources={path.relative_to(ROOT):path for path in [*(ROOT/'backend/alder').rglob('*.py'),*(ROOT/'backend/alder').rglob('*.json'),
             *Path(__file__).parent.glob('*.py'),*Path(__file__).parent.glob('*.json')]}
    backend_origin=None
    if args.backend_archive:
        if run:raise ValueError('Compose sources before starting a run, not while resuming it.')
        archived=read(args.backend_archive/'source-snapshot.json');backend_origin=archived['sourceSHA256']
        sources={relative:path for relative,path in sources.items() if relative.parts[:2]!=('backend','alder')}
        for name,value in archived['files'].items():
            relative=Path(name)
            if relative.parts[:2]!=('backend','alder'):continue
            path=(args.backend_archive/relative).resolve()
            if not path.is_relative_to(args.backend_archive.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=value:
                raise ValueError('Archived backend failed integrity verification.')
            sources[relative]=path
    for relative,source in sorted(sources.items()):
        target=root/relative
        target.parent.mkdir(parents=True,exist_ok=True);content=source.read_bytes()
        if target.exists() and target.read_bytes()!=content:raise ValueError('Refuse to overwrite a different archived source snapshot.')
        target.write_bytes(content)
        actual=hashlib.sha256(target.read_bytes()).hexdigest()
        if actual!=hashlib.sha256(content).hexdigest():raise ValueError('Archived source failed verification.')
        copied[str(relative)]=actual
    write(root/'source-snapshot.json',{'runFingerprint':run['fingerprint'] if run else None,'files':copied,
      'sourceSHA256':digest(copied),'scope':__doc__})
    if backend_origin:
        write(root/'composition.json',{'backendSourceSHA256':backend_origin,'composedSourceSHA256':digest(copied),
          'scope':'Verified archived backend plus current developer harness; no original archive was modified'})
    print(__import__('json').dumps({'verifiedFiles':len(copied),'sourceSHA256':digest(copied)}))


if __name__=='__main__':main()
