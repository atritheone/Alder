"""Validated paragraph tab stops; positions are points from the leading edge."""
import math


def validate_tab_stops(stops):
    if not isinstance(stops, list) or len(stops) > 64:
        raise ValueError('Tab stops must be a list of at most 64 stops.')
    previous = 0
    for stop in stops:
        if not isinstance(stop, dict):
            raise ValueError('Each tab stop requires a position, alignment and leader.')
        pos = stop.get('position')
        if type(pos) not in (int, float) or not math.isfinite(pos) or not previous < pos <= 1440:
            raise ValueError('Tab stop positions must be unique, increasing and between 0 and 1440 points.')
        if stop.get('align') not in ('left', 'center', 'right', 'decimal') or stop.get('leader') not in ('none', 'dot', 'dash', 'line'):
            raise ValueError('Unsupported tab stop alignment or leader.')
        previous = pos
    return stops


def write_tabs(props, stops, inherited=()):
    from docx.enum.text import WD_TAB_ALIGNMENT, WD_TAB_LEADER
    from docx.shared import Pt
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    validate_tab_stops(stops)
    # Custom definitions are additive in OOXML. Explicit clears suppress stops
    # inherited from a style before applying the resolved paragraph definition.
    tabs = props._element.get_or_add_pPr().get_or_add_tabs()
    for child in list(tabs): tabs.remove(child)
    for position in inherited:
        child = OxmlElement('w:tab'); child.set(qn('w:val'), 'clear'); child.set(qn('w:pos'), str(round(position * 20))); tabs.append(child)
    align = {'left': WD_TAB_ALIGNMENT.LEFT, 'center': WD_TAB_ALIGNMENT.CENTER, 'right': WD_TAB_ALIGNMENT.RIGHT, 'decimal': WD_TAB_ALIGNMENT.DECIMAL}
    leader = {'none': WD_TAB_LEADER.SPACES, 'dot': WD_TAB_LEADER.DOTS, 'dash': WD_TAB_LEADER.DASHES, 'line': WD_TAB_LEADER.LINES}
    for stop in stops: props.tab_stops.add_tab_stop(Pt(stop['position']), align[stop['align']], leader[stop['leader']])


def read_tabs(props, inherited):
    from docx.oxml.ns import qn
    ppr = props._element.pPr
    tabs = ppr.find(qn('w:tabs')) if ppr is not None else None
    if tabs is None: return inherited
    result = {s['position']: s for s in (inherited or [])}
    for tab in tabs:
        try: position = int(tab.get(qn('w:pos'))) / 20
        except (ValueError, TypeError): continue
        align = tab.get(qn('w:val'))
        if align == 'clear': result.pop(position, None); continue
        align = {'start': 'left', 'end': 'right'}.get(align, align)
        leader = {'none': 'none', 'dot': 'dot', 'hyphen': 'dash', 'underscore': 'line'}.get(tab.get(qn('w:leader'), 'none'))
        if align in ('left', 'center', 'right', 'decimal') and leader and 0 < position <= 1440:
            result[position] = {'position': position, 'align': align, 'leader': leader}
    return sorted(result.values(), key=lambda s: s['position'])[:64]
