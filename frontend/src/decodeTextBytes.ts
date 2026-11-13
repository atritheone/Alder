export function decodeTextBytes(
  values: readonly number[] | Uint8Array,
  encoding?: string,
): string {
  const bytes = new Uint8Array(values);
  const selected =
    encoding ||
    (bytes[0] === 0xff && bytes[1] === 0xfe
      ? "utf-16le"
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? "utf-16be"
        : "utf-8");
  try {
    return new TextDecoder(
      selected
        .replace("cp1252", "windows-1252")
        .replace("utf-16-le", "utf-16le")
        .replace("utf-16-be", "utf-16be"),
      { fatal: true },
    )
      .decode(bytes)
      .replace(/\r\n|\r/g, "\n");
  } catch (error) {
    if (encoding || selected !== "utf-8") throw error;
    return new TextDecoder("windows-1252", { fatal: true })
      .decode(bytes)
      .replace(/\r\n|\r/g, "\n");
  }
}
