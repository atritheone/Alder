"""Explainable, offline lexical tools and proposal-only language devices."""
from __future__ import annotations

from collections import Counter
from difflib import get_close_matches
from functools import lru_cache
import os
from pathlib import Path
import re

from .models import ValidationError


def idea(word, category, definition, pos, *examples, tags=()):
    return {"id": "idea_" + re.sub(r"[^a-z0-9]+", "_", word.lower()), "word": word,
            "category": category, "definition": definition, "pos": pos, "examples": list(examples),
            "tags": list(tags), "language": "en", "provenance": "Alder curated library"}


IDEAS = [
    idea("I", "Prime", "The speaker or writer, referring to themself.", "pronoun", "I begin with a word.", tags=("self", "first person", "singular")),
    idea("you", "Prime", "The person or people being addressed.", "pronoun", "You can begin anywhere.", tags=("person", "second person")),
    idea("we", "Prime", "The speaker together with one or more others.", "pronoun", "We make room for discovery.", tags=("person", "plural")),
    idea("someone", "People", "An unspecified person.", "pronoun", "Someone left a note."),
    idea("something", "Things", "An unspecified thing, event, or idea.", "pronoun", "Something has changed."),
    idea("here", "Place", "In or at this place.", "adverb", "Here, the story begins."),
    idea("there", "Place", "In or at that place.", "adverb", "There is another way."),
    idea("now", "Time", "At the present moment.", "adverb", "Now we can listen."),
    idea("before", "Time", "Earlier than an event or point in time.", "preposition", "Before dawn, the city was quiet."),
    idea("after", "Time", "Later than an event or point in time.", "preposition", "After the rain, everything shone."),
    idea("think", "Mind", "To form or consider ideas.", "verb", "I think of another beginning."),
    idea("know", "Mind", "To have information or understanding.", "verb", "We know where to start."),
    idea("feel", "Experience", "To perceive a sensation or emotion.", "verb", "I feel the rhythm of the sentence."),
    idea("want", "Intention", "To desire something.", "verb", "We want to find the right word."),
    idea("say", "Language", "To express in speech.", "verb", "Say it once, then listen."),
    idea("word", "Language", "A meaningful unit of language.", "noun", "A word opens a door."),
    idea("begin", "Action", "To start an action or process.", "verb", "Begin with what you notice."),
    idea("make", "Action", "To bring something into existence.", "verb", "We make a new arrangement."),
    idea("move", "Action", "To change position or cause change.", "verb", "Move this passage to the beginning."),
    idea("listen", "Experience", "To attend to sound.", "verb", "Listen for the pause."),
    idea("because", "Relations", "Introduces a reason or cause.", "conjunction", "I stayed because I wanted to hear more.", tags=("cause", "transition")),
    idea("however", "Relations", "Introduces a contrast with a preceding statement.", "adverb", "The idea was simple. However, its consequences were not.", tags=("contrast", "transition")),
    idea("therefore", "Relations", "Introduces a consequence or conclusion.", "adverb", "The road was closed; therefore, we walked.", tags=("consequence", "transition")),
    idea("although", "Relations", "Introduces a concession.", "conjunction", "Although it was late, we continued.", tags=("concession",)),
    idea("and", "Relations", "Joins related words, phrases, or clauses.", "conjunction", "A word and a silence."),
    idea("but", "Relations", "Connects contrasting ideas.", "conjunction", "The room was empty, but the light remained."),
    idea("if", "Relations", "Introduces a condition.", "conjunction", "If you listen, you can hear it."),
    idea("not", "Logic", "Negates a word, phrase, or clause.", "adverb", "The story is not finished."),
    idea("same", "Comparison", "Identical or unchanged.", "adjective", "The same words felt different."),
    idea("different", "Comparison", "Not the same as something else.", "adjective", "Try a different beginning."),
    idea("small", "Scale", "Of limited size, amount, or extent.", "adjective", "A small collection of beginnings."),
    idea("many", "Quantity", "A large number of countable things.", "determiner", "Many paths begin here."),
    idea("one", "Quantity", "A single unit or individual.", "numeral", "One word is enough to start."),
    idea("alive", "Experience", "Living, active, or vivid.", "adjective", "The sentence came alive."),
    idea("perhaps", "Possibility", "Expresses uncertainty or possibility.", "adverb", "Perhaps there is another way."),
    idea("silence", "Experience", "An absence of sound or speech.", "noun", "The silence held its own meaning."),
]

