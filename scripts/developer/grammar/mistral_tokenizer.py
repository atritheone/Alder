"""Local-only publisher tokenization bridge for a separate developer environment.

No model or tokenizer is fetched. Only prompt tokens and public asset identities
cross this bridge; generated private reasoning never enters this process.
"""
import argparse
import ctypes
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import sys
from common import digest,read


def system_chunks(prompt,instruction):
    if prompt.count('[THINK]')!=1 or prompt.count('[/THINK]')!=1:
        raise ValueError('Unexpected publisher thinking prompt.')
    before,rest=prompt.split('[THINK]');thinking,after=rest.split('[/THINK]')
    if not thinking.strip():raise ValueError('Missing publisher thinking instruction.')
    return [{'type':'text','text':before},
      {'type':'thinking','thinking':thinking,'closed':True},
      {'type':'text','text':after+'\n\n'+instruction}]


def vocabulary_hash(count,piece):
    hasher=hashlib.sha256()
    for identifier in range(count):
        value=piece(identifier)
        hasher.update(len(value).to_bytes(4,'little'));hasher.update(value)
    return hasher.hexdigest()


def gguf_token_bytes(vocabulary,identifier,to_piece):
    """Read complete pieces; the pinned binding's convenience method uses 32 bytes."""
    buffer=ctypes.create_string_buffer(32)
    size=to_piece(vocabulary,identifier,buffer,len(buffer),0,True)
    if size<0:
        if -size>65536:raise ValueError('Unbounded GGUF token piece.')
        buffer=ctypes.create_string_buffer(-size)
        size=to_piece(vocabulary,identifier,buffer,len(buffer),0,True)
    if not 0<=size<=len(buffer):raise ValueError('Incomplete GGUF token piece.')
    return buffer.raw[:size]


def load_assets(directory):
    manifest=read(directory/'artifact-manifest.json')
    if manifest['repo']!='mistralai/Magistral-Small-2509':
        raise ValueError('Unexpected reference tokenizer publisher.')
    for name in ('tekken.json','SYSTEM_PROMPT.txt'):
        content=(directory/name).read_bytes();entry=manifest['files'][name]
        if hashlib.sha256(content).hexdigest()!=entry['sha256'] or len(content)!=entry['size']:
            raise ValueError('Publisher tokenizer assets failed integrity verification.')
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets',type=Path,required=True)
    parser.add_argument('--identity',action='store_true')
    args=parser.parse_args();manifest=load_assets(args.assets)
    from mistral_common.tokens.tokenizers.mistral import MistralTokenizer
    from mistral_common.tokens.tokenizers.base import SpecialTokenPolicy
    from mistral_common.protocol.instruct.messages import SystemMessage,UserMessage
    from mistral_common.protocol.instruct.request import ChatCompletionRequest
    tokenizer=MistralTokenizer.from_file(args.assets/'tekken.json')
    raw=tokenizer.instruct_tokenizer.tokenizer
    if args.identity:
        import mistral_common,tiktoken
        implementation={}
        for package in (mistral_common,tiktoken):
            root=Path(package.__file__).parent
            for path in sorted(root.rglob('*')):
                if path.is_file() and path.suffix in ('.py','.pyd','.dll'):
                    implementation[package.__name__+'/'+path.relative_to(root).as_posix()]=hashlib.sha256(path.read_bytes()).hexdigest()
        result={'protocol':'mistral-reference-tokenizer-v1','assetManifestSHA256':digest(manifest),
          'runtime':{name:version(name) for name in ('mistral-common','tiktoken','pydantic','regex')},
          'implementationSHA256':digest(implementation),'vocabularySize':raw.n_words,
          'vocabularySHA256':vocabulary_hash(raw.n_words,lambda i:raw.id_to_byte_piece(i,special_token_policy=SpecialTokenPolicy.KEEP)),
          'controls':{name:raw.get_control_token(name) for name in ('<s>','</s>','[INST]','[/INST]','[THINK]','[/THINK]')}}
    else:
        payload=json.load(sys.stdin)
        if not isinstance(payload,dict) or set(payload)!={'instruction','data'} or any(not isinstance(v,str) for v in payload.values()):
            raise ValueError('Invalid reference tokenization request.')
        prompt=(args.assets/'SYSTEM_PROMPT.txt').read_text('utf-8')
        request=ChatCompletionRequest(messages=[SystemMessage(content=system_chunks(prompt,payload['instruction'])),
                                                UserMessage(content=payload['data'])])
        tokens=tokenizer.encode_chat_completion(request).tokens
        if not tokens or tokens[-1]!=raw.get_control_token('[/INST]'):
            raise ValueError('Unexpected publisher assistant-generation boundary.')
        result={'tokens':tokens,'assetManifestSHA256':digest(manifest)}
    print(json.dumps(result))


if __name__=='__main__':main()
