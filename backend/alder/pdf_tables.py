"""ReportLab row break preferences; desktop PDF uses the editor's page map."""
from reportlab.platypus import Table


class RowBreakTable(Table):
    def _splitRows(self, availHeight, doInRowSplit=0):
        if doInRowSplit:
            row = self._getFirstPossibleSplitRowPosition(availHeight, ignoreSpans=1)
            if row < len(self._rowHeights):
                style = self._cellStyles[row][0]
                # Cell styles travel with ReportLab's split rows, including the
                # newly created continuation table and repeated header rows.
                if not getattr(style, 'alderAllowSplit', False):
                    maximum = getattr(style, 'alderPageBodyHeight', float('inf'))
                    headers = range(self.repeatRows) if isinstance(self.repeatRows, int) else self.repeatRows
                    maximum -= sum(self._rowHeights[index] for index in headers)
                    if self._rowHeights[row] <= maximum:
                        return []
        return super()._splitRows(availHeight, doInRowSplit)
