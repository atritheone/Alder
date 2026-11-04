"""Complete, unmerged column boundaries retain one decision across all rows."""
CELLS = ('table_cell', 'table_header')


def validate_column_changes(document):
    owners = {}
    def walk(node):
        if node['type'] == 'table':
            rows = node.get('content', [])
            cells = [(cell, r, c) for r, row in enumerate(rows) for c, cell in enumerate(row.get('content', []))]
            changed = [(cell, r, c) for cell, r, c in cells if cell.get('attrs', {}).get('revisionBlock') or cell.get('attrs', {}).get('revisionMove')]
            if changed:
                from .docx_support import table_grid
                width, placed = table_grid(rows)
                if any(len(row.get('content', [])) != width for row in rows) or any(height != 1 or span != 1 for _, _, height, span, _ in placed) or any(
                    item.get('attrs', {}).get(key) for item in [node, *rows] for key in ('revisionBlock', 'revisionMove', 'revisionProperties')):
                    raise ValueError('Tracked column changes require an unchanged, unmerged surrounding table.')
                groups = {}
                for cell, row, column in changed:
                    attrs = cell['attrs']
                    if attrs.get('revisionMove'): raise ValueError('Individual table cells cannot carry a tracked move.')
                    identity = attrs['revisionBlock']['stamp']['id']
                    if identity in owners and owners[identity] is not node:
                        raise ValueError('A tracked column change must stay within one table.')
                    owners[identity] = node
                    groups.setdefault(identity, []).append((row, column))
                for positions in groups.values():
                    columns = [column for row, column in positions if row == 0]
                    if not columns or len(columns) == width or columns != list(range(columns[0], columns[-1]+1)) or positions != [(row, column) for row in range(len(rows)) for column in columns]:
                        raise ValueError('Review complete consecutive columns across every row, leaving an unchanged column.')
                if len(changed) == len(cells): raise ValueError('A reviewed table must retain an unchanged column.')
        for child in node.get('content', []): walk(child)
    walk(document)
