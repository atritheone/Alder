"""Definition cards based on the author's Voyager reference.

The same measured layout drives PNG, JPEG and vector PDF outputs using Alder's
supplied Sitka Text faces; no installed font is needed.
"""
from __future__ import annotations

import io
import math
import os
from pathlib import Path
import re
import uuid


def font_directory() -> Path:
    configured = os.environ.get("ALDER_RESOURCES_DIR")
    root = Path(configured) if configured else Path(__file__).resolve().parents[2] / "work/bundle-resources"
    directory = root / "fonts"
    if not all((directory / f"LiberationSerif-{style}.ttf").is_file() for style in ("Regular", "Bold", "Italic")):
        raise RuntimeError("Alder's bundled definition-card fonts are missing. Repair the Alder installation.")
    return directory


def _entry(value):
    if not isinstance(value, dict):
        raise ValueError("A definition card needs a word, pronunciation, part of speech and definition.")
    result = {}
    for field, limit in (("word", 120), ("ipa", 240), ("partOfSpeech", 120), ("definition", 5000)):
        text = value.get(field, "")
        if not isinstance(text, str):
            raise ValueError(f"The {field} field must be text.")
        text = text.strip()
        if len(text) > limit:
            raise ValueError(f"The {field} field is too long (maximum {limit} characters).")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", text):
            raise ValueError("Definition cards cannot contain control characters.")
        if field != "definition" and ("\n" in text or "\r" in text):
            raise ValueError(f"The {field} field must fit on one line.")
        result[field] = text
    if not result["word"] or not result["definition"]:
        raise ValueError("Enter both a headword and a definition before exporting.")
    return result


def _dimension(value, name):
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer between 256 and 4096.") from None
    if number < 256 or number > 4096:
        raise ValueError(f"{name} must be between 256 and 4096 pixels.")
    return number


def _wrap(text, measure, width):
    lines = []
    for paragraph in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        current = ""
        for word in paragraph.split():
            if measure((current + " " + word).strip()) <= width:
                current = (current + " " + word).strip()
                continue
            if current:
                lines.append(current)
                current = ""
            # A long coined word or URL must not escape the right margin.
            while measure(word) > width:
                split = len(word)-1
                while split > 1 and measure(word[:split]) > width:
                    split -= 1
                lines.append(word[:split])
                word = word[split:]
            current = word
        lines.append(current)
    return lines


def _layout(entry, width, height):
    from PIL import ImageFont
    from reportlab.pdfbase.ttfonts import TTFont
    fallback = font_directory()
    directory = Path(__file__).parent / "fonts"
    fonts = {name: directory / f"SitkaText-{name}.ttf" for name in ("Regular", "Italic", "Bold")}
    # The supplied Sitka faces lack IPA glyphs. Preserve pronunciation using
    # the existing bundled phonetic fallback, while using Sitka for prose.
    fonts["Phonetic"] = fallback / "LiberationSerif-Regular.ttf"
    metrics = {style: TTFont("AlderDefinitionAudit"+style, str(path)).face for style,path in fonts.items()}
    # All geometry is in the supplied reference's 800-unit coordinate system.
    # Non-square exports retain the proportions and centre the square design.
    scale = min(width, height) / 800
    offset_x, offset_y = (width-800*scale)/2, (height-800*scale)/2
    loaded = {}
    def face(style, size):
        key = (style, size)
        if key not in loaded:
            loaded[key] = ImageFont.truetype(str(fonts[style]), max(1, round(size*4)))
        return loaded[key]
    def measure(text, style, size):
        raster = face(style, size).getlength(text) / 4
        vector = sum(metrics[style].charWidths.get(ord(c), 0) for c in text) * size / 1000
        return max(raster, vector)
    # Missing glyphs are a validation failure, never silent square boxes.
    fields = {"word": "Regular", "ipa": "Phonetic", "partOfSpeech": "Italic", "definition": "Bold"}
    missing = sorted({c for field, style in fields.items() for c in entry[field] if not c.isspace() and ord(c) not in metrics[style].charToGlyph})
    if missing:
        raise ValueError("The bundled definition font cannot display: " + ", ".join(f"{c} (U+{ord(c):04X})" for c in missing[:12]))
    warnings = []
    word_size, ipa_size, gap = 100.0, 46.0, 24.0
    while measure(entry["word"], "Regular", word_size) + (gap + measure(entry["ipa"], "Phonetic", ipa_size) if entry["ipa"] else 0) > 590:
        word_size -= 1
        ipa_size = 46 * word_size / 100
        if word_size < 32:
            raise ValueError("The headword and pronunciation are too long for this card. Shorten one of these fields.")
    if word_size < 100:
        warnings.append("Headword and pronunciation were reduced together to fit the reference layout.")
    pos_size = 50.0
    while measure(entry["partOfSpeech"], "Italic", pos_size) > 590:
        pos_size -= 1
        if pos_size < 22:
            raise ValueError("The part-of-speech field is too long for this card.")
    body_size = 48.0
    while body_size >= 22:
        line_height = body_size * 1.03
        lines = _wrap(entry["definition"], lambda text: measure(text, "Bold", body_size), 590)
        if 460 + (len(lines)-1) * line_height + body_size*.25 <= 704:
            break
        body_size -= 1
    else:
        raise ValueError("The definition is too long to fit legibly. Shorten it or divide it into separate cards.")
    if body_size < 48:
        warnings.append("Definition type was reduced to keep all text inside the card.")
    texts = [{"text": entry["word"], "x": 108, "baseline": 292, "style": "Regular", "size": word_size}]
    if entry["ipa"]:
        texts.append({"text":entry["ipa"], "x":108+measure(entry["word"],"Regular",word_size)+gap, "baseline":292, "style":"Phonetic", "size":ipa_size})
    if entry["partOfSpeech"]:
        texts.append({"text":entry["partOfSpeech"], "x":108, "baseline":373, "style":"Italic", "size":pos_size})
    texts.extend({"text":line,"x":108,"baseline":460+i*line_height,"style":"Bold","size":body_size} for i,line in enumerate(lines))
    return {"texts":texts,"line":(101,316,700,316),"lineWidth":4,"scale":scale,"offsetX":offset_x,"offsetY":offset_y,
            "fonts":fonts,"warnings":warnings,"definitionLines":lines,"wordSize":word_size,"definitionSize":body_size}


