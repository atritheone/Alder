"""Developer-only native-template adapter for the unchanged production worker.

The system instruction, service validators, decoding budget and CPU profile stay
the same. Only the verified GGUF's own chat serialization replaces ChatML.
"""
import importlib.util
import hashlib
import json
from pathlib import Path
import re

PREFIX='<|im_start|>system\n'
MIDDLE='<|im_end|>\n<|im_start|>user\n'
SUFFIX='<|im_end|>\n<|im_start|>assistant\n<think>\n</think>\n'


def inert_json(content):
    """Encode literal JSON string values without native chat delimiters."""
    original=json.loads(content)
    escaped=re.sub(r'"(?:\\.|[^"\\])*"',lambda match:match[0].replace('<',r'\u003c').replace('[',r'\u005b'),content)
    if json.loads(escaped)!=original:raise ValueError('Document serialization changed data.')
    return escaped


def messages(prompt):
    if not isinstance(prompt,str) or not prompt.startswith(PREFIX) or not prompt.endswith(SUFFIX):
        raise ValueError('Unexpected production prompt framing.')
    body=prompt[len(PREFIX):-len(SUFFIX)]
    if body.count(MIDDLE)!=1:raise ValueError('Ambiguous production prompt.')
    system,content=body.split(MIDDLE)
    # Escape template delimiter characters inside JSON strings, never the JSON
    # structure. This covers [INST], </s> and ChatML without changing document data.
    return [{'role':'system','content':system},{'role':'user','content':inert_json(content)}]


def render_prompt(formatter,prompt,gemma_nonthinking=False):
    result=formatter(messages=messages(prompt),**({'enable_thinking':False} if gemma_nonthinking else {}))
    if gemma_nonthinking:
        suffixes=('<|turn>model\n','<|turn>model\n<|channel>thought\n<channel|>')
        if (not result.prompt.startswith('<bos><|turn>') or '<|think|>' in result.prompt
            or not result.prompt.endswith(suffixes)):
            raise ValueError('Unverified Gemma non-thinking generation boundary.')
    return result


def verify_gemma_template(metadata,template,expected):
    if (metadata.get('general.architecture')!='gemma4' or not expected
        or hashlib.sha256(template.encode('utf-8')).hexdigest()!=expected):
        raise ValueError('Gemma architecture or publisher template differs from its pin.')


def main(*,gemma_nonthinking=False,template_sha256=None):
    import llama_cpp
    from llama_cpp.llama_chat_format import Jinja2ChatFormatter
    original=llama_cpp.Llama
    class NativeLlama(original):
        def __init__(self,*args,**kwargs):
            self.native_formatter=None
            super().__init__(*args,**kwargs)
            template=self.metadata.get('tokenizer.chat_template')
            if not isinstance(template,str) or not template:raise ValueError('GGUF has no native chat template.')
            if gemma_nonthinking:verify_gemma_template(self.metadata,template,template_sha256)
            self.native_formatter=Jinja2ChatFormatter(template=template,
                eos_token=self.detokenize([self.token_eos()],special=True).decode('utf-8'),
                bos_token=self.detokenize([self.token_bos()],special=True).decode('utf-8'),
                add_generation_prompt=True)

        def native(self,prompt):
            return render_prompt(self.native_formatter,prompt,gemma_nonthinking)

        def tokenize(self,text,*args,**kwargs):
            if self.native_formatter is not None and text.startswith(PREFIX.encode()):
                text=self.native(text.decode('utf-8')).prompt.encode('utf-8')
                return super().tokenize(text,add_bos=False,special=True)
            return super().tokenize(text,*args,**kwargs)

        def __call__(self,prompt,*args,**kwargs):
            formatted=self.native(prompt)
            tokens=super().tokenize(formatted.prompt.encode('utf-8'),add_bos=False,special=True)
            # The production call constrains JSON and uses native EOG handling.
            # Textual EOS strings can also occur literally inside that JSON.
            kwargs.pop('stop',None)
            return super().__call__(tokens,*args,**kwargs)
    llama_cpp.Llama=NativeLlama
    worker=Path(__file__).resolve().parents[3]/'backend/alder/proofreading/worker.py'
    spec=importlib.util.spec_from_file_location('alder_evaluation_production_worker',worker)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.main()


if __name__=='__main__':main()