LEXICON = {
    "begin": (["To start doing something or bring something into being."], ["start", "commence", "open", "originate"], ["end", "finish"], ["begins", "began", "begun", "beginning"]),
    "word": (["A unit of language carrying meaning.", "A brief statement, promise, or message."], ["term", "expression", "utterance"], [], ["words", "wording", "worded"]),
    "language": (["A system of communication using words, signs, or symbols.", "The characteristic expression of a writer or community."], ["speech", "expression", "wording", "discourse"], [], ["languages"]),
    "idea": (["A thought, suggestion, or mental conception."], ["thought", "notion", "concept", "impression"], [], ["ideas"]),
    "thought": (["An idea or the process of thinking."], ["idea", "reflection", "consideration", "notion"], [], ["thoughts", "thoughtful", "thoughtfully"]),
    "quiet": (["Making little noise.", "A state of calm or stillness."], ["silent", "still", "peaceful", "calm", "hushed"], ["loud", "noisy"], ["quieter", "quietest", "quietly"]),
    "small": (["Of limited size, amount, or importance."], ["little", "tiny", "compact", "modest"], ["large", "big", "vast"], ["smaller", "smallest"]),
    "large": (["Of considerable size, extent, or capacity."], ["big", "vast", "substantial", "spacious"], ["small", "tiny"], ["larger", "largest", "largely"]),
    "bright": (["Giving or reflecting much light.", "Showing intelligence or optimism."], ["luminous", "radiant", "brilliant", "vivid"], ["dim", "dull", "dark"], ["brighter", "brightest", "brightly"]),
    "dark": (["With little or no light.", "Suggesting mystery, secrecy, or sadness."], ["dim", "shadowy", "gloomy", "obscure"], ["light", "bright"], ["darker", "darkest", "darkness"]),
    "light": (["Visible illumination.", "Not heavy; gentle in force or intensity."], ["glow", "radiance", "illumination", "gentle"], ["darkness", "heavy"], ["lights", "lighter", "lightest", "lightly"]),
    "make": (["To create, construct, or bring about."], ["create", "form", "build", "produce", "shape"], ["destroy", "unmake"], ["makes", "made", "making"]),
    "move": (["To change position.", "To affect someone's feelings."], ["shift", "travel", "relocate", "stir"], ["stay", "remain"], ["moves", "moved", "moving"]),
    "listen": (["To direct attention to sound or spoken words."], ["hear", "attend", "heed"], ["ignore"], ["listens", "listened", "listening"]),
    "say": (["To express in spoken words."], ["speak", "tell", "state", "express"], [], ["says", "said", "saying"]),
    "think": (["To form thoughts or consider possibilities."], ["consider", "reflect", "ponder", "imagine"], [], ["thinks", "thought", "thinking"]),
    "know": (["To be aware of or have understanding of something."], ["understand", "recognise", "realise", "comprehend"], [], ["knows", "knew", "known", "knowing"]),
    "feel": (["To experience a sensation or emotion."], ["sense", "experience", "perceive"], [], ["feels", "felt", "feeling"]),
    "want": (["To wish for or desire."], ["desire", "wish", "seek", "need"], [], ["wants", "wanted", "wanting"]),
    "story": (["An account of events, real or imagined."], ["tale", "narrative", "account", "chronicle"], [], ["stories", "storytelling"]),
    "beautiful": (["Giving pleasure through appearance, sound, or character."], ["lovely", "elegant", "graceful", "striking"], ["ugly", "unattractive"], ["beautifully", "beauty"]),
    "good": (["Having desirable qualities or meeting a standard."], ["fine", "sound", "excellent", "favourable"], ["bad", "poor"], ["better", "best", "goodness"]),
    "different": (["Distinct from another; changed or varied."], ["distinct", "other", "unlike", "varied"], ["same", "identical", "similar"], ["differently", "difference", "differ"]),
    "arrange": (["To put things in a considered order or position."], ["order", "organise", "compose", "assemble"], ["scatter", "disorganise"], ["arranges", "arranged", "arranging", "arrangement"]),
    "shape": (["The form or outline of something.", "To influence or give form to."], ["form", "contour", "mould", "fashion"], [], ["shapes", "shaped", "shaping"]),
    "silence": (["An absence of sound or speech."], ["quiet", "stillness", "hush"], ["noise", "sound"], ["silences", "silent", "silently"]),
    "organic": (["Relating to living things.", "Developing naturally through interrelated parts."], ["living", "natural", "integrated"], ["artificial", "synthetic"], ["organically"]),
    "write": (["To form words or compose text."], ["compose", "draft", "record", "inscribe"], [], ["writes", "wrote", "written", "writing"]),
    "run": (["To move quickly on foot.", "To operate or manage something."], ["race", "sprint", "hurry", "operate"], ["walk", "stop"], ["runs", "ran", "running"]),
    "slow": (["Taking more time than usual; moving at low speed."], ["unhurried", "gradual", "leisurely"], ["fast", "quick", "rapid"], ["slower", "slowest", "slowly"]),
    "room": (["An enclosed space within a building.", "Available space or opportunity."], ["space", "chamber", "scope", "opportunity"], [], ["rooms", "roomy"]),
    "discover": (["To find or become aware of something previously unknown."], ["find", "uncover", "notice", "learn"], ["conceal", "lose"], ["discovers", "discovered", "discovering", "discovery"]),
    "i": (["The person speaking or writing, as the subject of a clause."], ["I myself"], [], ["I", "me", "my", "mine", "myself"]),
}

