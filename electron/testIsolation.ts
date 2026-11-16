import fs from "node:fs";
import path from "node:path";

// Resolve existing parents too, so a junction cannot disguise a user profile.
function canonical(input: string): string {
  let current = path.resolve(input);
  const suffix: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  const resolved = path.join(fs.realpathSync(current), ...suffix);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
export function requireIsolatedTestPaths(
  argv: string[],
  data: string | undefined,
  protectedPaths: string[],
) {
  const index = argv.indexOf("--user-data-dir");
  const profile =
    argv
      .find((arg) => arg.startsWith("--user-data-dir="))
      ?.slice("--user-data-dir=".length) ??
    (index >= 0 ? argv[index + 1] : undefined);
  if (!profile || !data || !path.isAbsolute(profile) || !path.isAbsolute(data))
    throw new Error(
      "Hidden tests require explicit absolute --user-data-dir and ALDER_DATA_DIR fixture paths.",
    );
  const paths = [canonical(profile), canonical(data)],
    protectedCanonical = protectedPaths.map(canonical);
  if (
    contains(paths[0], paths[1]) ||
    contains(paths[1], paths[0]) ||
    paths.some((candidate) =>
      protectedCanonical.some(
        (protectedPath) =>
          contains(candidate, protectedPath) ||
          contains(protectedPath, candidate),
      ),
    )
  )
    throw new Error(
      "Hidden tests require separate fixture directories outside the normal Alder profile and data.",
    );
}
