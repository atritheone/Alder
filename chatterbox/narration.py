"""Split narration without dropping words or carrying speech history between sections."""
import re


def split_narration(text: str, max_chars: int = 240, max_words: int = 45) -> list[str]:
    if max_chars < 1 or max_words < 1:
        raise ValueError("Section limits must be positive.")
    chunks = []
    for paragraph in re.split(r"\n\s*\n", text.strip()):
        paragraph = " ".join(paragraph.split())
        sentences = re.findall(r".+?(?:[.!?][\"”’']?(?=\s|$)|$)", paragraph)
        current = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            candidate = f"{current} {sentence}".strip()
            if len(candidate) <= max_chars and len(candidate.split()) <= max_words:
                current = candidate
                continue
            if current:
                chunks.append(current)
                current = ""
            # An unusually long sentence is divided at whitespace, never mid-word.
            for word in sentence.split():
                if len(word) > max_chars:
                    raise ValueError(f"The passage contains a word longer than {max_chars} characters. Check for a pasted URL or missing spaces.")
                candidate = f"{current} {word}".strip()
                if len(candidate) > max_chars or len(candidate.split()) > max_words:
                    chunks.append(current)
                    current = word
                else:
                    current = candidate
        if current:
            chunks.append(current)
    return chunks
