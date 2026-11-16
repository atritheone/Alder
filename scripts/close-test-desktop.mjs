import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Close an isolated test instance through Alder's normal shutdown path.
 * Only discard fixtures in a temporary ALDER_DATA_DIR, never a user session. */
export async function closeTestDesktop(app, directory) {
  if (!app) return;
  const process = app.process();
  if (process.exitCode !== null || process.signalCode !== null) return;
  const relative = path.relative(
    fs.realpathSync(os.tmpdir()),
    fs.realpathSync(directory),
  );
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(
      "Refusing to discard data outside a temporary test directory.",
    );
  await app.evaluate(({ dialog }, expected) => {
    if (
      process.env.ALDER_DATA_DIR !== expected ||
      !process.argv.includes("--headless-test")
    )
      throw new Error(
        "Refusing to discard changes outside the isolated test instance.",
      );
    const original = dialog.showMessageBox.bind(dialog);
    dialog.showMessageBox = (...args) => {
      const options = args.at(-1);
      if (
        options.title === "Save before closing Alder" &&
        JSON.stringify(options.buttons) ===
          JSON.stringify(["Return to Alder", "Close without saving"])
      )
        return Promise.resolve({ response: 1, checkboxChecked: false });
      return original(...args);
    };
  }, directory);
  await app.close();
  if (process.exitCode === null)
    throw new Error("Test instance did not finish closing.");
}
