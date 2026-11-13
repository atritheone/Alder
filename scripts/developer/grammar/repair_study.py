"""Opt-in same-model grammar repair service for bounded developer comparisons.

The shipping service retains its incumbent policy until a separately reviewed
quality decision. This adapter has no downloads, promotion or manuscript logs.
"""
from dataclasses import asdict
from alder.proofreading.service import ProofreadingService
from alder.proofreading.repair import finish_revision


class GrammarRepairService(ProofreadingService):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.revision_trace=[]

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
