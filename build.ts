import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = import.meta.dir;
const outputPath = resolve(root, "dist/notæ");

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
await Bun.write(outputPath, serverOutput);
await chmod(outputPath, 0o755);

console.log(`Built ${outputPath}`);
