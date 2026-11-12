"""Developer-only, local GECToR hints; never apply tags directly to a document.

The publisher's .6 sentence/tag thresholds and exclusion of case-only edits are
fixed before inference. A tag is fallible context for the existing sentence
editor, not independent approval or a guarantee that a correction is needed.
"""
import hashlib
from importlib.metadata import version
import math
from pathlib import Path
import re
from common import digest,read

REPO='deepquillapp/gector-grammar'
REVISION='2232e0ef109dd12e11e2c74b565b7318e36379e4'
MODEL_SHA256='c8ce4fcc952f33d399cd668e200527f28b94136b61bec24d7852504d5c7c53e9'
FILES=('README.md','labels.json','model.onnx','tokenizer.json','verb-form-vocab.txt')


def verify_assets(directory):
    directory=Path(directory).resolve();manifest=read(directory/'artifact-manifest.json')
    if manifest.get('repo')!=REPO or manifest.get('revision')!=REVISION:
        raise ValueError('Unexpected tagging checkpoint origin.')
    if manifest.get('files',{}).get('model.onnx',{}).get('sha256')!=MODEL_SHA256:
        raise ValueError('Unexpected tagging model checksum.')
    for name in FILES:
        entry=manifest['files'].get(name,{})
        content=(directory/name).read_bytes()
        if len(content)!=entry.get('size') or hashlib.sha256(content).hexdigest()!=entry.get('sha256'):
            raise ValueError('Tagging asset failed integrity verification: '+name)
    return manifest


def word_spans(text):
    # This is whitespace pretokenization as required by the export. Keep exact
    # character offsets; never rejoin tokens to manufacture a document rewrite.
    return [(m.start(),m.end(),m.group()) for m in re.finditer(r'\S+',text)]


def first_subtokens(word_ids,word_count):
    first={};previous=-1
    for index,word in enumerate(word_ids):
        if word is None:continue
        if type(word) is not int or not 0<=word<word_count or word<previous:
            raise ValueError('Invalid tagger subtoken alignment.')
        previous=word;first.setdefault(word,index)
    if set(first)!=set(range(word_count)):
        raise ValueError('Incomplete tagger subtoken alignment; truncation is forbidden.')
    return [first[word] for word in range(word_count)]


def verb_forms(content):
    forms={}
    for line in content.splitlines():
        pair,separator,tags=line.rpartition(':')
        source,underscore,target=pair.partition('_');before,join,after=tags.partition('_')
        if not separator or not underscore or not join or not source or not target:
            raise ValueError('Invalid tagging verb-form table.')
        forms.setdefault((source,before,after),set()).add(target)
    return forms


def suggestion(word,tag,forms):
    if tag.startswith('$REPLACE_'):return tag[len('$REPLACE_'):]
    if tag=='$DELETE':return ''
    if tag.startswith('$APPEND_'):return word+' '+tag[len('$APPEND_'):]
    if tag.startswith('$TRANSFORM_VERB_'):
        parts=tag[len('$TRANSFORM_VERB_'):].split('_')
        if len(parts)==2:
            values=forms.get((word,*parts),set())
            if len(values)==1:return next(iter(values))
    # Do not invent inflections for irregular nouns or unknown transformations.
    return None


def decode_tags(text,labels,word_ids,label_probs,error_probs,forms,threshold=.6):
    spans=word_spans(text);indices=first_subtokens(word_ids,len(spans)+1)
    if len(label_probs)!=len(word_ids) or len(error_probs)!=len(word_ids):
        raise ValueError('Tagger output length differs from its input.')
    for probabilities,error in zip(label_probs,error_probs):
        if len(probabilities)!=len(labels) or not math.isfinite(error) or not 0<=error<=1:
            raise ValueError('Invalid tagger output shape or error probability.')
        if any(not math.isfinite(value) or not 0<=value<=1 for value in probabilities):
            raise ValueError('Invalid tagger label probabilities.')
    # The sentence detection threshold is evaluated at aligned word positions,
    # including the publisher's $START pseudo-word, never padding or delimiters.
    if max((error_probs[index] for index in indices),default=0)<threshold:return []
    hints=[]
    for word_index,(start,end,word) in enumerate(spans,1):
        index=indices[word_index];probabilities=label_probs[index]
        label=max(range(len(labels)),key=probabilities.__getitem__);tag=labels[label]
        if probabilities[label]<threshold or tag in ('$KEEP','<OOV>','<PAD>') or tag.startswith('$TRANSFORM_CASE_'):continue
        replacement=suggestion(word,tag,forms)
        hints.append({'start':start,'end':end,'originalText':word,'type':'grammar',
          'message':'Fallible local tagger hint: '+tag,'tag':tag,'probability':probabilities[label],
          'alternatives':[{'edits':[{'replacement':replacement}]}] if replacement is not None else []})
    return hints


class Tagger:
    def __init__(self,directory):
        directory=Path(directory).resolve();manifest=verify_assets(directory)
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.np=np;self.tokenizer=Tokenizer.from_file(str(directory/'tokenizer.json'))
        # Disable any checkpoint-side truncation/padding. Longer inputs abstain.
        self.tokenizer.no_truncation();self.tokenizer.no_padding()
        spec=read(directory/'labels.json')
        if spec.get('keep_label')!='$KEEP' or spec['labels'][-1]!='<PAD>' or spec.get('max_length')!=80:
            raise ValueError('Unexpected tagging export contract.')
        self.labels=spec['labels'][:-1];self.maximum=spec['max_length']
        self.forms=verb_forms((directory/'verb-form-vocab.txt').read_text('utf8'))
        options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
        self.session=ort.InferenceSession(str(directory/'model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
        if [item.name for item in self.session.get_inputs()]!=['input_ids','attention_mask']:
            raise ValueError('Unexpected tagging model inputs.')
        if [item.name for item in self.session.get_outputs()]!=['label_probs','error_probs']:
            raise ValueError('Unexpected tagging model outputs.')
        self.identity={'protocol':'alder-gector-hints-v1','assetManifestSHA256':digest(manifest),
          'runtime':{name:version(name) for name in ('onnxruntime','tokenizers','numpy')},
          'provider':'CPUExecutionProvider','threads':2,'threshold':.6,'maxTokens':80,
          'caseOnlyTags':'excluded','longInputs':'abstain; never truncate','passes':1}

    def hints(self,text):
        words=word_spans(text)
        encoded=self.tokenizer.encode(['$START',*[word for _,_,word in words]],is_pretokenized=True)
        first_subtokens(encoded.word_ids,len(words)+1)
        if len(encoded.ids)>self.maximum:
            return {'status':'abstain','reason':'TokenBudgetExceeded','hints':[]}
        np=self.np
        labels,errors=self.session.run(None,{'input_ids':np.array([encoded.ids],dtype=np.int64),
          'attention_mask':np.array([encoded.attention_mask],dtype=np.int64)})
        if labels.shape!=(1,len(encoded.ids),len(self.labels)) or errors.shape!=(1,len(encoded.ids)):
            raise ValueError('Unexpected tagging output dimensions.')
        hints=decode_tags(text,self.labels,encoded.word_ids,labels[0].tolist(),errors[0].tolist(),self.forms)
        return {'status':'completed','hints':hints}
