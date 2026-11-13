export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1))
    starts.push(i + 1);
  return starts;
}
export function searchLine(
  text: string,
  starts: readonly number[],
  offset: number,
) {
  let low = 0,
    high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(0, low - 1),
    start = starts[index],
    end = starts[index + 1] ?? text.length;
  return {
    number: index + 1,
    excerpt: text.slice(
      start,
      Math.min(end, Math.max(start + 100, offset + 30)),
    ),
  };
}
export function readSearchHistory(): string[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("alder.find.history") || "[]",
    );
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (v): v is string => typeof v === "string" && v.length <= 16384,
          )
          .slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
