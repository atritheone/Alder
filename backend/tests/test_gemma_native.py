"""Explicit Gemma non-thinking frames must not constrain a private channel."""
import hashlib
import importlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


def test_gemma_entry_point_loads_its_sibling_in_isolated_python(tmp_path):
    worker=Path(__file__).resolve().parents[2]/'scripts/developer/grammar/gemma_worker.py'
    # Match the supervisor's -I launch: neither cwd nor PYTHONPATH may supply
    # the sibling module. Avoid loading weights or an inference dependency.
    result=subprocess.run([sys.executable,'-I','-c',
        'import runpy,sys; value=runpy.run_path(sys.argv[1]); print(value["TEMPLATE_SHA256"])',
        str(worker)],cwd=tmp_path,capture_output=True,text=True,timeout=15)
    assert result.returncode==0,result.stderr
    assert result.stdout.strip()=='0a2c8073c878ab1da004bee933a998606537bbb62016310352c7285c3f01c5b5'


@pytest.fixture
def native(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    return importlib.import_module('native_worker')


def production_prompt(native):
    return native.PREFIX+'Edit grammar.'+native.MIDDLE+json.dumps({'text':'Literal <|turn> and <channel|> data.'})+native.SUFFIX


@pytest.mark.parametrize('suffix',['<|turn>model\n','<|turn>model\n<|channel>thought\n<channel|>'])
def test_explicit_nonthinking_preserves_publisher_boundaries_and_inert_document(native,suffix):
    def formatter(**kwargs):
        assert kwargs['enable_thinking'] is False
        assert [item['role'] for item in kwargs['messages']]==['system','user']
        content=kwargs['messages'][1]['content']
        assert '<|turn>' not in content and '<channel|>' not in content
        assert json.loads(content)['text']=='Literal <|turn> and <channel|> data.'
        return SimpleNamespace(prompt='<bos><|turn>system\nEdit grammar.<turn|>\n'+suffix)
    assert native.render_prompt(formatter,production_prompt(native),True).prompt.endswith(suffix)


@pytest.mark.parametrize('bad',['<bos><|turn>model\n<|channel>thought\n',
    '<bos><|turn>system\n<|think|><turn|>\n<|turn>model\n','<|turn>model\n'])
def test_open_private_channels_or_missing_bos_are_rejected(native,bad):
    with pytest.raises(ValueError,match='generation boundary'):
        native.render_prompt(lambda **kwargs:SimpleNamespace(prompt=bad),production_prompt(native),True)


def test_other_native_families_keep_their_existing_formatter_arguments(native):
    def formatter(**kwargs):
        assert set(kwargs)=={'messages'}
        return SimpleNamespace(prompt='original family framing')
    assert native.render_prompt(formatter,production_prompt(native)).prompt=='original family framing'


@pytest.mark.parametrize('mutation',['architecture','hash','missing_pin'])
def test_gemma_mode_requires_the_exact_architecture_and_publisher_template(native,mutation):
    template='public fixture';metadata={'general.architecture':'gemma4'}
    expected=hashlib.sha256(template.encode()).hexdigest()
    if mutation=='architecture':metadata['general.architecture']='another-family'
    if mutation=='hash':template+=' changed'
    if mutation=='missing_pin':expected=None
    with pytest.raises(ValueError,match='differs from its pin'):
        native.verify_gemma_template(metadata,template,expected)
