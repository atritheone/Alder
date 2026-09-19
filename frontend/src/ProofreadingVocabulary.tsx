import { useRef, useState } from "react";
import { api } from "./api";
import type { Project } from "./types";

export default function ProofreadingVocabulary({
  project,
  change,
  recheck,
}: {
  project: Project;
  change: (fn: (project: Project) => void) => void;
  recheck: () => void;
}) {
  const [words, setWords] = useState<string[]>([]);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const load = async () => {
    try {
      setWords(
        (await api<{ words: string[] }>("/api/proofreading/dictionary")).words,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async (next: string[]) => {
    try {
      const result = await api<{ words: string[] }>(
        "/api/proofreading/dictionary",
        "PUT",
        { words: next },
      );
      setWords(result.words);
      setError("");
      recheck();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const exportWords = async () => {
    try {
      const current = await api<{ words: string[] }>(
        "/api/proofreading/dictionary",
      );
      const text = JSON.stringify(
        {
          format: "alder-proofreading-dictionary",
          version: 1,
          words: current.words,
        },
        null,
        2,
      );
      if (window.alder?.saveText)
        await window.alder.saveText("Alder-personal-dictionary.json", text);
      else {
        const url = URL.createObjectURL(
          new Blob([text], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = "Alder-personal-dictionary.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Vocabulary and ignored rules</summary>
      <p>
        Project words travel with this project. Personal words apply to all
        projects on this computer.
      </p>
      <div className="proofreading-actions">
        <button onClick={() => void exportWords()}>
          Export personal dictionary
        </button>
        <button onClick={() => file.current?.click()}>
          Import personal dictionary
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const imported = e.target.files?.[0];
          e.target.value = "";
          if (!imported) return;
          try {
            if (imported.size > 2_000_000)
              throw new Error("Dictionary file is too large.");
            const data = JSON.parse(await imported.text());
            if (
              data.format !== "alder-proofreading-dictionary" ||
              data.version !== 1 ||
              !Array.isArray(data.words)
            )
              throw new Error("Choose an Alder personal dictionary file.");
            const current = await api<{ words: string[] }>(
              "/api/proofreading/dictionary",
            );
            await save([...new Set([...current.words, ...data.words])]);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <ul className="book-proofreading-results">
        {words.map((word) => (
          <li key={word}>
            {word}{" "}
            <button
              onClick={() => void save(words.filter((entry) => entry !== word))}
            >
              Remove personal word “{word}”
            </button>
          </li>
        ))}
      </ul>
      <ul className="book-proofreading-results">
        {project.dictionary.map((entry) => (
          <li key={entry.word}>
            {entry.word}{" "}
            <button
              onClick={() =>
                change((p) => {
                  p.dictionary = p.dictionary.filter(
                    (item) => item.word !== entry.word,
                  );
                })
              }
            >
              Remove project word “{entry.word}”
            </button>
          </li>
        ))}
      </ul>
      <ul className="book-proofreading-results">
        {(project.settings.ignoredRuleIds || []).map((id: string) => (
          <li key={id}>
            <button
              onClick={() =>
                change((p) => {
                  p.settings.ignoredRuleIds = p.settings.ignoredRuleIds.filter(
                    (value: string) => value !== id,
                  );
                })
              }
            >
              Restore rule {id}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
