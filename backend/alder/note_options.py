"""Document note numbering shared by native Word and Alder's renderer."""
import copy
FORMATS = ('decimal','lowerRoman','upperRoman','lowerLetter','upperLetter')

def note_options(value=None):
    defaults = {'footnote':{'format':'decimal','start':1,'restart':'continuous','placement':'pageBottom'},'endnote':{'format':'lowerRoman','start':1,'restart':'continuous'}}
    if value is None: return defaults
    if not isinstance(value,dict) or set(value)-set(defaults):raise ValueError('Invalid note settings.')
    result=copy.deepcopy(defaults)
    for kind,row in value.items():
        if not isinstance(row,dict) or set(row)-set(defaults[kind]):raise ValueError('Invalid note numbering.')
        result[kind].update(row)
    for kind,row in result.items():
        if row['format'] not in FORMATS or type(row['start']) is not int or not 1<=row['start']<=32767 or row['restart'] not in (('continuous','section','page') if kind=='footnote' else ('continuous','section')):
            raise ValueError('Choose a supported note number format, start and restart rule.')
    if result['footnote']['placement'] not in ('pageBottom','beneathText'):raise ValueError('Invalid footnote placement.')
    return result

def read_word_section_options(document,warnings):
    from docx.oxml.ns import qn
    result=[note_options() for _ in document.sections]
    for kind,row in note_options().items():
        def read(properties,base):
            row=base.copy()
            if properties is None:return row
            def value(key,fallback):
                child=properties.find(qn('w:'+key))
                return child.get(qn('w:val'),fallback) if child is not None else fallback
            number_format=value('numFmt',row['format'])
            start=value('numStart',str(row['start']));restart=value('numRestart',{'section':'eachSect','page':'eachPage'}.get(row['restart'],'continuous'))
            position=value('pos',row.get('placement','docEnd'))
            supported=number_format in FORMATS and start.isdigit() and 1<=int(start)<=32767 and restart in (('continuous','eachSect','eachPage') if kind=='footnote' else ('continuous','eachSect')) and position in (('pageBottom','beneathText') if kind=='footnote' else ('docEnd',))
            if supported:
                row.update(format=number_format,start=int(start),restart={'eachSect':'section','eachPage':'page'}.get(restart,'continuous'))
                if kind=='footnote':row['placement']=position
            else:
                message='Word note numbering or placement was converted to continuous decimal footnotes at page bottoms and Roman endnotes after the document.'
                if message not in warnings:warnings.append(message)
            return row
        baseline=read(document.settings.element.find(qn('w:'+kind+'Pr')),row)
        values=[read(section._sectPr.find(qn('w:'+kind+'Pr')),baseline) for section in document.sections]
        for target,current in zip(result,values):target[kind]=current
    return result


def read_word_options(document,warnings):
    return read_word_section_options(document,warnings)[0]
