// Convert the supplied black-background artwork into desktop icon sizes.
const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app
  .whenReady()
  .then(() => {
    const root = path.resolve(__dirname, "..");
    const output = path.join(root, "frontend/public/branding");
    const source = nativeImage.createFromPath(
      path.join(output, "alder-icon-source.png"),
    );
    if (source.isEmpty())
      throw new Error("The supplied Alder icon artwork is missing.");
    const picture = source.resize({ width: 512, height: 512, quality: "best" });
    fs.writeFileSync(path.join(output, "alder-icon.png"), picture.toPNG());
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const frames = sizes.map((size) =>
      picture.resize({ width: size, height: size, quality: "best" }).toPNG(),
    );
    const directory = Buffer.alloc(6 + sizes.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(sizes.length, 4);
    let offset = directory.length;
    sizes.forEach((size, i) => {
      const at = 6 + i * 16;
      directory[at] = directory[at + 1] = size === 256 ? 0 : size;
      directory.writeUInt16LE(1, at + 4);
      directory.writeUInt16LE(32, at + 6);
      directory.writeUInt32LE(frames[i].length, at + 8);
      directory.writeUInt32LE(offset, at + 12);
      offset += frames[i].length;
    });
    fs.writeFileSync(
      path.join(root, "build/alder.ico"),
      Buffer.concat([directory, ...frames]),
    );
    fs.copyFileSync(
      path.join(root, "build/alder.ico"),
      path.join(output, "alder.ico"),
    );
    console.log(
      "Generated Alder icons from the supplied black-background artwork.",
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
