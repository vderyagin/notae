import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = import.meta.dir;
const standalone = process.argv.includes("--standalone");
const outputPath = resolve(root, standalone ? "dist/notæ-standalone" : "dist/notæ");

const webBuild = await Bun.build({
  entrypoints: [resolve(root, "web/index.html")],
  root: resolve(root, "web"),
  target: "browser",
  compile: true,
  minify: true,
  throw: true,
});
const htmlOutput = webBuild.outputs.find((output) => output.path.endsWith(".html"));
if (!htmlOutput) throw new Error("Web build did not produce HTML");
const html = await htmlOutput.text();

const serverBuild = await Bun.build({
  entrypoints: [resolve(root, "server.ts")],
  target: "bun",
  minify: true,
  define: { NOTAE_WEB_HTML: JSON.stringify(html) },
  throw: true,
});
const serverOutput = serverBuild.outputs.find((output) => output.kind === "entry-point");
if (!serverOutput) throw new Error("Server build did not produce an entry point");

await mkdir(resolve(root, "dist"), { recursive: true });

if (standalone) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "notae-standalone-"));
  const temporaryEntry = join(temporaryDirectory, "notae.js");
  try {
    await Bun.write(temporaryEntry, serverOutput);
    const compiler = Bun.spawn({
      cmd: [process.execPath, "build", "--compile", `--outfile=${outputPath}`, temporaryEntry],
      cwd: temporaryDirectory,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await compiler.exited;
    if (exitCode !== 0) throw new Error(`Standalone compilation failed with exit code ${exitCode}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
} else {
  await Bun.write(outputPath, serverOutput);
}

await chmod(outputPath, 0o755);

console.log(`Built ${standalone ? "standalone executable" : "Bun bundle"} ${outputPath}`);