CONCISION = {
    "in order to": "to", "due to the fact that": "because", "at this point in time": "now",
    "in the event that": "if", "for the purpose of": "to", "a large number of": "many",
    "a small number of": "few", "has the ability to": "can", "is able to": "can",
    "in spite of the fact that": "although", "on a daily basis": "daily", "at the present time": "now",
    "it is important to note that": "", "in close proximity to": "near", "prior to": "before",
    "subsequent to": "after", "each and every": "each", "completely unique": "unique",
}
WORDS = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*", re.UNICODE)
COMMON = set("the a an and or but in on at of to for by from with is are was were be been being as it its this that these those i you he she we they them our my your their his her not no yes if then all some any every one two three so very can could should would will may might do does did have has had here there now before after said about into out up down who what when where why how".split())


@lru_cache(maxsize=1)
def _speller():
    try:
        from spellchecker import SpellChecker
        checker = SpellChecker(language="en", distance=1)
        checker.word_frequency.load_words([i["word"].lower() for i in IDEAS] + ["alder", "chatterbox"])
        return checker
    except ImportError:
        return None


@lru_cache(maxsize=1)
def _wordnet():
    try:
        import nltk
        resource_root = Path(os.environ.get("ALDER_RESOURCES_DIR", Path(__file__).resolve().parents[2] / "resources"))
        nltk.data.path.insert(0, str(resource_root / "nltk_data"))
        from nltk.corpus import wordnet
        wordnet.ensure_loaded()
        return wordnet
    except (ImportError, LookupError):
        return None


def capabilities() -> dict:
    return {"language": "en", "offline": True, "spelling": _speller() is not None,
            "wordnet": _wordnet() is not None, "lexicon": "curated + WordNet" if _wordnet() else "curated",
            "rules": ["repetition", "concision", "spelling", "preferred-terms", "sentence-length", "sentence-openings", "punctuation", "brackets", "custom"],
            "ascendingDescending": "deferred"}


