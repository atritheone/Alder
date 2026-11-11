"""Conservative contradictions in explicit named active/passive relations.

This is not a general semantic parser. Unknown verbs, pronouns and ambiguous
structures supply no evidence. Detect only a known relation replaced by its
inverse, including possessive proposals whose owner changes with the agent.
"""
from collections import Counter
import re

VERBS=r'(?:rejected|approved|paid|thanked|called|helped|criticised|criticized|invited|recommended)'
NAME=r'[^\W\d_]+(?:[-][^\W\d_]+)*'
NOUN=r'(?:proposal|report|request|application|recommendation)'


def relations(text, names):
    result=Counter()
    active=rf"\b(?P<agent>{NAME})\s+(?P<verb>{VERBS})\s+(?P<patient>{NAME})(?:['’]s\s+(?P<object>{NOUN}))?\b"
    passive=rf"\b(?P<patient>{NAME})(?:['’]s\s+(?P<object>{NOUN}))?\s+(?:was|were|is|are|has been|had been)\s+(?P<verb>{VERBS})\s+by\s+(?P<agent>{NAME})\b"
    for pattern in (active,passive):
        for match in re.finditer(pattern,text):
            agent,patient=match['agent'],match['patient']
            if agent in names and patient in names and agent!=patient:
                result[(match['verb'],agent,patient,match['object'] or 'person')]+=1
    return result


def reverses_named_roles(source, target, names):
    before,after=relations(source,names),relations(target,names)
    for relation,count in before.items():
        verb,agent,patient,kind=relation
        inverse=(verb,patient,agent,kind)
        if after[relation]<count and after[inverse]>before[inverse]:return True
    return False
