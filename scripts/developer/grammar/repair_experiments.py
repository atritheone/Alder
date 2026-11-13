"""Use the existing local proofreader to locate possible errors, never as a judge."""
import difflib
import re
from alder.proofreading.contracts import u16
from alder.proofreading.repair import valid_text,RepairOutcome,grammar_issues
from alder.proofreading.revisions import revision_rejection,unchanged_internal_names,spelling_issues
from alder.proofreading.invariants import restore_money_notation
from alder.proofreading.focused_repair import finish_recovery

POLICY_VERSION='self-located-errors-1'


def error_locations(source,draft):
    if not valid_text(draft):return []
    original=list(re.finditer(r'\w+|[^\w\s]',source))
    revised=list(re.finditer(r'\w+|[^\w\s]',draft))
    matcher=difflib.SequenceMatcher(a=[word.group() for word in original],
        b=[word.group() for word in revised],autojunk=False)
    result=[]
    for operation,start,end,_,_ in matcher.get_opcodes():
        if operation=='equal':continue
        left=original[start].start() if start<len(original) else len(source)
        right=original[end-1].end() if end>start else left
        result.append({'ruleId':'self-located:possible-error','start':u16(source,left),'end':u16(source,right),
            'originalText':source[left:right],
            'message':'A separate local proofreading pass flagged this location. Check spelling and grammar faithfully in context; the hint can be wrong.',
            'suggestions':[]})
    return result[:12]


def locate_and_revise(source,config,check_model,interrupted,cancelled):
    stop=lambda:interrupted() or cancelled()
    if stop():raise InterruptedError()
    first=check_model(source,{**config,'task':'proofread','errorLocationPass':True,
        'repairPolicyVersion':POLICY_VERSION},interrupted)
    if stop():raise InterruptedError()
    if not valid_text(first):return None
    hints=error_locations(source,first)
    if not hints:return source
    result=check_model(source,{**config,'task':'revise','grammarRepair':True,'originalText':source,
        'languageIssues':hints,'repairPolicyVersion':POLICY_VERSION},stop)
    if stop():raise InterruptedError()
    return result


def audit_located(source,draft,config,check_rules,cancelled):
    """The two calls are already spent; audit rather than requesting a third."""
    if cancelled():raise InterruptedError()
    if not valid_text(draft):return RepairOutcome(None,'invalid-draft')
    draft=restore_money_notation(source,draft)
    reason=revision_rejection(source,draft,config['acceptedWords'],lexical_repairs=True)
    if reason not in (None,'empty-or-unchanged','typography-only'):return RepairOutcome(None,reason)
    audit={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,draft))}
    findings=check_rules(draft,audit)
    if cancelled():raise InterruptedError()
    if spelling_issues(draft,findings,audit['acceptedWords']):return RepairOutcome(None,'residual-spelling')
    remaining=grammar_issues(draft,findings,audit)
    if remaining:return RepairOutcome(None,'residual-grammar',remaining_rules=tuple(item['ruleId'] for item in remaining))
    return RepairOutcome(draft,'located-audited')


def finish_grammar_first(source,draft,config,check_rules,check_model,cancelled):
    """Retain complete grammar edits; reserve an unused pass for sentence clarity."""
    draft=restore_money_notation(source,draft)
    reason=revision_rejection(source,draft,config['acceptedWords'],lexical_repairs=True)
    mechanical_only=(valid_text(draft) and re.sub(r'[\W_]+','',source.casefold())==re.sub(r'[\W_]+','',draft.casefold()))
    if not valid_text(draft) or mechanical_only or reason in ('empty-or-unchanged','typography-only'):
        if cancelled():raise InterruptedError()
        revised=check_model(source,{**config,'clarityFallback':True},cancelled)
        return audit_located(source,revised,config,check_rules,cancelled)
    return finish_recovery(source,draft,config,check_rules,check_model,cancelled)
