"""Repair only a verified all-zero INT32 GGUF score-array type in a developer copy.

Some candidate exports encode zero tokenizer scores as INT32 although llama.cpp
requires FLOAT32. Zero has identical bits in both formats. No tensor or score
value is changed. The original artifact is retained, and both hashes are recorded.
"""
import argparse
import hashlib
from pathlib import Path
import shutil
import struct
from common import output_path, write


def file_hash(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(4*1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    if file_hash(args.input)!=args.sha256:raise ValueError('Input artifact checksum mismatch.')
    target=output_path(args.output)
    if target.exists() or target==args.input.resolve():raise ValueError('Do not overwrite an artifact.')
    from gguf import GGUFReader, GGUFValueType
    reader=GGUFReader(str(args.input))
    field=reader.fields['tokenizer.ggml.scores']
    if field.types != [GGUFValueType.ARRAY,GGUFValueType.INT32]:raise ValueError('Unsupported tokenizer score representation.')
    if any(int(field.parts[i][0])!=0 for i in field.data):raise ValueError('Nonzero scores cannot use this bit-preserving repair.')
    offset=field.parts[3].ctypes.data-reader.data.ctypes.data
    with args.input.open('rb') as source:
        source.seek(offset)
        if source.read(4)!=struct.pack('<I',int(GGUFValueType.INT32)):raise ValueError('Unexpected metadata position.')
    shutil.copyfile(args.input,target)
    with target.open('r+b') as stream:
        stream.seek(offset);stream.write(struct.pack('<I',int(GGUFValueType.FLOAT32)))
    repaired=GGUFReader(str(target))
    if repaired.fields['tokenizer.ggml.scores'].types != [GGUFValueType.ARRAY,GGUFValueType.FLOAT32]:
        raise ValueError('Repaired metadata did not validate.')
    write(str(target)+'.manifest.json',{'inputSHA256':args.sha256,'outputSHA256':file_hash(target),
      'operation':'INT32 all-zero tokenizer.ggml.scores array type to FLOAT32; only four metadata bytes changed',
      'offset':offset,'input':str(args.input.resolve()),'output':str(target)})


if __name__=='__main__':main()
