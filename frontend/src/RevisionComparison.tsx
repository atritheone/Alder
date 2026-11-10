/** A bounded word-level comparison; display alignment never drives editor offsets. */
export default function RevisionComparison({
  original,
  revised,
}: {
  original: string;
  revised: string;
}) {
  const left = original.match(/\s+|[^\s]+/g) || [];
  const right = revised.match(/\s+|[^\s]+/g) || [];
  if (left.length * right.length > 100000)
    return (
      <p aria-label="Revision changes">
        <del>{original}</del>
        <br />
        <ins>{revised}</ins>
      </p>
    );
  const width = right.length + 1;
  const lengths = new Uint16Array((left.length + 1) * width);
  for (let a = left.length - 1; a >= 0; a--)
    for (let b = right.length - 1; b >= 0; b--)
      lengths[a * width + b] =
        left[a] === right[b]
          ? 1 + lengths[(a + 1) * width + b + 1]
          : Math.max(lengths[(a + 1) * width + b], lengths[a * width + b + 1]);
  const parts: { kind: "same" | "remove" | "add"; text: string }[] = [];
  const append = (kind: "same" | "remove" | "add", text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let a = 0,
    b = 0;
  while (a < left.length || b < right.length) {
    if (a < left.length && b < right.length && left[a] === right[b]) {
      append("same", left[a++]);
      b++;
    } else if (
      a < left.length &&
      (b === right.length ||
        lengths[(a + 1) * width + b] >= lengths[a * width + b + 1])
    )
      append("remove", left[a++]);
    else append("add", right[b++]);
  }
  return (
    <p aria-label="Revision changes">
      {parts.map((part, index) =>
        part.kind === "remove" ? (
          <del key={index}>{part.text}</del>
        ) : part.kind === "add" ? (
          <ins key={index}>{part.text}</ins>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
