"""Conservative sentence invariants, including malformed contraction inputs.

These recognize explicit forms rather than claiming general semantic equivalence.
A withheld rewrite leaves independent word-level fixes usable.
"""
from collections import Counter
from decimal import Decimal,InvalidOperation
import re

WORD=r'\b[^\W\d_]+\b'
NEGATIVES={"can't":'can not','cant':'can not','cannot':'can not',"won't":'will not','wont':'will not'}
for auxiliary in ('do','does','did','is','are','was','were','has','have','had','would','should','could','must','need'):
    NEGATIVES[auxiliary+"n't"]=auxiliary+' not'
    NEGATIVES[auxiliary+'nt']=auxiliary+' not'

CONTRACTION_REPAIRS={
 'im':("i'm",'i am'),'ive':("i've",'i have'),'id':("i'd",),
 'hes':("he's",),'shes':("she's",),'youre':("you're",'you are'),
 'theyre':("they're",'they are'),'thats':("that's",),'theres':("there's",),
 'whats':("what's",),'whos':("who's",),'wheres':("where's",)}
INITIAL_REPAIRS={'definately':('definitely',),'becuase':('because',),'recieve':('receive',),
                 'occassionally':('occasionally',),'unfortunatly':('unfortunately',)}
INITIAL_FUNCTION_WORDS=set('And But Or Nor Yet So Also Then Now Not Please Yes Yeah Yep Nope Okay OK Well Still Finally Unfortunately Fortunately Actually Certainly Probably Perhaps Indeed Moreover Furthermore Basically Really Sorry Thanks Thank Hello Hi Great Sure'.split())


def negative_forms(value):
    value=value.replace('’',"'").casefold()
    for form,replacement in NEGATIVES.items():
        value=re.sub(r'(?<!\w)'+re.escape(form)+r'(?!\w)',replacement,value)
    for form in ('no one','not anyone','not anybody'):
        value=re.sub(r'\b'+form+r'\b','nobody',value)
    value=re.sub(r'\bnot anything\b','nothing',value)
    value=re.sub(r'\bnot anywhere\b','nowhere',value)
    for form,replacement in (('can not','cannot'),('will not','willnot'),('would not','wouldnot')):
        value=re.sub(r'\b'+form+r'\b',replacement,value)
    return value


def repaired_non_names(source,target):
    """Permit specific lexical repairs; project vocabulary is checked separately."""
    result=set();normalized=target.replace('’',"'").casefold()
    def present(text):return re.search(r'(?<!\w)'+re.escape(text)+r'(?!\w)',normalized) is not None
    for match in re.finditer(WORD,source):
        token=match.group();before=source[:match.start()].rstrip(' \t\"“”‘’')
        initial=not before or before[-1:] in '.!?'
        replacements=CONTRACTION_REPAIRS.get(token.casefold(),())
        if initial:replacements+=INITIAL_REPAIRS.get(token.casefold(),())
        if any(present(replacement) for replacement in replacements):result.add(token)
        if initial and token in INITIAL_FUNCTION_WORDS:result.add(token)
    return result


def source_identifiers(text):
    """Protect source CamelCase names/acronyms in the audit, never new ones."""
    return set(re.findall(r'\b(?:[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]+)+|[A-Z][A-Z0-9]{1,7})\b',text))


def control_literals(text):
    """Native protocol literals are document content, not grammatical words."""
    return re.findall(r'<\|[A-Za-z0-9_:-]{1,80}\|>|<\|(?:turn|channel)>|<(?:turn|channel)\|>|\[/?INST\]|</?(?:s|think)>|<(?:bos|eos|start_of_turn|end_of_turn)>',text)