def search_ideas(query: str = "", category: str = "", extra: list | None = None) -> list:
    words = query.lower().split()
    seen = set()
    result = []
    for entry in (extra or []) + IDEAS:
        key = entry.get("id", entry.get("word"))
        if key in seen:
            continue
        seen.add(key)
        haystack = " ".join(str(entry.get(k, "")) for k in ("word", "definition", "category", "pos", "tags")).lower()
        if all(w in haystack for w in words) and (not category or category.lower() in [str(entry.get("category", "")).lower(), *(str(t).lower() for t in entry.get("tags", []))]):
            result.append(entry)
    if query.strip():
        needle = query.strip().lower()
        result.sort(key=lambda entry: (entry.get("word", "").lower() != needle,
                                       not entry.get("word", "").lower().startswith(needle),
                                       needle not in [str(t).lower() for t in entry.get("tags", [])]))
    return result


def lexicon(word: str, project: dict | None = None) -> dict:
    word = word.strip()
    key = word.lower()
    result = {"word": word, "definitions": [], "synonyms": [], "antonyms": [], "forms": [], "suggestions": [],
              "senses": [], "prefixes": [], "suffixes": [], "sources": []}
    for entry in (project or {}).get("dictionary", []):
        if entry["word"].lower() == key:
            result["definitions"].append(entry.get("definition") or "Accepted in this project's dictionary.")
            if entry.get("preferred"):
                result["suggestions"].append(entry["preferred"])
            result["sources"].append("Project dictionary")
    if key in LEXICON:
        for field, values in zip(("definitions", "synonyms", "antonyms", "forms"), LEXICON[key]):
            result[field].extend(values)
        result["sources"].append("Alder curated lexicon")
    else:
        sample = next((i for i in IDEAS if i["word"].lower() == key), None)
        if sample:
            result["definitions"].append(sample["definition"])
            result["sources"].append("Alder Ideas")
    wn = _wordnet()
    if wn and key:
        senses = wn.synsets(key.replace(" ", "_"))[:12]
        for sense in senses:
            syns = [l.name().replace("_", " ") for l in sense.lemmas() if l.name().replace("_", " ").lower() != key]
            ants = [a.name().replace("_", " ") for l in sense.lemmas() for a in l.antonyms()]
            result["definitions"].append(sense.definition())
            result["synonyms"].extend(syns)
            result["antonyms"].extend(ants)
            result["senses"].append({"id": sense.name(), "pos": sense.pos(), "definition": sense.definition(), "synonyms": syns, "antonyms": ants, "examples": sense.examples()})
        if senses:
            result["sources"].append("Princeton WordNet")
    checker = _speller()
    if checker and key and len(key) < 40 and " " not in key:
        if key not in checker:
            result["suggestions"].extend(sorted(checker.candidates(key) or [], key=lambda w: checker.word_frequency.dictionary.get(w, 0), reverse=True)[:8])
        for prefix in ("un", "re", "pre", "non", "mis", "dis", "over", "under"):
            candidate = prefix + key
            if candidate in checker:
                result["prefixes"].append(candidate)
        for suffix in ("s", "es", "ed", "ing", "ly", "ness", "ful", "less", "ment", "tion", "er", "est", "able"):
            for base in ([key, key[:-1]] if key.endswith("e") else [key]):
                candidate = base + suffix
                if candidate in checker:
                    result["suffixes"].append(candidate)
                    result["forms"].append(candidate)
    for field in ("definitions", "synonyms", "antonyms", "forms", "suggestions", "prefixes", "suffixes", "sources"):
        result[field] = list(dict.fromkeys(result[field]))[:40]
    result["note"] = "Alternatives may differ in sense or grammatical role; review them in context."
    return result


