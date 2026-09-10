import { useRef, useState } from "react";
import { Plus, Trash2, Download, Upload, Edit3 } from "lucide-react";
import type { Project } from "./types";
import { uid } from "./api";
type Rule = {
  id: string;
  name: string;
  match: string;
  replacement: string;
  message: string;
  enabled: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
};
export default function RulesManager({
  project,
  onChange,
  onError,
}: {
  project: Project;
  onChange: (fn: (p: Project) => void) => void;
  onError: (s: string) => void;
}) {
  const rules = (project.settings.customRules || []) as Rule[],
    [editing, setEditing] = useState<Rule | null>(null),
    file = useRef<HTMLInputElement>(null);
  const save = (rule: Rule) => {
    if (!rule.match.trim() || !rule.name.trim()) {
      onError("Give the rule a name and wording to find.");
      return;
    }
    onChange((p) => {
      const list = (p.settings.customRules || []) as Rule[];
      const index = list.findIndex((r) => r.id === rule.id);
      if (index >= 0) list[index] = rule;
      else list.push(rule);
      p.settings.customRules = list;
    });
    setEditing(null);
  };
  const exportPack = async () => {
    const text = JSON.stringify(
      { format: "alder-language-rules", version: 1, rules },
      null,
      2,
    );
    if (window.alder?.saveText)
      await window.alder.saveText("Alder-language-rules.json", text);
    else {
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "Alder-language-rules.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
  return (
    <>
      <p className="quiet">
        Create explainable rules for wording you want to notice. Matches are
        literal text, with optional word boundaries and case matching.
        Suggestions change your writing only when accepted.
      </p>
      <div className="manager-actions">
        <button
          className="accent"
          onClick={() =>
            setEditing({
              id: uid(),
              name: "Concision",
              match: "in order to",
              replacement: "to",
              message: "Consider the shorter wording.",
              enabled: true,
              caseSensitive: false,
              wholeWord: true,
            })
          }
        >
          <Plus size={13} />
          New rule
        </button>
        <button onClick={() => file.current?.click()}>
          <Upload size={12} />
          Import pack
        </button>
        <button
          onClick={() => void exportPack().catch((e) => onError(e.message))}
        >
          <Download size={12} />
          Export pack
        </button>
      </div>
      {rules.map((rule) => (
        <div className="rule-row" key={rule.id}>
          <input
            aria-label={`Enable ${rule.name}`}
            type="checkbox"
            checked={rule.enabled}
            onChange={(e) =>
              onChange((p) => {
                p.settings.customRules = p.settings.customRules.map(
                  (r: Rule) =>
                    r.id === rule.id ? { ...r, enabled: e.target.checked } : r,
                );
              })
            }
          />
          <div>
            <strong>{rule.name}</strong>
            <p>
              “{rule.match}” {rule.replacement ? `→ “${rule.replacement}”` : ""}
            </p>
          </div>
          <button title="Edit rule" onClick={() => setEditing({ ...rule })}>
            <Edit3 size={12} />
          </button>
          <button
            title="Remove rule"
            onClick={() =>
              onChange((p) => {
                p.settings.customRules = p.settings.customRules.filter(
                  (r: Rule) => r.id !== rule.id,
                );
              })
            }
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {(project.settings.ignoredRuleIds || []).length > 0 && (
        <button
          onClick={() =>
            onChange((p) => {
              p.settings.ignoredRuleIds = [];
            })
          }
        >
          Restore ignored rules ({project.settings.ignoredRuleIds.length})
        </button>
      )}
      <input
        ref={file}
        hidden
        type="file"
        accept=".json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            if (f.size > 1024 * 1024)
              throw new Error("Rule packs must be smaller than 1 MB.");
            const pack = JSON.parse(await f.text());
            if (
              pack.format !== "alder-language-rules" ||
              pack.version !== 1 ||
              !Array.isArray(pack.rules) ||
              pack.rules.length > 200
            )
              throw new Error(
                "This is not a supported Alder language rule pack.",
              );
            const imported = pack.rules.map((r: Rule) => {
              if (
                typeof r.name !== "string" ||
                typeof r.match !== "string" ||
                !r.match.trim() ||
                typeof r.message !== "string" ||
                typeof r.replacement !== "string"
              )
                throw new Error("A rule is missing required text.");
              return {
                ...r,
                id: uid(),
                enabled: r.enabled !== false,
                caseSensitive: !!r.caseSensitive,
                wholeWord: !!r.wholeWord,
              };
            });
            onChange((p) => {
              p.settings.customRules = [
                ...(p.settings.customRules || []),
                ...imported,
              ];
            });
          } catch (e) {
            onError((e as Error).message);
          }
        }}
      />
      {editing && (
        <div className="rule-editor">
          <strong>
            {rules.some((r) => r.id === editing.id) ? "Edit rule" : "New rule"}
          </strong>
          {[
            { key: "name", label: "Rule name" },
            { key: "match", label: "Wording to find" },
            { key: "replacement", label: "Suggested replacement" },
            { key: "message", label: "Explanation" },
          ].map(({ key, label }) => (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                value={String(editing[key as keyof Rule])}
                onChange={(e) =>
                  setEditing({ ...editing, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <div>
            <label>
              <input
                type="checkbox"
                checked={editing.caseSensitive}
                onChange={(e) =>
                  setEditing({ ...editing, caseSensitive: e.target.checked })
                }
              />
              Match case
            </label>
            <label>
              <input
                type="checkbox"
                checked={editing.wholeWord}
                onChange={(e) =>
                  setEditing({ ...editing, wholeWord: e.target.checked })
                }
              />
              Whole words
            </label>
          </div>
          <div>
            <button onClick={() => setEditing(null)}>Cancel</button>
            <button className="accent" onClick={() => save(editing)}>
              Save rule
            </button>
          </div>
        </div>
      )}
    </>
  );
}
