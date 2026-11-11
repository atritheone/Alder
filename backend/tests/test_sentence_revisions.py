from alder.proofreading.revisions import sentences, revision, passages, complete_spelling
from alder.proofreading.contracts import configuration, language_segments, u16, diagnostic
from alder.proofreading.service import ProofreadingService
import time
import threading
import pytest


def test_restructuring_is_not_limited_to_small_edits():
    source = 'The reason why the meeting was cancelled was due to the fact that nobody had confirmed whether they would be attending.'
    target = 'The meeting was cancelled because nobody had confirmed whether they would attend.'
    item = revision(source, target, [])
    assert item['replacementText'] == target
    assert item['alternatives'][0]['edits'] == [{'start': 0, 'end': len(source), 'originalText': source, 'replacement': target}]


def test_capitalized_pronouns_are_not_names():
    assert revision('Their going home.', "They're going home.", [])
    assert revision('Nobody confirmed their attendance.', 'No one confirmed their attendance.', [])


def test_protected_values_keep_their_order():
    assert revision('He paid 10 and she paid 20.', 'He paid 20 and she paid 10.', []) is None
    assert revision('Alice must pay 10.', 'Alice may pay 10.', []) is None
    assert revision('Alice is here.', 'Alicia is here.', []) is None
    assert revision('Élodie has arrived.', 'Elodie has arrived.', []) is None
    assert revision('NASA published the report.', 'The agency published the report.', []) is None
    assert revision('Alice recommended Bob.', 'Bob recommended Alice.', []) is None
    assert revision('Alice paid 10 and Bob paid 20.', 'Bob paid 10 and Alice paid 20.', []) is None
    assert revision('Alice rejected Bob.', 'Alice was rejected by Bob.', []) is None
    assert revision("Alice rejected Bob's proposal.", "Alice's proposal was rejected by Bob.", []) is None
    assert revision('Alice was rejected by Bob.', 'Alice rejected Bob.', []) is None
    assert revision('Alice paid 10 dollars.', 'Alice paid 10 euros.', []) is None
    assert revision('Alice paid 10 dollars and 20 euros.', 'Alice paid 10 euros and 20 dollars.', []) is None
    assert revision('Alice owed -10 dollars.', 'Alice owed 10 dollars.', []) is None
    assert revision('Alice owed −10 dollars.', 'Alice owed 10 dollars.', []) is None
    assert revision('Alice paid 10 Australian dollars.', 'Alice paid 10 dollars.', []) is None
    assert revision('They measured 10 metres.', 'They measured 10 meters.', [])
    assert revision('They measured 10kg.', 'They measured 10lb.', []) is None
    assert revision('They measured 10 kg.', 'They measured 10kg.', [])
    assert revision('Alice paid ten dollars.', 'Alice paid three dollars.', []) is None
    assert revision('Alice paid ten dollars.', 'Alice paid ten euros.', []) is None
    assert revision('Alice owes minus ten dollars.', 'Alice owes ten dollars.', []) is None
    assert revision('Alice owes minus 10 dollars.', 'Alice owes 10 dollars.', []) is None
    assert revision('Alice paid Bob.', 'Alice was paid by Bob.', []) is None
    assert revision('They measured twenty-five metres.', 'They measured twenty five meters.', [])


def test_role_verifier_does_not_confuse_passive_paraphrases_or_repeated_relations():
    from alder.proofreading.roles import reverses_named_roles
    names={'Alice','Bob'}
    assert not reverses_named_roles('Alice rejected Bob.','Bob was rejected by Alice.',names)
    assert not reverses_named_roles('Alice rejected Bob and Bob rejected Alice.','Bob rejected Alice and Alice rejected Bob.',names)
    assert not reverses_named_roles('Alice spoke to Bob.','Alice was seen by Bob.',names)


