from alder.language import analyze, autocomplete, lexicon, search_ideas, transform
from alder.models import create_project


def test_prime_i_is_categorised_language_sample():
    result = search_ideas("I", "Prime")
    sample = next(item for item in result if item["word"] == "I")
    assert sample["pos"] == "pronoun"
    assert "first person" in sample["tags"]
    assert search_ideas("cause")[0]["word"] == "because"


def test_analysis_utf16_offsets_and_proposals():
    text = "😀 I write write in order to discover."
    result = analyze(text, rules=["repetition", "concision"])
    repeat = next(a for a in result["annotations"] if a["rule"] == "repetition")
    # Emoji occupies two UTF-16 code units, versus one Python character.
    assert repeat["start"] == text.index("write", text.index("write") + 1) + 1
    assert repeat["end"] - repeat["start"] == 5
    concise = next(a for a in result["annotations"] if a["rule"] == "concision")
    assert concise["suggestion"] == "to"
    assert result["words"] == 7
    assert result["offsetEncoding"] == "utf-16"


def test_project_dictionary_completion_and_preferred_word():
    p = create_project(template="blank")
    p["dictionary"] = [{"word": "Alderism", "definition": "A custom project term.", "preferred": None},
                       {"word": "utilise", "definition": "", "preferred": "use"}]
    assert autocomplete("Alde", p)[0] == "Alderism"
    assert "A custom project term." in lexicon("Alderism", p)["definitions"]
    result = analyze("We utilise Alderism.", p, ["spelling", "preferred-terms"])
    assert any(a.get("suggestion") == "use" for a in result["annotations"])
    assert not any(a["rule"] == "spelling" for a in result["annotations"])


def test_spelling_and_ignore_rule():
    p = create_project(template="blank")
    result = analyze("A mispelled sentence.", p, ["spelling"])
    assert result["annotations"][0]["rule"] == "spelling"
    p["settings"]["ignoredRules"] = ["spelling"]
    assert not analyze("A mispelled sentence.", p, ["spelling"])["annotations"]


def test_literal_custom_rules_have_no_regex_execution():
    p = create_project(template="blank")
    p["settings"]["rules"] = [{"find": "a+b", "replace": "sum", "message": "Prefer plain language."}]
    result = analyze("a+b is an expression. aaab is different.", p, ["custom"])
    assert len(result["annotations"]) == 1
    assert result["annotations"][0]["suggestion"] == "sum"


def test_transform_proposals_preserve_author_text_and_paragraphs():
    original = "I write in order to understand.\nI have another idea."
    assert transform(original, "concision")["text"] == "I write to understand.\nI have another idea."
    assert original.startswith("I write in order")
    assert transform("HELLO I AM HERE", "lowercase")["text"] == "hello I am here"
    assert transform("  a   b\n c ", "whitespace")["text"] == "a b\nc"
    assert transform("a+b aaab", "replace", {"find": "a+b", "replace": "$()"})["text"] == "$() aaab"


def test_lexicon_irregular_forms_and_relationships():
    result = lexicon("begin")
    assert "began" in result["forms"]
    assert "finish" in result["antonyms"]
    assert result["definitions"]


def test_custom_rules_literal_metacharacters_scoping_and_unicode():
    p = create_project(template="blank")
    p["settings"]["customRules"] = [
        {"id": "rule_literal", "name": "Literal formula", "match": "a.*b", "replacement": "formula", "message": "Use a plain description.", "enabled": True, "caseSensitive": False, "wholeWord": True},
        {"id": "rule_accent", "name": "Cafe wording", "match": "café", "replacement": "coffeehouse", "message": "Project term.", "enabled": True, "caseSensitive": False, "wholeWord": True},
    ]
    text = "😀 a.*b aaab CAFÉ café cafe cafés"
    result = analyze(text, p, ["custom"])
    assert len(result["annotations"]) == 3
    literal = result["annotations"][0]
    assert literal["start"] == 3
    assert literal["end"] == 7
    assert literal["ruleId"] == "rule_literal"
    assert literal["ruleName"] == "Literal formula"
    accents = [a for a in result["annotations"] if a["ruleId"] == "rule_accent"]
    assert accents[0]["start"] == text.index("CAFÉ") + 1
    assert accents[1]["start"] == text.index("café") + 1
    assert len(analyze(text, p, ["custom"], ["rule_literal"])["annotations"]) == 1
    assert not analyze(text, p, ["custom"], [])["annotations"]
    p["settings"]["customRules"][1]["caseSensitive"] = True
    assert len(analyze(text, p, ["custom"], ["rule_accent"])["annotations"]) == 1
    p["settings"]["customRules"][1]["wholeWord"] = False
    assert len(analyze(text, p, ["custom"], ["rule_accent"])["annotations"]) == 2


def test_custom_rule_ignores_disabled_and_empty_matches():
    p = create_project(template="blank")
    p["settings"]["customRules"] = [{"id": "rule_a", "match": "word", "replacement": "term", "enabled": True},
                                     {"id": "rule_b", "match": "", "replacement": "oops"},
                                     {"id": "rule_c", "match": "word", "enabled": False}]
    assert len(analyze("word", p, ["custom"])["annotations"]) == 1
    p["settings"]["ignoredRuleIds"] = ["rule_a"]
    assert not analyze("word", p, ["custom"])["annotations"]
    p["settings"]["ignoredRuleIds"] = []
    p["settings"]["ignoredRules"] = ["custom"]
    assert not analyze("word", p, ["custom"])["annotations"]
    assert not analyze("word", p, ["punctuation"])["annotations"]
