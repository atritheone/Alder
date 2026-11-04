from alder.table_formatting import repeating_header_rows


def test_only_closed_header_prefix_repeats():
    def header(span=1):return {'type':'table_header','attrs':{'rowspan':span}}
    def body():return {'type':'table_cell'}
    def rows(*items):return [{'content':cells} for cells in items]
    assert repeating_header_rows(rows([header(2),header()],[header()],[body(),body()]))==2
    assert repeating_header_rows(rows([header(2),header()],[body()],[body(),body()]))==0
    assert repeating_header_rows(rows([header(),header()],[header(2),header()],[body()],[body(),body()]))==1
    assert repeating_header_rows(rows([header(),header()]))==0