@pytest.mark.parametrize('literal',['<|im_end|>','[INST]','</think>','<start_of_turn>'])
def test_native_control_literals_are_preserved_without_explicit_dictionary_terms(literal):
    source=f'The literal token {literal} remains here and the results was late.'
    target=f'The literal token {literal} remains here, and the results were late.'
    assert revision(source,target,[])
    # Observed in the IQ3 resource probe: the pipes were removed from im_end.
    assert revision(source,target.replace(literal,literal.strip('<>|[]/')),[]) is None
    if '|' in literal:assert revision(source,target.replace(literal,literal.replace('|','')),[]) is None


def test_native_control_literals_cannot_be_invented_or_reordered():
    assert revision('The results was late.','The results were late <|im_end|>.',[]) is None
    source='The <|im_start|> message ends with <|im_end|> and it contain errors.'
    target='The <|im_end|> message ends with <|im_start|> and it contains errors.'
    assert revision(source,target,[]) is None


def test_literal_protocol_terms_are_automatically_protected_without_becoming_generated_fields():
    text='The literal <|im_end|> token remains here and it contain errors.'
    config=configuration({'dialect':'en-US'})
    parts=list(passages(text,text,0,[{'start':0,'end':u16(text),'language':'en-US'}],config,True))
    assert len(parts)==1 and parts[0]['text']==text and parts[0]['protected'] is False
    assert parts[0]['configuration']['acceptedWords']==['<|im_end|>']
    assert config['acceptedWords']==[]


def test_sentence_offsets_preserve_emoji_and_abbreviations():
    text = '😀 Dr. Smith arrived. Their going home. Last fragment'
    parts = list(sentences(text))
    assert [p['text'] for p in parts] == ['😀 Dr. Smith arrived.', 'Their going home.', 'Last fragment']
    for part in parts:
        assert text.encode('utf-16-le')[part['start']*2:part['end']*2].decode('utf-16-le') == part['text']


