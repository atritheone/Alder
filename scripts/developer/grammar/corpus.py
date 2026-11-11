"""Validate a corpus and emit a fingerprinted partition/coverage inventory."""
import argparse
from collections import Counter
from common import corpus, digest, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    data = corpus(args.corpus)
    report = {'status': 'passed', 'corpusSHA256': digest(data), 'cases': len(data['cases']),
              'rights': data['rights'], 'coverage': {key: dict(Counter(c[key] for c in data['cases']))
              for key in ('split', 'track', 'dialect', 'profile')}}
    write(args.output, report)
    print(report)


if __name__ == '__main__':
    main()
