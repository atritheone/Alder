"""Paired, narrow lexical repairs; never a general permission to change names."""
import re


def _clause_anchor(text,start):
    clause=re.split(r'[.!?;,:]',text[:start])[-1]
    return re.findall(r'\b[^\W\d_]+\b',clause.casefold())[-2:]


def initial_maybe(source,target):
    pattern=r'^\s*may be\s+(i|you|we|they|he|she|it)\s+(will|would|am|is|are|have|has|was|were|can|could|should|might)\b'
    match=re.match(pattern,source,re.I)
    return bool(match and re.match(r'^\s*maybe\s+'+match[1]+r'\s+'+match[2]+r'\b',target,re.I))


def repaired_names(source,target):
    """Only isolated clause-initial malformed contractions with aligned verbs.

    Explicit accepted vocabulary is still checked independently. Repeated/mixed
    name uses are excluded; ordinary third-person verbs and internal names stay
    protected. These edits are opt-in until the fixed-model study qualifies them.
    """
    result=set();normalized=target.replace('’',"'")
    verbs=r'(?:go|watch|see|send|check|call|try|take|bring|write|help|be|have|leave|wait|meet|start|look|do|make|read)'
    for word,replacement in (('Ill',"I'll"),('Lets',"Let's")):
        if len(re.findall(r'\b'+word+r'\b',source))!=1:continue
        prefix=r'(?:^|(?<=[.!?])\s+|\b(?:Thanks|Well|Okay|Yes|Sure|Hello|Hi),\s+)'
        match=re.search(prefix+word+r'\s+('+verbs+r')\b',source)
        if not match:continue
        repaired=r'(?<!\w)'+re.escape(replacement)+r'\s+'+match[1]+r'\b'
        if len(re.findall(repaired,normalized))-len(re.findall(repaired,source.replace('’',"'")))==1 and not re.search(r'\b'+word+r'\b',target):
            result.add(word)
    if initial_maybe(source,target):
        match=re.match(r'^\s*(may)\b',source,re.I)
        if match and len(re.findall(r'\b'+re.escape(match[1])+r'\b',source))==1:result.add(match[1])
    # A unique malformed quantifier, not an unrestricted capitalised-word fix.
    # The following noun phrase must align; quoted names and mixed name uses
    # retain their original protection. Explicit dictionary entries are checked
    # separately by revision_rejection().
    quantifier=re.search(r'\b[aA]\s+(Lo)\s+of\s+([^\W\d_]+(?:\s+[^\W\d_]+)?)\b',source)
    quotes=r'''"[^"]*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^']*'(?!\w)'''
    if (quantifier and len(re.findall(r'\bLo\b',source))==1 and not re.search(r'\bLo\b',target)
        and not any(match.start()<=quantifier.start()<match.end() for match in re.finditer(quotes,source))):
        paired=r'\ba\s+lot\s+of\s+'+r'\s+'.join(re.escape(word) for word in quantifier[2].split())+r'\b'
        if len(re.findall(paired,target,re.I))-len(re.findall(paired,source,re.I))==1:result.add('Lo')
    return result


def modality_source(source,target):
    """Normalize malformed adverb/negative-quantity forms only with paired evidence."""
    if source.count('?')!=target.count('?'):return source
    if initial_maybe(source,target):source=re.sub(r'^(\s*)may be\b',r'\1maybe',source,count=1,flags=re.I)
    for quantifier in ('much','many','enough'):
        # Limit polarity normalization to the same existential construction and
        # tense. A matching quantity in another participant's claim is not proof.
        pattern=r"\b(theres|there's|there (?:is|are|was|were))\s+no\s+"+quantifier+r'\b((?:\s+[^\W\d_]+){0,2})'
        def replace(match):
            tense=r'there (?:was|were)' if re.search(r'\b(?:was|were)\b',match[1],re.I) else r"(?:there (?:is|are)|there's)"
            paired=r'\b'+tense+r'\s+not\s+'+quantifier+r'\b'+re.escape(match[2])
            aligned=any(_clause_anchor(source,match.start())==_clause_anchor(target,item.start())
                        for item in re.finditer(paired,target,re.I))
            return re.sub(r'\bno\b','not',match[0],count=1,flags=re.I) if aligned else match[0]
        source=re.sub(pattern,replace,source,flags=re.I)
    # One unambiguous possession predicate: "I don't have anything else to do"
    # and "I have nothing else to do" express the same scoped negative. Match
    # subject, tense and the complete remaining clause, not merely a nearby
    # word "nothing". Other have-predicates make the alignment ambiguous.
    if (len(re.findall(r'\b(?:have|has|had)\b',source,re.I))==1
        and len(re.findall(r'\b(?:have|has|had)\b',target,re.I))==1
        and re.findall(r'\b(?:if|unless|when|whenever|because|although|while|since|until|before|after)\b',source.casefold())
            ==re.findall(r'\b(?:if|unless|when|whenever|because|although|while|since|until|before|after)\b',target.casefold())):
        pattern=r'\b(i|you|we|they|he|she|it)\s+(do|does|did)\s+not\s+have\s+anything\b([^.!?;,:]{0,240})(?=[.!?;,:]|$)'
        def possession(match):
            verb='had' if match[2].casefold()=='did' else 'has' if match[1].casefold() in ('he','she','it') else 'have'
            paired=r'\b'+match[1]+r'\s+'+verb+r'\s+nothing\b([^.!?;,:]{0,240})(?=[.!?;,:]|$)'
            tail=' '.join(match[3].split()).casefold()
            if any(' '.join(item[1].split()).casefold()==tail and _clause_anchor(source,match.start())==_clause_anchor(target,item.start())
                   and (source[match.end():match.end()+1]=='?')==(target[item.end():item.end()+1]=='?')
                   for item in re.finditer(paired,target,re.I)):
                return re.sub(r'\bnot\s+have\s+anything\b','have nothing',match[0],count=1,flags=re.I)
            return match[0]
        source=re.sub(pattern,possession,source,flags=re.I)
    return source


def changes_known_direction(source,target):
    """Protect a small set of explicit scalar opposites without generic similarity."""
    pairs=(('closed','open'),('certain','uncertain'),('likely','unlikely'))
    for first,second in pairs:
        for before,after in ((first,second),(second,first)):
            for degree in ('more','less'):
                old=r'\b'+degree+r'\s+'+before+r'\b';new=r'\b'+degree+r'\s+'+after+r'\b'
                if (len(re.findall(old,source,re.I))>len(re.findall(old,target,re.I))
                    and len(re.findall(new,target,re.I))>len(re.findall(new,source,re.I))):return True
    return False