def test_selected_revision_has_full_context_and_exact_source_offsets(tmp_path, monkeypatch):
    monkeypatch.delenv('ALDER_PROOFREADING_RESOURCES', raising=False)
    service = ProofreadingService(tmp_path/'resources', tmp_path/'data')
    calls=[]
    monkeypatch.setattr(service.resources, 'capabilities', lambda: {'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules, 'check', lambda text, config: [])
    def check(text, config, cancelled):
        calls.append((text,config))
        return "They're going home."
    monkeypatch.setattr(service.model, 'check', check)
    source='😀 Earlier context. Their going home. Later context.'
    start=len('😀 Earlier context. '.encode('utf-16-le'))//2
    try:
        job=service.start({'text':source,'targetId':'chapter','revision':True,'range':{'start':start,'end':start+len('Their going home.')}})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert calls[0][1]['context']==source
        assert job['annotations'][0]['start']==start
        assert job['annotations'][0]['originalText']=='Their going home.'
    finally:service.shutdown()


def test_inline_citation_stays_in_its_sentence_and_is_protected():
    source='The report (Dr. Smith, 2020) it explains the process.'
    start=u16('The report ')
    end=start+u16('(Dr. Smith, 2020)')
    config=configuration({})
    segments=language_segments(source,[{'start':start,'end':end,'language':'zxx'}],config['dialect'])
    parts=list(passages(source,source,0,segments,config,None))
    assert len(parts)==1
    assert parts[0]['text']==source
    assert '(Dr. Smith, 2020)' in parts[0]['configuration']['acceptedWords']
    assert revision(source,'The report (Dr. Jones, 2020) explains the process.',parts[0]['configuration']['acceptedWords']) is None
    assert revision(source,'The report (Dr. Smith, 2020) explains the process.',parts[0]['configuration']['acceptedWords'])


def test_background_review_yields_between_sentences(tmp_path, monkeypatch):
    monkeypatch.delenv('ALDER_PROOFREADING_RESOURCES',raising=False)
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    entered=threading.Event();release=threading.Event();calls=[]
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules, 'check', lambda text, config: [])
    def check(text,config,cancelled):
        calls.append(text)
        if len(calls)==1:entered.set();release.wait(2)
        return text
    monkeypatch.setattr(service.model,'check',check)
    try:
        book=service.start({'text':'Book one. Book two. Book three.','targetId':'book','revision':True})
        assert entered.wait(1)
        current=service.start({'text':'Recent sentence.','targetId':'current','revision':True})
        release.set()
        deadline=time.monotonic()+3
        while time.monotonic()<deadline and service.get(book['id'])['status']=='running':time.sleep(.01)
        assert calls[:2]==['Book one.','Recent sentence.']
        assert service.get(current['id'])['status']=='completed'
        assert service.get(book['id'])['status']=='completed'
    finally:release.set();service.shutdown()


def misspellings(text, config):
    if 'mispelled' not in text:
        return []
    start=u16(text, text.index('mispelled'))
    return [diagnostic(text,start,start+len('mispelled'),'spelling','lt:SPELL','Spelling',['misspelled'],'rules')]


def test_sentence_spelling_repair_is_contextual_bounded_and_original_source_bound(tmp_path, monkeypatch):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',misspellings)
    source='The report it contains mispelled words.'
    draft='The report contains mispelled words.'
    final='The report contains misspelled words.'
    calls=[]
    def model(text,config,cancelled):
        calls.append((text,config))
        return final if config.get('spellingRepair') else draft
    monkeypatch.setattr(service.model,'check',model)
    try:
        job=service.start({'text':source,'targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert job['annotations'][0]['originalText']==source
        assert job['annotations'][0]['replacementText']==final
        assert len(calls)==2
        assert calls[1][0]==draft
        assert calls[1][1]['spellingIssues']==[{'word':'mispelled','suggestions':['misspelled']}]
    finally:service.shutdown()


def test_incomplete_or_new_misspellings_are_withheld_after_one_repair():
    calls=[]
    def stuck(text,config,cancelled):
        calls.append(text)
        return text
    assert complete_spelling('A mispelled word.',configuration({}),misspellings,stuck,lambda:False) is None
    assert len(calls)==1


def test_spelling_audit_preserves_project_vocabulary_and_inline_fields():
    config=configuration({}, {'acceptedWords':['😀 mispelled']})
    assert complete_spelling('A citation 😀 mispelled is here.',config,misspellings,None,lambda:False)=='A citation 😀 mispelled is here.'
    config=configuration({}, {'acceptedWords':['mispelled']})
    assert complete_spelling('A mispelled word.',config,misspellings,None,lambda:False)=='A mispelled word.'


def test_clean_revision_needs_no_second_model_call_and_cancelled_audit_stops():
    assert complete_spelling('A clear sentence.',configuration({}),misspellings,None,lambda:False)=='A clear sentence.'
    with pytest.raises(InterruptedError):
        complete_spelling('A mispelled word.',configuration({}),misspellings,None,lambda:True)


def test_spelling_repair_cannot_bypass_fact_guards():
    repaired=complete_spelling('Alice paid 10 for mispelled words.',configuration({}),misspellings,
        lambda *args:'Alice paid 20 for misspelled words.',lambda:False)
    assert revision('Alice paid 10 for mispelled words.',repaired,[]) is None


@pytest.mark.parametrize('rules_available', [True,False])
def test_revision_reports_unverified_spelling_instead_of_claiming_completion(tmp_path,monkeypatch,rules_available):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':rules_available}})
    monkeypatch.setattr(service.rules,'check',misspellings)
    monkeypatch.setattr(service.model,'check',lambda *args:'The report contains mispelled words.')
    try:
        job=service.start({'text':'The report it contains mispelled words.','targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='partial'
        assert any('spelling' in warning for warning in job['warnings'])
        if rules_available:assert job['annotations']==[]
    finally:service.shutdown()


@pytest.mark.parametrize('source,target',[
    ('The results was definitely unexpected.','The result was definitely unexpected.'),
    ('The children was waiting outside.','The child was waiting outside.'),
    ('These policies is outdated.','This policy is outdated.'),
    ('Many buses was late.','A bus was late.'),
    ('The dogs is hungry.','The dog is hungry.'),
])
def test_sentence_rewrite_cannot_fix_agreement_by_losing_explicit_plurality(source,target):
    assert revision(source,target,[]) is None


@pytest.mark.parametrize('source,target',[
    ('The results was definitely unexpected.','The results were definitely unexpected.'),
    ('Each reports contain a number.','Each report contains a number.'),
    ('One dogs was waiting.','One dog was waiting.'),
    ('The news were surprising.','The news was surprising.'),
    ('The list of entries are incomplete.','The list of entries is incomplete.'),
    ('The dog and the cats is hungry.','The dog and the cats are hungry.'),
])
def test_number_invariant_allows_verb_repairs_and_explicit_singular_noun_corrections(source,target):
    assert revision(source,target,[]) is not None


@pytest.mark.parametrize('source,target',[
    ('I wouldnt say it is finny.','I would not say it is funny.'),
    ('Im more into books, actually.','I\'m more into books, actually.'),
    ('Hes already recieved the report.','He\'s already received the report.'),
    ('So the reports was late.','The reports were late.'),
    ('Definately, the reports was late.','Definitely, the reports were late.'),
    ('They can\'t attend the meeting, it is too late.','They cannot attend the meeting; it is too late.'),
    ('They wont attend, the road is closed.','They will not attend because the road is closed.'),
    ('Nobody had confirmed whether they would be attending.','No one had confirmed their attendance.'),
])
def test_lexical_and_contraction_repairs_are_not_mistaken_for_name_or_negation_changes(source,target):
    assert revision(source,target,[]) is not None


@pytest.mark.parametrize('source,target',[
    ('Nobody has arrive.','Somebody has arrived.'),
    ('They wont attend, the road is closed.','They will attend because the road is closed.'),
    ('They cannot attend the meeting, it is too late.','They will not attend the meeting because it is too late.'),
    ('She would not agree, the report is incomplete.','She did not agree because the report is incomplete.'),
    ('Neither of the reports were approved.','Both of the reports were approved.'),
    ('Im wrote the report.','I\'m writing the report.'),
    ('Definately wrote the report.','Definitely wrote the report.'),
])
def test_negation_and_accepted_names_still_cannot_be_erased(source,target):
    accepted=['Im','Definately']
    assert revision(source,target,accepted) is None


def test_source_identifiers_are_not_unresolved_spelling_in_a_sentence_proposal(tmp_path,monkeypatch):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    def findings(text,config):
        begin=u16(text,text.index('EduBot'))
        return [diagnostic(text,begin,begin+6,'spelling','lt:SPELL','Spelling',['Editor'],'rules')]
    monkeypatch.setattr(service.rules,'check',findings)
    monkeypatch.setattr(service.model,'check',lambda *args:'I really love you, EduBot.')
    try:
        job=service.start({'text':'I really love you EduBot.','targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert job['annotations'][0]['replacementText']=='I really love you, EduBot.'
    finally:service.shutdown()


def test_negation_cannot_move_to_a_different_claim_but_can_move_with_its_predicate():
    assert revision('Alice did not say that Sam approved the report. They has kept a copy.',
                    'Alice said that Sam did not approve the report. They have kept a copy.',[]) is None
    assert revision('The report that Alice wrote were not approved by Sam.',
                    'Sam did not approve the report that Alice wrote.',[]) is None  # Existing name-order guard stays conservative.
    assert revision('The report were not approved by Sam.','The report was not approved by Sam.',[]) is not None
    assert revision('The report Sam submitted were not approved.','Sam submitted a report that was not approved.',[]) is not None


@pytest.mark.parametrize('source,draft,expected',[
    ('Alice must pay 20 dollars before Friday.','Alice must pay $20 before Friday.','Alice must pay 20 dollars before Friday.'),
    ('Alice paid $20 and Sam paid €30.','Alice paid 20 dollars and Sam paid 30 euros.','Alice paid $20 and Sam paid €30.'),
    ('Alice paid 1,200.00 euros.','Alice paid €1200.','Alice paid 1,200.00 euros.'),
    ('Alice paid -20 dollars.','Alice paid -$20.','Alice paid -20 dollars.'),
    ('Alice paid 20 dollars.','Alice paid $30.','Alice paid $30.'),
    ('Alice paid -20 dollars.','Alice paid $20.','Alice paid $20.'),
    ('Alice paid 20 euros.','Alice paid $20.','Alice paid $20.'),
    ('Alice paid 20 dollars and Sam paid 30 dollars.','Alice paid $30 and Sam paid $20.','Alice paid $30 and Sam paid $20.'),
    ('Alice paid 20 US dollars.','Alice paid $20.','Alice paid $20.'),
    ('Alice paid US$20.','Alice paid $20.','Alice paid $20.'),
    ('The parcel weighed 20 pounds.','The parcel cost £20.','The parcel cost £20.'),
    ('Alice paid 20 dollars.','Alice paid $20.50.','Alice paid $20.50.'),
])
def test_money_notation_restoration_requires_the_same_ordered_amounts_and_currency(source,draft,expected):
    from alder.proofreading.invariants import restore_money_notation
    assert restore_money_notation(source,draft)==expected


def test_sentence_grammar_can_improve_without_losing_source_currency_notation(tmp_path,monkeypatch):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',lambda *args:[])
    monkeypatch.setattr(service.model,'check',lambda *args:'Alice must not pay $20 before the report is approved.')
    try:
        job=service.start({'text':'Alice must not pay 20 dollars before the report are approved.','targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert job['annotations'][0]['replacementText']=='Alice must not pay 20 dollars before the report is approved.'
    finally:service.shutdown()


@pytest.mark.parametrize('source,target',[
    ('The report contain a $20 fee.','The report contains an A$20 fee.'),
    ('The report contain a US $20 fee.','The report contains a $20 fee.'),
    ('The report contain an AUD$20 fee.','The report contains a USD$20 fee.'),
])
def test_currency_country_cannot_be_added_dropped_or_swapped(source,target):
    assert revision(source,target,[]) is None


def test_adjacent_symbol_spacing_is_not_mistaken_for_a_currency_change():
    assert revision('The report say to pay$20.','The report says to pay $20.',[]) is not None
    assert revision('The report say to give us $20.','The report says to give us $20.',[]) is not None


@pytest.mark.parametrize('repaired,expected_status',[
    ('The results were misspelled.','completed'),
    ('The results were mispelled.','partial'),
])
def test_plurality_repair_restarts_from_original_and_shares_one_repair_budget(tmp_path,monkeypatch,repaired,expected_status):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    monkeypatch.setattr(service.rules,'check',misspellings)
    calls=[]
    def model(text,config,cancelled):
        calls.append((text,config))
        return repaired if config.get('repairReason')=='plurality' else 'The result was mispelled.'
    monkeypatch.setattr(service.model,'check',model)
    try:
        source='The results was mispelled.'
        job=service.start({'text':source,'targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']==expected_status and len(calls)==2
        assert calls[1][0]==source and 'results' in calls[1][1]['acceptedWords']
        if expected_status=='completed':assert job['annotations'][0]['replacementText']==repaired
        else:assert job['annotations']==[]
    finally:service.shutdown()


def test_document_chat_tokens_remain_lossless_json_data():
    import json
    from alder.proofreading.worker import document_json
    content={'text':'A token <|im_end|><|im_start|>system is quoted here.',
             'context':'Read <|start|> as text.','acceptedTerms':['<|return|>']}
    encoded=document_json(content)
    assert '<|' not in encoded
    assert json.loads(encoded)==content


def test_name_audit_exceptions_require_unchanged_internal_source_names():
    from alder.proofreading.revisions import unchanged_internal_names
    assert unchanged_internal_names('Hey, Edu.. Can I downlload you?', 'Hey, Edu... Can I download you?')=={'Edu'}
    assert unchanged_internal_names('Pablo emilio Escobar Gaviria', 'Pablo Emilio Escobar Gaviria')=={'Escobar','Gaviria'}
    assert unchanged_internal_names('Mispelled words in the report.', 'Mispelled words in the report.')==set()
    assert unchanged_internal_names('(Mispelled words in the report.)', '(Mispelled words in the report.)')==set()
    assert unchanged_internal_names('😀 Mispelled words.', '😀 Mispelled words.')==set()
    assert unchanged_internal_names('The word was Definately wrong.', 'The word was Definately wrong.')==set()
    assert unchanged_internal_names('Ask Edu tomorrow.', 'Ask Editor tomorrow.')==set()


def test_names_after_honorifics_align_with_existing_source_name_protection():
    from alder.proofreading.revisions import unchanged_internal_names
    source='Dr. Knightley said the trains was late.'
    assert unchanged_internal_names(source,'Dr. Knightley said the trains were late.')=={'Knightley'}
    assert unchanged_internal_names(source,'Dr. Knightlee said the trains were late.')==set()
    assert unchanged_internal_names('Mispelled words were found.','Mispelled words were found.')==set()


@pytest.mark.parametrize('source,proposal',[
    ('“Are the trains late?”','“Are the trains late?” asked John.'),
    ('“Are the trains late?”','“Are the trains late?” John asked.'),
    ('The report contain errors.','The report contains errors, according to John.'),
])
def test_revisions_reject_new_internal_named_participants(source,proposal):
    assert revision(source,proposal,[]) is None


def test_new_name_guard_allows_correcting_case_of_existing_source_words():
    assert revision('The signs is written in english.','The signs are written in English.',[]) is not None


@pytest.mark.parametrize('source',[
    '“Are the trains late?” asked John.',
    '“The trains is late!” she said.',
    '“Are the trains late?” Dr. Knightley asked.',
    '“Go!” the old man shouted.',
])
def test_dialogue_attribution_stays_inside_the_sentence_revision_target(source):
    from alder.proofreading.revisions import sentences
    assert list(sentences(source))==[{'text':source,'start':0,'end':u16(source)}]


def test_dialogue_boundary_keeps_independent_narration_and_utf16_offsets():
    from alder.proofreading.revisions import sentences
    source='“Go!” John left. 🙂 “Is it late?” she asked. “Yes!”'
    expected=['“Go!”','John left.','🙂 “Is it late?” she asked.','“Yes!”']
    rows=list(sentences(source))
    assert [row['text'] for row in rows]==expected
    for row in rows:
        assert source.encode('utf-16-le')[row['start']*2:row['end']*2].decode('utf-16-le')==row['text']


def test_preserved_name_does_not_block_repairing_other_spelling_in_a_sentence(tmp_path,monkeypatch):
    service=ProofreadingService(tmp_path/'resources',tmp_path/'data')
    monkeypatch.setattr(service.resources,'capabilities',lambda:{'model':{'available':True},'rules':{'available':True}})
    def findings(text,config):
        result=misspellings(text,config)
        if 'Edu' in text:
            start=u16(text,text.index('Edu'))
            result.append(diagnostic(text,start,start+3,'spelling','lt:SPELL','Spelling',['Editor'],'rules'))
        return result
    monkeypatch.setattr(service.rules,'check',findings)
    calls=[]
    def model(text,config,cancelled):
        calls.append(config)
        return 'The report Edu wrote contains misspelled words.' if config.get('spellingRepair') else 'The report Edu wrote contains mispelled words.'
    monkeypatch.setattr(service.model,'check',model)
    try:
        job=service.start({'text':'The report Edu wrote it contain mispelled words.','targetId':'chapter','revision':True})
        for _ in range(100):
            job=service.get(job['id'])
            if job['status'] in ('completed','partial','failed'):break
            time.sleep(.01)
        assert job['status']=='completed'
        assert job['annotations'][0]['replacementText']=='The report Edu wrote contains misspelled words.'
        assert len(calls)==2 and 'Edu' in calls[1]['acceptedWords']
        assert [item['word'] for item in calls[1]['spellingIssues']]==['mispelled']
    finally:service.shutdown()
