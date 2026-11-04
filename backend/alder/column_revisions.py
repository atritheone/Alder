"""Column-size reviews preserve logical cell membership in both grids."""
from .paragraph_revisions import paragraph_format


def reviewed_column_widths(rows, fallback):
    """Resolve both explicit and automatic widths before the final grid changes.

    A grid is one decision: partial row edits, conflicting widths and different
    pending authors must not silently become a different original table.
    """
    from .docx_support import table_grid
    columns, placed = table_grid(rows)
    before, after, stamps = {}, {}, {}
    changed = False
    for _, col, _, span, cell in placed:
        attrs = cell.get('attrs', {})
        log = attrs.get('revisionProperties')
        old = paragraph_format(log, True)['attrs'] if log else attrs
        differs = old.get('colwidth') != attrs.get('colwidth')
        changed |= differs
        if differs:
            for record in log['records']:
                if record['status'] == 'pending':
                    stamps[tuple(record['stamp'].get(k, '') for k in ('id', 'author', 'date'))]=record['stamp']
        for target, source in ((before, old), (after, attrs)):
            for offset, width in enumerate(source.get('colwidth') or [0] * span):
                value = round(width * 15) if width else fallback[col + offset]
                if col + offset in target and target[col + offset] != value:
                    if changed or any(c.get('attrs', {}).get('revisionProperties') for *_, c in placed):
                        raise ValueError('Review conflicting widths in the same table column before Word export.')
                target[col + offset] = value
    if not changed:
        return None
    if len(stamps) != 1:
        raise ValueError('Review overlapping column-width changes before Word export to retain each decision.')
    return [before.get(c, fallback[c]) for c in range(columns)],next(iter(stamps.values()))


def unchanged_column_cell(cell,stamp):
    """Snapshot unchanged cells too; otherwise Word invents automatic old widths."""
    appearance={'type':cell['type'],'attrs':{k:v for k,v in cell.get('attrs',{}).items() if k not in ('blockId','revisionProperties','revisionMove','revisionBlock')}}
    return {'base':appearance,'records':[{'stamp':stamp,'status':'pending','before':appearance,'after':appearance}]}