def restore_money_notation(source,target):
    """Restore source notation only for ordered, equal dollar/euro amounts.

    Bare pounds/yen are deliberately excluded because the words or symbols can
    denote different units/currencies. Country-qualified dollars are excluded as
    well. This never repairs a changed value or guesses a missing currency.
    """
    if not isinstance(target,str):return target
    number=r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?'
    pattern=re.compile(r'(?<![\w.,])(?:[-+−]?[$€]\s*[-+−]?'+number+r'(?!\d|[.,]\d)|[-+−]?'+number+r'\s+(?:dollars?|euros?)\b)',re.I)
    def amounts(text):
        values=[]
        for match in pattern.finditer(text):
            token=match.group()
            # A $ token following US/AU/etc is an explicit country designation.
            if re.search(r'(?:\b(?:us|au|ca|nz|hk|nzd|usd|aud|cad)\s*|[acsn])$',text[:match.start()],re.I):
                return None
            currency='dollar' if '$' in token or re.search(r'\bdollars?\b',token,re.I) else 'euro'
            digits=re.sub(r'[$€\s,]|dollars?|euros?','',token,flags=re.I).replace('−','-')
            try:value=Decimal(digits)
            except InvalidOperation:return None
            values.append((match,currency,value))
        return values
    before,after=amounts(source),amounts(target)
    if not before or not after or [(c,v) for _,c,v in before]!=[(c,v) for _,c,v in after]:return target
    for (original,_,_),(proposed,_,_) in reversed(list(zip(before,after))):
        target=target[:proposed.start()]+original.group()+target[proposed.end():]
    return target


def currency_symbols(text):
    # Single-letter prefixes must touch the symbol: "a $20 fee" is an article.
    # Spaced "us $20" can be a recipient, so only uppercase codes accept a gap.
    pattern=r'(?:(?<!\w)((?:US|AU|CA|NZ|HK|AUD|USD|CAD|NZD)\s+|(?i:US|AU|CA|NZ|HK|A|C|S|AUD|USD|CAD|NZD)))?([$£€¥])'
    aliases={'US':'USD','AU':'AUD','A':'AUD','CA':'CAD','C':'CAD','NZ':'NZD','HK':'HKD','S':'SGD'}
    return [(aliases.get(country.strip().upper(),country.strip().upper()),symbol) for country,symbol in re.findall(pattern,text)]


def narrowed_plural_terms(source,target):
    if not isinstance(target,str):return set()
    before=Counter(re.findall(WORD,source.casefold()));after=Counter(re.findall(WORD,target.casefold()))
    # Each/one are absent: they can require a singular noun correction.
    nouns=re.findall(r'\b(?:the|these|those|some|several|many|all(?:\s+the)?)\s+'
      r'(?:(?:new|old|recent|final|initial|preliminary|unexpected)\s+){0,2}([^\W\d_]+)\b',source,re.I)
    irregular={'children':'child','people':'person','men':'man','women':'woman','teeth':'tooth',
               'feet':'foot','mice':'mouse','geese':'goose','knives':'knife','wives':'wife','leaves':'leaf','lives':'life'}
    uncountable={'news','series','species','means','mathematics','physics','business','analysis','status','gas'}
    narrowed=set()
    for noun in nouns:
        noun=noun.casefold()
        if noun in uncountable or after[noun]>=before[noun]:continue
        singulars={irregular[noun]} if noun in irregular else set()
        if noun.endswith('s') and not noun.endswith(('ss','is','us')):
            singulars.add(noun[:-1])
            if noun.endswith('es'):singulars.add(noun[:-2])
            if noun.endswith('ies'):singulars.add(noun[:-3]+'y')
        if any(after[word]>before[word] for word in singulars):narrowed.add(noun)
    return narrowed