def build_definition_export(entry: dict, format: str, output_dir: Path, options: dict | None = None) -> dict:
    from PIL import Image, ImageDraw, ImageFont
    entry = _entry(entry)
    format = {"jpeg":"jpg"}.get(str(format).lower(), str(format).lower())
    if format not in ("png", "jpg", "pdf"):
        raise ValueError("Definition cards support PNG, JPEG and PDF export.")
    options = options or {}
    size = _dimension(options.get("size", 800), "Size")
    width, height = _dimension(options.get("width", size), "Width"), _dimension(options.get("height", size), "Height")
    try:
        dpi = float(options.get("dpi", 96))
    except (TypeError, ValueError):
        raise ValueError("DPI must be a number between 72 and 600.") from None
    if not math.isfinite(dpi) or dpi < 72 or dpi > 600:
        raise ValueError("DPI must be between 72 and 600.")
    layout = _layout(entry, width, height)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w .-]", "", entry["word"]).strip(" .")[:60] or "Word"
    filename = f"Alder-{stem}-definition-{uuid.uuid4().hex[:8]}.{format}"
    path = output_dir / filename
    scale, dx, dy = layout["scale"], layout["offsetX"], layout["offsetY"]
    try:
        if format == "pdf":
            from reportlab.pdfgen import canvas
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
            unit = 72 / dpi
            pdf = canvas.Canvas(str(path), pagesize=(width*unit, height*unit), pageCompression=1)
            pdf.setTitle(entry["word"] + " definition")
            pdf.setAuthor("Alder")
            pdf.setSubject(entry["definition"])
            for style, font_path in layout["fonts"].items():
                name = "AlderDefinition" + style
                if name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(name, str(font_path)))
            pdf.setFillColorRGB(1,1,1)
            pdf.rect(0,0,width*unit,height*unit,fill=1,stroke=0)
            pdf.setFillColorRGB(0,0,0)
            for text in layout["texts"]:
                pdf.setFont("AlderDefinition"+text["style"], text["size"]*scale*unit)
                pdf.drawString((dx+text["x"]*scale)*unit, (height-dy-text["baseline"]*scale)*unit, text["text"])
            x1,y1,x2,y2 = layout["line"]
            pdf.setLineWidth(layout["lineWidth"]*scale*unit)
            pdf.line((dx+x1*scale)*unit,(height-dy-y1*scale)*unit,(dx+x2*scale)*unit,(height-dy-y2*scale)*unit)
            pdf.showPage()
            pdf.save()
            validation = {"status":"passed","pages":1,"width":width,"height":height,"dpi":dpi,"vectorText":True}
        else:
            # Supersampling makes small cards legible without changing the geometry.
            oversample = 2 if max(width,height) <= 2048 else 1
            image = Image.new("RGB", (width*oversample,height*oversample), "white")
            draw = ImageDraw.Draw(image)
            for text in layout["texts"]:
                font = ImageFont.truetype(str(layout["fonts"][text["style"]]), max(1, round(text["size"]*scale*oversample)))
                draw.text(((dx+text["x"]*scale)*oversample,(dy+text["baseline"]*scale)*oversample), text["text"], font=font, fill="black", anchor="ls")
            x1,y1,x2,y2 = layout["line"]
            draw.line(((dx+x1*scale)*oversample,(dy+y1*scale)*oversample,(dx+x2*scale)*oversample,(dy+y2*scale)*oversample),fill="black",width=max(1,round(layout["lineWidth"]*scale*oversample)))
            if oversample > 1:
                image = image.resize((width,height), Image.Resampling.LANCZOS)
            if format == "jpg":
                image.save(path,"JPEG",quality=96,subsampling=0,dpi=(dpi,dpi))
            else:
                image.save(path,"PNG",dpi=(dpi,dpi))
            with Image.open(path) as result:
                result.verify()
            validation = {"status":"passed","width":width,"height":height,"dpi":dpi}
        validation.update({"font":"Liberation Serif 2.1.5", "definitionLines":len(layout["definitionLines"]),"wordSize":layout["wordSize"],"definitionSize":layout["definitionSize"]})
        return {"path":str(path.resolve()), "filename":filename,"mime":{"png":"image/png","jpg":"image/jpeg","pdf":"application/pdf"}[format], "warnings":layout["warnings"], "validation":validation}
    except Exception:
        path.unlink(missing_ok=True)
        raise
