"""Hash-verified cache and bounded archive extraction, including internal links."""
from pathlib import Path, PurePosixPath
import gzip
import hashlib
import os
import shutil
import tarfile
import urllib.error
import urllib.request
import zipfile
import sys
from common import SetupError, digest


def fetch(item, cache, offline=False):
    algorithm = 'sha256' if 'sha256' in item else 'sha512'
    expected = item.get(algorithm, '')
    if len(expected) != (64 if algorithm == 'sha256' else 128):
        raise SetupError('ALDER_METADATA', f'Missing digest: {item.get("name")}')
    cache = Path(cache); cache.mkdir(parents=True, exist_ok=True)
    output = cache / (expected + '-' + Path(item['name']).name)
    def valid(path):
        h = hashlib.new(algorithm)
        with path.open('rb') as f:
            for data in iter(lambda: f.read(4*1024*1024), b''): h.update(data)
        return h.hexdigest() == expected
    if output.is_file():
        if valid(output): return output
        if offline: raise SetupError('ALDER_HASH', f'Corrupt offline cache: {output}')
        output.replace(output.with_suffix(output.suffix + '.corrupt'))
    if offline:
        raise SetupError('ALDER_OFFLINE', f'Not cached: {item["name"]}. Run online once.')
    if not item['url'].startswith('https://'):
        raise SetupError('ALDER_METADATA', 'Only HTTPS artifact URLs are allowed.')
    partial = output.with_suffix(output.suffix + '.partial')
    print('[download] '+item['name'], file=sys.stderr, flush=True)
    start = partial.stat().st_size if partial.exists() else 0
    headers = {'User-Agent': 'Alder-Setup/1'}
    if start: headers['Range'] = f'bytes={start}-'
    try:
        response = urllib.request.urlopen(urllib.request.Request(item['url'], headers=headers), timeout=90)
    except urllib.error.HTTPError as error:
        if error.code == 416 and partial.exists():
            if valid(partial):
                partial.replace(output); return output
            partial.unlink()
            return fetch(item,cache,offline)
        if error.code in (404,410) and item.get('mirrors'):
            return fetch({**item,'url':item['mirrors'][0],'mirrors':item['mirrors'][1:]},cache,offline)
        raise SetupError('ALDER_DOWNLOAD', f'{item["name"]}: HTTP {error.code}. Retry setup; do not change its URL or hash.') from error
    except OSError as error:
        raise SetupError('ALDER_NETWORK', f'{item["name"]}: {error}. Check network/proxy/TLS and retry.') from error
    with response:
        append = start and response.status == 206 and response.headers.get('Content-Range','').startswith(f'bytes {start}-')
        with partial.open('ab' if append else 'wb') as stream:
            shutil.copyfileobj(response, stream, 1024*1024)
    if not valid(partial):
        partial.unlink()
        raise SetupError('ALDER_HASH', f'Download failed checksum: {item["name"]}; retry without bypassing verification.')
    partial.replace(output)
    return output


def safe_name(name, strip=0):
    parts = PurePosixPath(name.replace('\\', '/')).parts
    if any(p == '..' or ':' in p for p in parts) or name.startswith(('/', '\\')):
        raise SetupError('ALDER_ARCHIVE', f'Unsafe archive path: {name}')
    return Path(*parts[strip:]) if len(parts) > strip else None


def extract(archive, destination, strip=0):
    destination = Path(destination); destination.mkdir(parents=True, exist_ok=True)
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as z:
            for member in z.infolist():
                name = safe_name(member.filename, strip)
                if name is None: continue
                output = destination / name
                if not output.resolve().is_relative_to(destination.resolve()):
                    raise SetupError('ALDER_ARCHIVE', 'Archive path escapes destination.')
                if (member.external_attr >> 16) & 0o170000 == 0o120000:
                    raise SetupError('ALDER_ARCHIVE', 'ZIP symlinks are not accepted.')
                if member.is_dir(): output.mkdir(parents=True, exist_ok=True)
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(member) as source, output.open('wb') as target: shutil.copyfileobj(source,target)
                    mode = (member.external_attr >> 16) & 0o777
                    if mode: output.chmod(mode)
    else:
        with tarfile.open(archive) as package:
            members=[]
            for entry in package.getmembers():
                name=safe_name(entry.name, strip)
                if name is None: continue
                entry.name=name.as_posix()
                if entry.islnk():
                    link=safe_name(entry.linkname,strip)
                    if link is None: raise SetupError('ALDER_ARCHIVE','Invalid archive hard link.')
                    entry.linkname=link.as_posix()
                members.append(entry)
            package.extractall(destination, members=members, filter='data')


def gunzip(source, destination):
    destination = Path(destination); destination.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(source,'rb') as src, destination.open('wb') as dst: shutil.copyfileobj(src,dst)
    destination.chmod(0o755)