def autocomplete(prefix: str, project: dict | None = None, limit: int = 20) -> list[str]:
    if not prefix.strip():
        return []
    prefix = prefix.lower()
    ranked = Counter()
    for entry in (project or {}).get("dictionary", []):
        ranked[entry["word"]] += 100
        if entry.get("preferred"):
            ranked[entry["preferred"]] += 100
    for clip in (project or {}).get("clips", []):
        active = next((variant for variant in clip.get("variants", []) if variant["id"] == clip.get("activeVariantId")), clip)
        for word in WORDS.findall(active.get("text", "")):
            ranked[word] += 1
    for sample in (project or {}).get("ideas", []) + IDEAS:
        ranked[sample["word"]] += 10
    for word in LEXICON:
        ranked[word] += 1
    candidates = [w for w in ranked if w.lower().startswith(prefix) and w.lower() != prefix]
    candidates.sort(key=lambda w: (-ranked[w], len(w), w.casefold()))
    checker = _speller()
    if checker and len(candidates) < limit:
        extras = (w for w in checker.word_frequency.dictionary if w.startswith(prefix) and w != prefix and w not in ranked)
        candidates.extend(sorted(extras, key=lambda w: -checker.word_frequency.dictionary.get(w, 0))[:limit])
    return candidates[:max(1, min(limit, 100))]


def _u16(text: str, offset: int) -> int:
    return len(text[:offset].encode("utf-16-le")) // 2


