import type { PatternPart, ReplacementPart } from "./types";
const kinds: Record<string, string> = {
  text: "Exact Text",
  any: "Any Character",
  digit: "Digit",
  space: "Whitespace",
  lineBreak: "Line Break",
  tab: "Tab",
  word: "Letter, Digit Or Underscore",
  notDigit: "Non-Digit",
  notSpace: "Non-Whitespace",
  notWord: "Non-Word Character",
  boundary: "Word Boundary",
  notBoundary: "Inside A Word",
  begin: "Start Of Text",
  finish: "End Of Text",
  characters: "One Of These Characters",
  range: "Character Range",
  group: "Capture A Part",
  either: "Either Option",
  except: "Any Character Except These",
  repeat: "Repeat Parts",
  reference: "Same As Captured Part",
  followed: "Followed By",
  notFollowed: "Not Followed By",
  preceded: "Preceded By",
  notPreceded: "Not Preceded By",
};
function blank(kind: string): PatternPart {
  if (kind === "text" || kind === "characters") return { kind, value: "" };
  if (kind === "range") return { kind, from: "a", to: "z" };
  if (["either", "except"].includes(kind))
    return {
      kind,
      options: [[{ kind: "text", value: "" }], [{ kind: "text", value: "" }]],
    };
  if (kind === "reference") return { kind, group: 1 };
  if (
    [
      "group",
      "repeat",
      "followed",
      "notFollowed",
      "preceded",
      "notPreceded",
    ].includes(kind)
  )
    return {
      kind,
      children: [{ kind: "text", value: "" }],
      capture: true,
      min: 1,
      max: 1,
      greedy: true,
    };
  return { kind };
}
export function PatternEditor({
  parts,
  onChange,
}: {
  parts: PatternPart[];
  onChange: (p: PatternPart[]) => void;
}) {
  const update = (i: number, patch: Partial<PatternPart>) =>
    onChange(parts.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  return (
    <div className="pronunciation-pattern" aria-label="Matching Parts">
      {parts.map((part, i) => (
        <div className="pattern-part" key={i}>
          <div className="pattern-part-controls">
            <select
              aria-label={`Part ${i + 1} Type`}
              value={part.kind}
              onChange={(e) =>
                onChange(
                  parts.map((p, n) => (n === i ? blank(e.target.value) : p)),
                )
              }
            >
              {Object.entries(kinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            {["text", "characters"].includes(part.kind) && (
              <input
                aria-label={`Part ${i + 1} Text`}
                value={part.value || ""}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            )}
            {part.kind === "range" && (
              <>
                <input
                  aria-label="First Character"
                  maxLength={1}
                  value={part.from || ""}
                  onChange={(e) => update(i, { from: e.target.value })}
                />
                <span>To</span>
                <input
                  aria-label="Last Character"
                  maxLength={1}
                  value={part.to || ""}
                  onChange={(e) => update(i, { to: e.target.value })}
                />
              </>
            )}
            {["characters", "range"].includes(part.kind) && (
              <label>
                <input
                  type="checkbox"
                  checked={!!part.negate}
                  onChange={(e) => update(i, { negate: e.target.checked })}
                />
                Except These
              </label>
            )}
            {part.kind === "group" && (
              <label>
                <input
                  type="checkbox"
                  checked={part.capture !== false}
                  onChange={(e) => update(i, { capture: e.target.checked })}
                />
                Remember For Replacement
              </label>
            )}
            {part.kind === "reference" && (
              <label>
                Captured Part
                <input
                  type="number"
                  min={1}
                  value={part.group || 1}
                  onChange={(e) => update(i, { group: Number(e.target.value) })}
                />
              </label>
            )}
            {part.kind === "repeat" && (
              <>
                <label>
                  At Least
                  <input
                    type="number"
                    min={0}
                    value={part.min ?? 1}
                    onChange={(e) => update(i, { min: Number(e.target.value) })}
                  />
                </label>
                <label>
                  At Most
                  <input
                    type="number"
                    min={part.min || 0}
                    disabled={part.max === null}
                    value={part.max ?? ""}
                    onChange={(e) => update(i, { max: Number(e.target.value) })}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={part.max === null}
                    onChange={(e) =>
                      update(i, {
                        max: e.target.checked
                          ? null
                          : Math.max(part.min || 1, 1),
                      })
                    }
                  />
                  No Maximum
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={part.greedy !== false}
                    onChange={(e) => update(i, { greedy: e.target.checked })}
                  />
                  Prefer Longest Match
                </label>
              </>
            )}
            <button
              type="button"
              aria-label={`Move Part ${i + 1} Up`}
              disabled={!i}
              onClick={() => {
                const next = [...parts];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Remove Part ${i + 1}`}
              onClick={() => onChange(parts.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </div>
          {part.children && (
            <PatternEditor
              parts={part.children}
              onChange={(children) => update(i, { children })}
            />
          )}
          {part.options &&
            part.options.map((option, n) => (
              <div className="pattern-option" key={n}>
                <span>Option {n + 1}</span>
                <PatternEditor
                  parts={option}
                  onChange={(next) =>
                    update(i, {
                      options: part.options!.map((o, k) =>
                        k === n ? next : o,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  disabled={part.options!.length < 3}
                  onClick={() =>
                    update(i, {
                      options: part.options!.filter((_, k) => k !== n),
                    })
                  }
                >
                  Remove Option
                </button>
              </div>
            ))}
          {part.options && (
            <button
              type="button"
              onClick={() =>
                update(i, {
                  options: [...part.options!, [{ kind: "text", value: "" }]],
                })
              }
            >
              Add Option
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...parts, blank("text")])}>
        Add Matching Part
      </button>
    </div>
  );
}
export function ReplacementEditor({
  parts,
  onChange,
}: {
  parts: ReplacementPart[];
  onChange: (p: ReplacementPart[]) => void;
}) {
  const update = (i: number, patch: Partial<ReplacementPart>) =>
    onChange(parts.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  return (
    <div className="replacement-parts" aria-label="Spoken Parts">
      {parts.map((p, i) => (
        <div className="pattern-part-controls" key={i}>
          <select
            aria-label={`Spoken Part ${i + 1} Type`}
            value={p.kind}
            onChange={(e) =>
              update(i, {
                kind: e.target.value as "text" | "group",
                group: 1,
                text: "",
              })
            }
          >
            <option value="text">Say This Text</option>
            <option value="group">Use Captured Part</option>
          </select>
          {p.kind === "text" ? (
            <input
              aria-label={`Spoken Part ${i + 1} Text`}
              value={p.text || ""}
              onChange={(e) => update(i, { text: e.target.value })}
            />
          ) : (
            <label>
              Part Number
              <input
                type="number"
                min={0}
                value={p.group ?? 1}
                onChange={(e) => update(i, { group: Number(e.target.value) })}
              />
            </label>
          )}
          <select
            aria-label={`Spoken Part ${i + 1} Capitalisation`}
            value={p.case || "keep"}
            onChange={(e) => update(i, { case: e.target.value })}
          >
            <option value="keep">Keep Capitalisation</option>
            <option value="upper">Uppercase</option>
            <option value="lower">Lowercase</option>
            <option value="upperFirst">Uppercase First Character</option>
            <option value="lowerFirst">Lowercase First Character</option>
          </select>
          <button
            type="button"
            aria-label={`Remove Spoken Part ${i + 1}`}
            onClick={() => onChange(parts.filter((_, n) => n !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...parts, { kind: "text", text: "", case: "keep" }])
        }
      >
        Add Spoken Part
      </button>
    </div>
  );
}
