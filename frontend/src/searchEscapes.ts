/** Extended search escapes are literal characters, not regular expressions. */
export function decodeSearchEscapes(value: string): {
  text: string;
  error?: string;
} {
  let text = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      text += value[i];
      continue;
    }
    const next = value[++i];
    if (next == null)
      return {
        text: "",
        error: "A trailing backslash needs an escape character.",
      };
    const simple: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      "0": "\0",
      "\\": "\\",
    };
    if (Object.hasOwn(simple, next)) {
      text += simple[next];
      continue;
    }
    if (next === "x" || next === "u") {
      const length = next === "x" ? 2 : 4,
        digits = value.slice(i + 1, i + 1 + length);
      if (digits.length !== length || !/^[a-f0-9]+$/i.test(digits))
        return {
          text: "",
          error: `Use ${length} hexadecimal digits after \\${next}.`,
        };
      text += String.fromCharCode(parseInt(digits, 16));
      i += length;
      continue;
    }
    return {
      text: "",
      error: `Unknown escape \\${next}. Use \\\\ for a literal backslash.`,
    };
  }
  return { text };
}
