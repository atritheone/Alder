"""Bounded same-model revision candidate. Not enabled by the incumbent service.

Rules select specific repair requests, not editorial truth. Every final proposal
still passes the original-source guards; manuscripts are never logged here.
"""
from dataclasses import dataclass
import re

from .contracts import slice16, u16
from .invariants import narrowed_plural_terms, restore_money_notation
from .revisions import revision_rejection, spelling_issues, unchanged_internal_names

# Frozen from source/reference diagnostics on the preregistered development
# population, before candidate inference. Ambiguous punctuation/style excluded.
GRAMMAR_RULES = frozenset({'lt:A_NNS','lt:HE_VERB_AGR','lt:PRP_VBG','lt:ITS_TO_IT_S'})
POLICY_VERSION = 'bounded-grammar-repair-1'


@dataclass(frozen=True)
class RepairOutcome:
    text: str | None
    reason: str
    repaired: bool = False
    source_rules: tuple = ()
    draft_rules: tuple = ()
    remaining_rules: tuple = ()


def valid_text(text):
    return isinstance(text,str) and bool(text.strip()) and len(text)<=2400 and not any(c in text for c in '\r\n\t')


def grammar_issues(text, findings, config):
    """Accept only source-bound single-span diagnostics outside protected terms."""
    if config.get('revisionProfile')=='creative':return []
    protected=[]
    for word in config['acceptedWords']:
        if word:
            protected.extend((u16(text,m.start()),u16(text,m.end())) for m in
              re.finditer(r'(?<!\w)'+re.escape(word)+r'(?!\w)',text,re.I))
    result=[]
    for item in findings:
        if item.get('type')!='grammar' or item.get('ruleId') not in GRAMMAR_RULES:continue
        start,end=item.get('start'),item.get('end')
        if type(start) is not int or type(end) is not int or start>=end:continue
        try:quoted=slice16(text,start,end)
        except (ValueError,UnicodeError):continue
        if quoted!=item.get('originalText') or any(left<end and right>start for left,right in protected):continue
        alternatives=[]
        for alternative in item.get('alternatives',[])[:3]:
            edits=alternative.get('edits',[])
            if len(edits)!=1:continue
            edit=edits[0]
            if (edit.get('start')==start and edit.get('end')==end and edit.get('originalText')==quoted
                    and isinstance(edit.get('replacement'),str) and len(edit['replacement'])<=64):
                alternatives.append(edit['replacement'])
        if alternatives:
            result.append({'ruleId':item['ruleId'],'start':start,'end':end,'originalText':quoted,
                'suggestions':alternatives,'message':str(item.get('message',''))[:160]})
    return result


def finish_revision(source, draft, config, check_rules, check_model, cancelled):
    """Postprocess one existing generation; make at most one additional call."""
    if cancelled():raise InterruptedError()
    if not valid_text(draft):return RepairOutcome(None,'invalid-draft')
    draft=restore_money_notation(source,draft)
    plural=narrowed_plural_terms(source,draft)
    rejection=revision_rejection(source,draft,config['acceptedWords'])
    allowed={None,'empty-or-unchanged','typography-only'}
    if plural:allowed.add('plurality-scope-or-event-time')
    if rejection not in allowed:return RepairOutcome(None,rejection)
    audit_config={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,draft))}
    source_findings=check_rules(source,audit_config)
    if cancelled():raise InterruptedError()
    draft_findings=check_rules(draft,audit_config)
    if cancelled():raise InterruptedError()
    source_grammar=grammar_issues(source,source_findings,audit_config)
    grammar=grammar_issues(draft,draft_findings,audit_config)
    spelling=spelling_issues(draft,draft_findings,audit_config['acceptedWords'])
    source_ids=tuple(item['ruleId'] for item in source_grammar)
    draft_ids=tuple(item['ruleId'] for item in grammar)
    if not grammar and not spelling and not plural:
        return RepairOutcome(draft,'audited',source_rules=source_ids,draft_rules=draft_ids)
    spelling_hints=[{'word':item['originalText'][:64],'suggestions':[
        alt['edits'][0]['replacement'][:64] for alt in item.get('alternatives',[])[:3]
        if len(alt['edits'])==1]} for item in spelling[:12]]
    repaired=check_model(draft,{**config,'grammarRepair':True,'originalText':source,
        'languageIssues':grammar[:12],'spellingRepair':bool(spelling_hints),'spellingIssues':spelling_hints,
        'pluralityTerms':sorted(plural),'revisionMode':'improve','repairPolicyVersion':POLICY_VERSION},cancelled)
    if cancelled():raise InterruptedError()
    if not valid_text(repaired):return RepairOutcome(None,'invalid-repair',True,source_ids,draft_ids)
    repaired=restore_money_notation(source,repaired)
    rejection=revision_rejection(source,repaired,config['acceptedWords'])
    if rejection not in {None,'empty-or-unchanged','typography-only'}:
        return RepairOutcome(None,rejection,True,source_ids,draft_ids)
    final_config={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,repaired))}
    final_findings=check_rules(repaired,final_config)
    if cancelled():raise InterruptedError()
    remaining=grammar_issues(repaired,final_findings,final_config)
    if spelling_issues(repaired,final_findings,final_config['acceptedWords']):
        return RepairOutcome(None,'residual-spelling',True,source_ids,draft_ids,tuple(i['ruleId'] for i in remaining))
    if remaining:return RepairOutcome(None,'residual-grammar',True,source_ids,draft_ids,tuple(i['ruleId'] for i in remaining))
    return RepairOutcome(repaired,'repaired',True,source_ids,draft_ids)
