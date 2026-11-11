"""Render tokenized GEC benchmark sentences naturally without changing words.

This is benchmark presentation, not grammar correction. Verify character-level
equivalence (including standard PTB aliases), retain every original pair hash,
and transform the official document map consistently. Never normalize ordinary
user prose or silently discard a newly identical comparison.
"""
import argparse
from collections import Counter,defaultdict
from pathlib import Path
from common import read,records,write,digest,output_path
from conll_documents import compact,source_clusters


def text(value,detokenize):
    if not isinstance(value,str):raise ValueError('Benchmark display text must be a string.')
    result=detokenize(value)
    if compact(result)!=compact(value):raise ValueError('Display normalization changed lexical characters.')
    return result


def pairs(rows,detokenize,unlabelled_ranking_matrix=False):
    output=[];counts=Counter();sources=defaultdict(set)
    for original in rows:
        if 'displayTransformation' in original:raise ValueError('Benchmark pairs are already normalized.')
        if unlabelled_ranking_matrix:
            required={'id','group','split','source','sourceIndex','system','a','b'}
            allowed=required|{'context','dialect','profile'}
            if not required<=original.keys() or original.keys()-allowed or original['split']!='validation' or original['b']!=original['source']:
                raise ValueError('Only an unlabelled source-anchor ranking matrix can retain new display ties.')
            if type(original['sourceIndex']) is not int or original['sourceIndex']<0 or not isinstance(original['system'],str) or not original['system']:
                raise ValueError('Invalid unlabelled ranking cell.')
        row={**original}
        for field in ('source','a','b'):
            row[field]=text(original[field],detokenize);counts[field]+=row[field]!=original[field]
        if 'context' in original:row['context']=text(original['context'],detokenize)
        if 'references' in original:row['references']=[text(value,detokenize) for value in original['references']]
        if row['a']==row['b'] and original['a']!=original['b']:
            if not unlabelled_ranking_matrix:
                raise ValueError('Display normalization made candidates identical; preserve this cohort and reselect explicitly.')
            row['displayEqualityIntroduced']=True;counts['newlyIdenticalComparisons']+=1
        row.update(originalPairSHA256=digest(original),originalGroup=original['group'],group=digest(row['source']),
                   displayTransformation='treebank-display-v1')
        sources[row['source']].add(row['split']);output.append(row)
    if any(len(folds)>1 for folds in sources.values()):raise ValueError('Normalized sources leak across partitions.')
    return output,dict(counts)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pairs',required=True);parser.add_argument('--document-map',required=True)
    parser.add_argument('--output-pairs',required=True);parser.add_argument('--output-map',required=True)
    parser.add_argument('--unlabelled-ranking-matrix',action='store_true',
      help='Retain newly identical source-anchor cells as explicit ties; forbidden for human-labelled pairs')
    args=parser.parse_args()
    import nltk
    from nltk.tokenize.treebank import TreebankWordDetokenizer
    decoder=TreebankWordDetokenizer()
    detokenize=lambda value:decoder.detokenize(value.split(),convert_parentheses=True)
    original=records(args.pairs);normalized,changed=pairs(original,detokenize,args.unlabelled_ranking_matrix)
    mapping=read(args.document_map);sentences=[]
    for sentence in mapping['sentences']:
        value=text(sentence['source'],detokenize)
        sentences.append({**sentence,'originalSourceSHA256':digest(sentence['source']),'source':value,'sourceSHA256':digest(value)})
    mapping={**mapping,'sentences':sentences,'alignmentSHA256':digest(sentences),
      'displayTransformation':{'name':'treebank-display-v1','nltkVersion':nltk.__version__,'parentDocumentMapSHA256':digest(read(args.document_map))}}
    clusters=source_clusters(mapping);folds=defaultdict(set)
    for pair in normalized:folds[pair['split']].add(clusters[digest(pair['source'])])
    if folds['calibration']&folds['validation']:raise ValueError('Normalized document clusters overlap between calibration and validation.')
    target=output_path(args.output_pairs)
    if target.exists() or Path(args.output_map).exists():raise ValueError('Preserve previous benchmark presentations; use new output paths.')
    target.write_text(''.join(__import__('json').dumps(row,ensure_ascii=False)+'\n' for row in normalized),'utf-8')
    write(args.output_map,mapping)
    write(str(target)+'.manifest.json',{'scope':__doc__,'originalPairsSHA256':digest(original),'normalizedPairsSHA256':digest(normalized),
      'cases':len(normalized),'changedFields':changed,'documentMapSHA256':digest(mapping),'nltkVersion':nltk.__version__,
      'unlabelledRankingMatrix':args.unlabelled_ranking_matrix,
      'foldDocumentGroups':{key:len(value) for key,value in folds.items()},'calibrationValidationDocumentOverlap':0})
    print({'cases':len(normalized),'changedFields':changed,'documentOverlap':0})


if __name__=='__main__':main()
