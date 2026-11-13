"""Correct rejected drafts from the immutable source, sharing one retry budget."""
from .repair import RepairOutcome, valid_text, grammar_issues
from .revisions import protected_names, unchanged_internal_names, spelling_issues, revision_rejection, complete_spelling
from .invariants import restore_money_notation,narrowed_plural_terms,narrowed_collective_terms
from .lexical_repairs import repaired_names
import re


def finish_legacy(source,draft,config,check_rules,check_model,cancelled,*,rules_available=True):
    """The existing plural/spelling sequence, with its retry consumption explicit."""
    draft=restore_money_notation(source,draft);plural=narrowed_plural_terms(source,draft);used=False
    if plural:
        draft=check_model(source,{**config,'acceptedWords':sorted(set(config['acceptedWords'])|plural),
            'repairReason':'plurality','pluralityTerms':sorted(plural)},cancelled)
        draft=restore_money_notation(source,draft);used=True
    if not rules_available:return RepairOutcome(draft,'rules-unavailable',used)
    audit={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,draft))}
    def retry(*args):
        nonlocal used
        used=True;return check_model(*args)
    result=complete_spelling(draft,audit,check_rules,retry,cancelled,allow_repair=not plural)
    return RepairOutcome(result,'legacy-audited' if result is not None else 'residual-spelling',used)


def finish_recovery(source,draft,config,check_rules,check_model,cancelled):
    """Preserve successful incumbent deliveries; spend only an unused retry.

    In particular, the established plural-restoration request is never replaced
    by a generic review. Grammar warnings cannot rewrite an otherwise accepted
    incumbent delivery. New recovery still passes all source and spelling guards.
    """
    baseline=finish_legacy(source,draft,config,check_rules,check_model,cancelled)
    if cancelled():raise InterruptedError()
    if baseline.text is None:return baseline
    reason=revision_rejection(source,baseline.text,config['acceptedWords'],lexical_repairs=True)
    if reason in (None,'empty-or-unchanged','typography-only'):
        return baseline
    if baseline.repaired:return RepairOutcome(None,reason,True)
    return finish_focused(source,baseline.text,config,check_rules,check_model,cancelled)


def finish_focused(source,draft,config,check_rules,check_model,cancelled,*,review_changed=False):
    if cancelled():raise InterruptedError()
    if not valid_text(draft):return RepairOutcome(None,'invalid-draft')
    draft=restore_money_notation(source,draft)
    reason=revision_rejection(source,draft,config['acceptedWords'],lexical_repairs=True)
    audit_config={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,draft))}
    findings=check_rules(draft,audit_config)
    if cancelled():raise InterruptedError()
    spelling=spelling_issues(draft,findings,audit_config['acceptedWords'])
    grammar=grammar_issues(draft,findings,audit_config)
    plural=narrowed_plural_terms(source,draft)|narrowed_collective_terms(source,draft)
    rejected=reason not in (None,'empty-or-unchanged','typography-only')
    if not (rejected or spelling or grammar or plural or review_changed and draft!=source):
        return RepairOutcome(draft,'audited')
    names=protected_names(source,draft)-repaired_names(source,draft)
    problem=reason if rejected else 'residual-grammar-or-spelling' if spelling or grammar else 'check-residual-errors'
    protected=sorted(set(config['acceptedWords'])|names|plural)
    repaired=check_model(source,{**config,'focusedRepair':True,'originalText':source,'rejectedDraft':draft,
        'guardReason':problem,'protectedSourceTerms':protected,'acceptedWords':protected,
        'revisionMode':'improve','repairPolicyVersion':'focused-source-repair-1'},cancelled)
    if cancelled():raise InterruptedError()
    if not valid_text(repaired):return RepairOutcome(None,'invalid-repair',True)
    repaired=restore_money_notation(source,repaired)
    rejection=revision_rejection(source,repaired,config['acceptedWords'],lexical_repairs=True)
    if rejection not in (None,'empty-or-unchanged','typography-only'):
        return RepairOutcome(None,rejection,True)
    final_config={**config,'acceptedWords':sorted(set(config['acceptedWords'])|unchanged_internal_names(source,repaired))}
    final_findings=check_rules(repaired,final_config)
    if cancelled():raise InterruptedError()
    if spelling_issues(repaired,final_findings,final_config['acceptedWords']):
        return RepairOutcome(None,'residual-spelling',True)
    remaining=grammar_issues(repaired,final_findings,final_config)
    if remaining:return RepairOutcome(None,'residual-grammar',True,remaining_rules=tuple(i['ruleId'] for i in remaining))
    return RepairOutcome(repaired,'focused-repaired',True)
