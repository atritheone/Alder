"""Keep model and published human rankings on exactly matched source indices."""


def source_indices(items, source_count):
    result=set()
    for item in items:
        index=int(item.attrib['src-id'])-1
        if not 0<=index<source_count:raise ValueError('Human ranking source id is outside the published inventory.')
        result.add(index)
    return result


def matched_sources(attempted, complete, human):
    attempted=set(attempted);complete=set(complete);human=set(human)
    if not complete<=attempted:raise ValueError('Completed ranking sources were not attempted.')
    matched=complete&human
    return matched,{'attemptedSources':len(attempted),'humanRatedAttemptedSources':len(attempted&human),
        'sourcesWithoutHumanRankings':sorted(attempted-human),'completeMatchedSources':len(matched),
        'coverage':len(matched)/len(attempted) if attempted else 0,
        'populationAlignmentVerified':bool(attempted and attempted<=human)}
