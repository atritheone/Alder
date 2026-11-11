"""Explicit developer-only download of selected files from a pinned HF revision.

Inference tools never download. This separate operation verifies published LFS
hashes and writes a complete local manifest; it never executes checkpoint code.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from urllib.request import urlopen
from urllib.parse import quote
from common import write,read,output_path


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',required=True);parser.add_argument('--revision',required=True)
    parser.add_argument('--files',nargs='+',required=True);parser.add_argument('--directory',required=True)
    args=parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',args.repo) or not re.fullmatch(r'[a-f0-9]{40}',args.revision):
        raise ValueError('Use an explicit repository and full immutable revision.')
    directory=output_path(Path(args.directory)/'artifact-manifest.json').parent
    with urlopen(f'https://huggingface.co/api/models/{args.repo}/revision/{args.revision}?blobs=true',timeout=60) as response:
        metadata=json.load(response)
    if metadata['sha']!=args.revision:raise ValueError('Resolved checkpoint revision differs.')
    available={item['rfilename']:item for item in metadata['siblings']};manifest={}
    for name in args.files:
        path=(directory/name).resolve()
        if not path.is_relative_to(directory) or name not in available:raise ValueError('Unlisted or escaped checkpoint file.')
        item=available[name];expected=item.get('lfs',{}).get('sha256');size=item.get('size')
        def verify(candidate):
            hasher=hashlib.sha256()
            with candidate.open('rb') as stream:
                for chunk in iter(lambda:stream.read(4*1024*1024),b''):hasher.update(chunk)
            value=hasher.hexdigest()
            if expected and value!=expected:raise ValueError('Published checkpoint checksum differs: '+name)
            if size is not None and candidate.stat().st_size!=size:raise ValueError('Checkpoint size differs: '+name)
            return value
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():value=verify(path)
        else:
            temporary=Path(str(path)+'.download')
            intent=Path(str(temporary)+'.json')
            identity={'repo':args.repo,'revision':args.revision,'file':name,'sha256':expected,'size':size}
            if temporary.exists() and (not intent.exists() or read(intent)!=identity):
                raise ValueError('Partial download has a different or unknown origin; preserve it and use another directory.')
            write(intent,identity)
            url=f'https://huggingface.co/{args.repo}/resolve/{args.revision}/{quote(name,safe="/")}'
            from urllib.request import Request
            for attempt in range(3):
                try:
                    offset=temporary.stat().st_size if temporary.exists() else 0
                    if size is not None and offset>size:raise ValueError('Partial checkpoint exceeds the published file size.')
                    if size is not None and offset==size:break
                    request=Request(url,headers={'Range':f'bytes={offset}-'} if offset else {})
                    with urlopen(request,timeout=90) as response:
                        append=offset>0 and response.status==206
                        if append and not response.headers.get('Content-Range','').startswith(f'bytes {offset}-'):
                            raise ValueError('Checkpoint resumed at an unexpected offset.')
                        with temporary.open('ab' if append else 'wb') as stream:
                            while chunk:=response.read(4*1024*1024):stream.write(chunk)
                    break
                except (OSError,TimeoutError):
                    if attempt==2:raise
                    time.sleep(1)
            value=verify(temporary);temporary.replace(path)
        manifest[name]={'sha256':value,'size':path.stat().st_size,'publishedLFSHash':expected}
        print(json.dumps({'file':name,'verified':True}),flush=True)
    write(directory/'artifact-manifest.json',{'repo':args.repo,'revision':args.revision,'files':manifest,
      'licence':metadata.get('cardData',{}).get('license','unspecified'),
      'scope':'Selected local developer research assets; no application installation or redistribution approval'})


if __name__=='__main__':main()
