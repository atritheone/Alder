"""Unrated model outputs cannot enter a claimed matched human-ranking test."""
import importlib
from pathlib import Path
import xml.etree.ElementTree as ET

import pytest


@pytest.fixture
def human(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]/'scripts/developer/grammar'))
    return importlib.import_module('human_rankings')


def test_source_ids_follow_the_published_one_based_inventory(human):
    items=ET.fromstring('<root><ranking-item src-id="1"/><ranking-item src-id="3"/><ranking-item src-id="1"/></root>')
    assert human.source_indices(items,3)=={0,2}


@pytest.mark.parametrize('value',['0','4','invalid'])
def test_unaligned_human_ids_are_rejected(human,value):
    item=ET.Element('ranking-item',{'src-id':value})
    with pytest.raises(ValueError):human.source_indices([item],3)


def test_one_hundred_model_completions_cannot_claim_one_hundred_matched_human_sources(human):
    complete,report=human.matched_sources(range(100),range(100),range(27))
    assert complete==set(range(27)) and report['completeMatchedSources']==27
    assert report['coverage']==.27 and not report['populationAlignmentVerified']
    assert report['sourcesWithoutHumanRankings']==list(range(27,100))


def test_missing_model_decisions_and_missing_gold_both_reduce_coverage(human):
    complete,report=human.matched_sources(range(10),range(8),range(1,10))
    assert complete==set(range(1,8)) and report['coverage']==.7


def test_full_human_eligibility_is_distinct_from_model_completion(human):
    complete,report=human.matched_sources(range(120),range(108),range(120))
    assert len(complete)==108 and report['coverage']==.9 and report['populationAlignmentVerified']


def test_unattempted_completion_is_invalid(human):
    with pytest.raises(ValueError):human.matched_sources({0},{0,1},{0,1})