def analyze(text: str, project: dict | None = None, rules: list | None = None, rule_ids: list | None = None) -> dict:
    if not isinstance(text, str) or len(text) > 1_000_000:
        raise ValidationError("Analysis text must contain at most one million characters.")
    if rules is not None and (not isinstance(rules, list) or not all(isinstance(rule, str) for rule in rules)):
        raise ValidationError("Analysis rules must be a list of rule names.")
    if rule_ids is not None and (not isinstance(rule_ids, list) or not all(isinstance(rule_id, str) for rule_id in rule_ids)):
        raise ValidationError("Custom rule scope must be a list of rule identifiers.")
    enabled = set(rules if rules is not None else capabilities()["rules"])
    aliases = {"verbose": "concision", "verbosity": "concision", "sentence_length": "sentence-length", "terminology": "preferred-terms", "spell-check": "spelling", "spellcheck": "spelling", "grammar": "punctuation", "preferred": "preferred-terms"}
    enabled |= {aliases[r] for r in enabled if r in aliases}
    ignored = set((project or {}).get("settings", {}).get("ignoredRules", []))
    ignored |= {aliases[r] for r in ignored if r in aliases}
    enabled -= ignored
    annotations = []
    tokens = list(WORDS.finditer(text))

    def add(rule, start, end, message, suggestion=None, kind="style", rule_id=None, rule_name=None):
        annotation = {"id": f"{rule}:{start}:{end}", "type": kind, "rule": rule, "start": _u16(text, start), "end": _u16(text, end), "message": message}
        if rule_id is not None:
            annotation.update({"id": f"{rule}:{rule_id}:{start}:{end}", "ruleId": rule_id, "ruleName": rule_name or "Custom rule"})
        if suggestion is not None:
            annotation["suggestion"] = suggestion
        annotations.append(annotation)

    if "repetition" in enabled:
        last = {}
        for index, token in enumerate(tokens):
            word = token.group().lower()
            if index and word == tokens[index - 1].group().lower() and text[tokens[index - 1].end():token.start()].strip() == "":
                add("repetition", token.start(), token.end(), f"“{token.group()}” repeats immediately. Keep it if the repetition is intentional.", "")
            elif word not in COMMON and len(word) > 3 and word in last and index - last[word] <= 12:
                add("repetition", token.start(), token.end(), f"“{token.group()}” appears nearby. Review the rhythm or choose an alternative.")
            last[word] = index
    if "concision" in enabled:
        for phrase, shorter in CONCISION.items():
            for match in re.finditer(r"\b" + re.escape(phrase) + r"\b", text, re.I):
                replacement = shorter[:1].upper() + shorter[1:] if match.group()[:1].isupper() else shorter
                add("concision", match.start(), match.end(), "A shorter expression may say the same thing. Review it in context.", replacement)
    checker = _speller() if "spelling" in enabled else None
    if checker and (project or {}).get("language", "en").startswith("en"):
        accepted = {e["word"].lower() for e in (project or {}).get("dictionary", [])}
        accepted |= {e["preferred"].lower() for e in (project or {}).get("dictionary", []) if e.get("preferred")}
        accepted |= {i["word"].lower() for i in (project or {}).get("ideas", [])}
        unknown = checker.unknown({t.group().lower().replace("’", "'") for t in tokens if 1 < len(t.group()) < 40}) - accepted
        suggestions = {}
        for token in tokens:
            word = token.group().lower().replace("’", "'")
            if word in unknown and not token.group().isupper():
                if word not in suggestions:
                    suggestions[word] = checker.correction(word)
                suggestion = suggestions[word]
                if suggestion and token.group()[:1].isupper():
                    suggestion = suggestion[:1].upper() + suggestion[1:]
                add("spelling", token.start(), token.end(), f"“{token.group()}” is not in the English or project dictionary.", suggestion, "spelling")
    if "preferred-terms" in enabled:
        for entry in (project or {}).get("dictionary", []):
            if entry.get("preferred") and entry["preferred"].lower() != entry["word"].lower():
                for match in re.finditer(r"(?<!\w)" + re.escape(entry["word"]) + r"(?!\w)", text, re.I):
                    add("preferred-terms", match.start(), match.end(), "This project defines a preferred expression.", entry["preferred"])
    sentences = [m for m in re.finditer(r"[^.!?\n]+(?:[.!?]+|(?=\n)|$)", text) if WORDS.search(m.group())]
    if "sentence-length" in enabled:
        threshold = (project or {}).get("settings", {}).get("longSentenceWords", 35)
        threshold = threshold if isinstance(threshold, int) and 5 <= threshold <= 300 else 35
        for sentence in sentences:
            count = len(WORDS.findall(sentence.group()))
            if count > threshold:
                add("sentence-length", sentence.start(), sentence.end(), f"This sentence has {count} words. A pause or split may improve readability.")
    if "sentence-openings" in enabled:
        previous = None
        for sentence in sentences:
            opening = WORDS.search(sentence.group())
            if opening:
                word = opening.group().lower()
                if word == previous:
                    add("sentence-openings", sentence.start() + opening.start(), sentence.start() + opening.end(), "Consecutive sentences begin with the same word. Consider whether this is intentional.")
                previous = word
    if "punctuation" in enabled:
        for match in re.finditer(r"[^\S\n]{2,}", text):
            add("punctuation", match.start(), match.end(), "Multiple spaces between words.", " ", "formatting")
        for match in re.finditer(r" +[,.!?;:]", text):
            add("punctuation", match.start(), match.end(), "Space before punctuation.", match.group().lstrip(), "formatting")
    if "brackets" in enabled:
        stack = []
        pairs = {")": "(", "]": "[", "}": "{"}
        for index, char in enumerate(text):
            if char in "([{":
                stack.append((char, index))
            elif char in pairs:
                if stack and stack[-1][0] == pairs[char]:
                    stack.pop()
                else:
                    add("brackets", index, index + 1, "Closing bracket has no matching opener.", kind="structure")
        for _, index in stack:
            add("brackets", index, index + 1, "Opening bracket has no matching closer.", kind="structure")
    if "custom" in enabled:
        settings = (project or {}).get("settings", {})
        custom_rules = list(settings.get("customRules", []))
        # Preserve the initial declarative rule format when opening older projects.
        for index, legacy in enumerate(settings.get("rules", [])[:100]):
            if isinstance(legacy, dict):
                custom_rules.append({**legacy, "id": legacy.get("id", f"legacy_{index}"), "match": legacy.get("find", ""), "replacement": legacy.get("replace"), "wholeWord": legacy.get("wholeWord", True)})
        ignored_ids = ignored | set(settings.get("ignoredRuleIds", []))
        selected_ids = set(rule_ids) if rule_ids is not None else None
        for rule in custom_rules[:300]:
            if not isinstance(rule, dict) or not rule.get("enabled", True):
                continue
            identifier = rule.get("id")
            literal = rule.get("match", "")
            if not isinstance(literal, str) or not literal.strip() or len(literal) > 3000:
                continue
            if identifier in ignored_ids or selected_ids is not None and identifier not in selected_ids:
                continue
            pattern = re.escape(literal)
            if rule.get("wholeWord", True):
                pattern = r"(?<!\w)" + pattern + r"(?!\w)"
            for match in re.finditer(pattern, text, 0 if rule.get("caseSensitive") else re.I):
                add("custom", match.start(), match.end(), str(rule.get("message", "A project rule matched this wording.")), rule.get("replacement"), rule_id=identifier, rule_name=rule.get("name"))
    annotations.sort(key=lambda a: (a["start"], a["end"], a["rule"]))
    return {"annotations": annotations[:2000], "words": len(tokens), "sentences": len(sentences),
            "readingSeconds": round(len(tokens) / 180 * 60, 1), "offsetEncoding": "utf-16", "truncated": len(annotations) > 2000}