def narrowed_collective_terms(source,target):
    """Group references that became a new individual, separate from inflection."""
    if not isinstance(target,str):return set()
    narrowed=set()
    # Definite substantivised adjectives denote groups even without an -s.
    # Require a clause/adverb boundary; "the young person" and "the poor
    # report" are adjective+noun phrases, not collective source references.
    continuation=r'(?=\s+(?:are|were|is|was|have|has|had|can|could|should|may|might|do|did|will|would|must|still|often|always|never|also|already)\b|\s*[.!?;]|\s*$)'
    for adjective in ('young','elderly','poor','rich','wealthy','unemployed','disabled','homeless'):
        collective=r'\bthe\s+'+adjective+r'\b'+continuation
        singular=r'\b'+adjective+r'\s+(?:person|individual|man|woman|child)\b'
        if (len(re.findall(collective,source,re.I))>len(re.findall(collective,target,re.I))
            and len(re.findall(singular,target,re.I))>len(re.findall(singular,source,re.I))):
            narrowed.add('the '+adjective)
    return narrowed


def narrows_explicit_plural(source,target):
    return bool(narrowed_plural_terms(source,target)|narrowed_collective_terms(source,target))


def changes_known_negation_scope(source,target):
    """Detect moved negation between known predicates, including passive forms."""
    lemmas={}
    for base,past in (('say','said'),('approve','approved'),('reject','rejected'),('agree','agreed'),
                      ('pay','paid'),('know','knew'),('believe','believed'),('claim','claimed'),
                      ('expect','expected'),('permit','permitted'),('receive','received')):
        for form in (base,base+'s',past):lemmas[form]=base
    lemmas.update(known='know',saying='say',approving='approve',rejecting='reject',agreeing='agree',
                  paying='pay',believing='believe',claiming='claim',expecting='expect',permitting='permit',receiving='receive')
    pattern=r'\b(?:not|never|cannot|willnot|wouldnot)\s+(?:(?:be|been|being|have|has|had|to|yet|ever|just|always|often|\w+ly)\s+){0,3}('+ '|'.join(sorted(lemmas,key=len,reverse=True))+r')\b'
    def predicates(text):return Counter(lemmas[word] for word in re.findall(pattern,negative_forms(text)))
    before,after=predicates(source),predicates(target)
    # Unknown constructions supply no evidence. This does not claim an unknown
    # synonym changes meaning simply because the recognized predicate vanished.
    return bool(before and after and before!=after)


def changes_known_past_to_present(source,target):
    """Protect narrow, aligned pronoun events from an invented present tense.

    Mixed tense can be intentional: a sibling attends a school the narrator
    previously attended. Match known finite forms plus two following words so
    another clause's existing present tense cannot justify changing that event.
    Unknown synonyms, subjects and constructions remain outside this heuristic.
    Present-to-past repairs and past-tense agreement repairs remain possible.
    """
    forms={}
    for base,past,present in (
      ('be',('was','were'),('am','is','are')),
      ('go',('went',),('go','goes')),('come',('came',),('come','comes')),
      ('know',('knew',),('know','knows')),('think',('thought',),('think','thinks')),
      ('say',('said',),('say','says')),('take',('took',),('take','takes')),
      ('give',('gave',),('give','gives')),('see',('saw',),('see','sees')),
      ('do',('did',),('do','does')),('have',('had',),('have','has')),
      ('leave',('left',),('leave','leaves')),('feel',('felt',),('feel','feels')),
      ('write',('wrote',),('write','writes')),('send',('sent',),('send','sends')),
      ('pay',('paid',),('pay','pays'))):
        for word in past:forms[word]=(base,'past')
        for word in present:forms[word]=(base,'present')
    pattern=r'\b(i|you|he|she|we|they|it)\s+('+ '|'.join(sorted(forms,key=len,reverse=True))+r')\b'
    def events(text):
        text=negative_forms(text);result={'past':Counter(),'present':Counter()}
        for match in re.finditer(pattern,text):
            base,tense=forms[match[2]]
            tail=re.match(r'(?:\s+'+WORD+r'){0,2}',text[match.end():]).group()
            key=(match[1],base,tuple(re.findall(WORD,tail)))
            result[tense][key]+=1
        return result
    before,after=events(source),events(target)
    return any(after['past'][event]<count and after['present'][event]>before['present'][event]
      for event,count in before['past'].items())
