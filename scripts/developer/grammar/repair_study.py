"""Opt-in same-model grammar repair service for bounded developer comparisons.

The shipping service retains its incumbent policy until a separately reviewed
quality decision. This adapter has no downloads, promotion or manuscript logs.
"""
from dataclasses import asdict
from alder.proofreading.service import ProofreadingService
from alder.proofreading.repair import finish_revision
from alder.proofreading.focused_repair import finish_focused,finish_recovery
from alder.proofreading.revisions import revision
from repair_experiments import locate_and_revise,audit_located,finish_grammar_first


class GrammarRepairService(ProofreadingService):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.revision_trace=[]

    def _generate_revision(self,source,config,interrupted,cancelled):
        return self.model.check(source,config,interrupted)

    def _revision_annotation(self,source,corrected,config):
        return revision(source,corrected,config['acceptedWords'])

    def _finish_revision(self,source,draft,config,cancelled,warnings):
        if not self.resources.capabilities().get('rules',{}).get('available'):
            self.revision_trace.append({'reason':'rules-unavailable','repaired':False})
            return super()._finish_revision(source,draft,config,cancelled,warnings)
        result=finish_revision(source,draft,config,self.rules.check,self.model.check,cancelled)
        self.revision_trace.append(asdict(result))
        if result.text is None and result.reason.startswith(('residual-','invalid-')):
            message='A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'
            if message not in warnings:warnings.append(message)
        return result.text


class FocusedRepairService(GrammarRepairService):
    review_changed=False

    def _revision_annotation(self,source,corrected,config):
        enabled=config.get('revisionProfile')!='creative' and config.get('revisionMode')!='rephrase'
        return revision(source,corrected,config['acceptedWords'],lexical_repairs=enabled)

    def _finish_revision(self,source,draft,config,cancelled,warnings):
        if (config.get('revisionProfile')=='creative' or config.get('revisionMode')=='rephrase'
            or not self.resources.capabilities().get('rules',{}).get('available')):
            return ProofreadingService._finish_revision(self,source,draft,config,cancelled,warnings)
        result=finish_focused(source,draft,config,self.rules.check,self.model.check,cancelled,
                              review_changed=self.review_changed)
        self.revision_trace.append(asdict(result))
        if result.text is None and result.reason.startswith(('residual-','invalid-')):
            message='A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'
            if message not in warnings:warnings.append(message)
        return result.text


class ReviewedRepairService(FocusedRepairService):
    review_changed=True


class RecoveryService(FocusedRepairService):
    def _finish_revision(self,source,draft,config,cancelled,warnings):
        if (config.get('revisionProfile')=='creative' or config.get('revisionMode')=='rephrase'
            or not self.resources.capabilities().get('rules',{}).get('available')):
            return self._finish_legacy_revision(source,draft,config,cancelled,warnings)
        result=finish_recovery(source,draft,config,self.rules.check,self.model.check,cancelled)
        self.revision_trace.append(asdict(result))
        if result.text is None and result.reason.startswith(('residual-','invalid-')):
            warning='A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'
            if warning not in warnings:warnings.append(warning)
        return result.text


class LocatedRepairService(FocusedRepairService):
    def _eligible(self,config):
        return (config.get('revisionProfile')!='creative' and config.get('revisionMode')!='rephrase'
                and self.resources.capabilities().get('rules',{}).get('available',False))

    def _generate_revision(self,source,config,interrupted,cancelled):
        if not self._eligible(config):return super()._generate_revision(source,config,interrupted,cancelled)
        return locate_and_revise(source,config,self.model.check,interrupted,cancelled)

    def _finish_revision(self,source,draft,config,cancelled,warnings):
        if not self._eligible(config):return self._finish_legacy_revision(source,draft,config,cancelled,warnings)
        result=audit_located(source,draft,config,self.rules.check,cancelled)
        self.revision_trace.append(asdict(result))
        if result.text is None and result.reason.startswith(('residual-','invalid-')):
            warning='A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'
            if warning not in warnings:warnings.append(warning)
        return result.text


class GrammarFirstService(RecoveryService):
    def _eligible(self,config):
        return (config.get('revisionProfile')!='creative' and config.get('revisionMode')!='rephrase'
                and self.resources.capabilities().get('rules',{}).get('available',False))

    def _generate_revision(self,source,config,interrupted,cancelled):
        if not self._eligible(config):return super()._generate_revision(source,config,interrupted,cancelled)
        return self.model.check(source,{**config,'task':'proofread','grammarFirstPass':True},interrupted)

    def _finish_revision(self,source,draft,config,cancelled,warnings):
        if not self._eligible(config):return self._finish_legacy_revision(source,draft,config,cancelled,warnings)
        result=finish_grammar_first(source,draft,config,self.rules.check,self.model.check,cancelled)
        self.revision_trace.append(asdict(result))
        if result.text is None and result.reason.startswith(('residual-','invalid-')):
            warning='A sentence proposal was withheld because grammar or spelling could not be verified. Word-level corrections remain available.'
            if warning not in warnings:warnings.append(warning)
        return result.text