def transform(text: str, kind: str, settings: dict | None = None) -> dict:
    settings = settings or {}
    if not isinstance(text, str) or len(text) > 1_000_000:
        raise ValidationError("Transformation text is too large.")
    if kind in ("uppercase", "upper"):
        result = text.upper()
    elif kind in ("lowercase", "lower"):
        result = re.sub(r"\bi\b", "I", text.lower()) if settings.get("preserveI", True) else text.lower()
    elif kind in ("titlecase", "title", "title-case", "title_case"):
        result = text.title()
        result = re.sub(r"(['’])S\b", r"\1s", result)
    elif kind in ("sentencecase", "sentence", "sentence-case", "sentence_case"):
        result = text.lower()
        result = re.sub(r"(^|[.!?]\s+|\n)([^\W\d_])", lambda m: m.group(1) + m.group(2).upper(), result)
        result = re.sub(r"\bi\b", "I", result)
    elif kind in ("trim", "normalize-space", "whitespace", "trim_whitespace"):
        result = "\n".join(re.sub(r"[^\S\n]+", " ", line).strip() for line in text.split("\n"))
    elif kind in ("smartquotes", "smart-quotes", "typography"):
        result = re.sub(r"(?<=\w)'(?=\w)", "’", text)
        result = re.sub(r'"([^"\n]+)"', r'“\1”', result)
        result = result.replace("...", "…").replace(" -- ", " — ")
    elif kind in ("concision", "concise", "verbose"):
        result = text
        for phrase, shorter in sorted(CONCISION.items(), key=lambda pair: -len(pair[0])):
            result = re.sub(r"\b" + re.escape(phrase) + r"\b", lambda m: shorter[:1].upper() + shorter[1:] if m.group()[:1].isupper() else shorter, result, flags=re.I)
    elif kind in ("replace", "find-replace"):
        find = settings.get("find", "")
        replacement = settings.get("replace", "")
        if not isinstance(find, str) or not find or not isinstance(replacement, str):
            raise ValidationError("Find and replace requires nonempty search text and a replacement string.")
        pattern = re.escape(find)
        if settings.get("wholeWord"):
            pattern = r"(?<!\w)" + pattern + r"(?!\w)"
        result = re.sub(pattern, lambda _: replacement, text, flags=0 if settings.get("caseSensitive") else re.I)
    elif kind in ("prefix", "suffix"):
        affix = settings.get("value", settings.get(kind, ""))
        if not isinstance(affix, str) or len(affix) > 100:
            raise ValidationError("An affix must be a short text string.")
        result = affix + text if kind == "prefix" else text + affix
    else:
        raise ValidationError(f"Unknown language transformation: {kind}")
    return {"text": result, "changes": int(result != text), "message": "Review this proposal before accepting it into your clip."}
