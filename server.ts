#!/usr/bin/env bun

import { serve } from "bun";
import { watch } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

declare const NOTAE_WEB_HTML: string;

type TreeNode = {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
};

const rootDir = resolve(process.cwd());
const rootDirWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
const canonicalRootDir = await realpath(rootDir);
const canonicalRootDirWithSep = canonicalRootDir.endsWith(sep)
  ? canonicalRootDir
  : canonicalRootDir + sep;

const ignoredDirs = new Set([".git", "node_modules", ".bun", "dist", "build", "out"]);
const markdownExts = new Set([".md", ".markdown"]);

type StaticFile = { body: string; type: string };

async function loadStaticFiles(): Promise<Map<string, StaticFile>> {
  if (typeof NOTAE_WEB_HTML === "string") {
    return new Map([
      ["/index.html", { body: NOTAE_WEB_HTML, type: "text/html; charset=utf-8" }],
    ]);
  }

  const webDir = new URL("./web/", import.meta.url);
  const webPath = fileURLToPath(webDir);
  const webBuild = await Bun.build({
    entrypoints: [fileURLToPath(new URL("index.html", webDir))],
    root: webPath,
    target: "browser",
    compile: true,
    minify: true,
    throw: true,
  });
  const htmlOutput = webBuild.outputs.find((output) => output.path.endsWith(".html"));
  if (!htmlOutput) throw new Error("Web build did not produce HTML");
  return new Map([
    ["/index.html", { body: await htmlOutput.text(), type: "text/html; charset=utf-8" }],
  ]);
}

const staticFiles = await loadStaticFiles();
const treeEventClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const eventEncoder = new TextEncoder();
let treeChangeTimer: ReturnType<typeof setTimeout> | undefined;

function publishTreeChange() {
  const message = eventEncoder.encode("event: tree\ndata: changed\n\n");
  for (const client of treeEventClients) {
    try {
      client.enqueue(message);
    } catch (_error) {
      treeEventClients.delete(client);
    }
  }
}

const treeWatcher = watch(rootDir, { recursive: true }, (_eventType, filename) => {
  if (!filename) return;
  const relativePath = toPosix(String(filename));
  if (relativePath.split("/").some((part) => ignoredDirs.has(part))) return;

  clearTimeout(treeChangeTimer);
  treeChangeTimer = setTimeout(publishTreeChange, 100);
});

treeWatcher.on("error", (error) => {
  console.error("Could not watch the Markdown tree", error);
});

function toPosix(path: string) {
  return path.split(sep).join("/");
}

function isMarkdown(path: string) {
  return markdownExts.has(extname(path).toLowerCase());
}

async function scanDir(absDir: string, relDir: string): Promise<TreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absPath = join(absDir, entry.name);
    const relPath = toPosix(join(relDir, entry.name));

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      const children = await scanDir(absPath, relPath);
      if (children.length > 0) {
        nodes.push({ type: "dir", name: entry.name, path: relPath, children });
      }
      continue;
    }

    if (entry.isFile() && isMarkdown(entry.name)) {
      nodes.push({ type: "file", name: entry.name, path: relPath });
    }
  }

  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

async function listMarkdownFiles(absDir: string, relDir: string, acc: string[]) {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absPath = join(absDir, entry.name);
    const relPath = toPosix(join(relDir, entry.name));

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      await listMarkdownFiles(absPath, relDir ? `${relDir}/${entry.name}` : entry.name, acc);
      continue;
    }

    if (entry.isFile() && isMarkdown(entry.name)) {
      acc.push(relPath);
    }
  }
}

async function safeResolveRoot(relativePath: string) {
  const resolved = resolve(rootDir, relativePath);
  if (!resolved.startsWith(rootDirWithSep)) {
    return null;
  }
  try {
    const canonical = await realpath(resolved);
    return canonical.startsWith(canonicalRootDirWithSep) ? canonical : null;
  } catch (_error) {
    return null;
  }
}

function serveStatic(pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const file = staticFiles.get(requestedPath);
  if (!file) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file.body, { headers: { "Content-Type": file.type } });
}

function tryServeStatic(pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const file = staticFiles.get(requestedPath);
  return file
    ? new Response(file.body, { headers: { "Content-Type": file.type } })
    : null;
}

function usage() {
  console.log("Usage: notæ [--port PORT] [--no-open]");
}

function parseArgs(args: string[]) {
  let port: number | undefined;
  let shouldOpen = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-open") {
      shouldOpen = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--port") {
      port = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
      continue;
    }
    console.error(`Unknown option: ${arg}`);
    usage();
    process.exit(1);
  }

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    console.error("Invalid port");
    usage();
    process.exit(1);
  }

  return { port, shouldOpen };
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
}

const options = parseArgs(process.argv.slice(2));
const envPort = Number(process.env.PORT);
const port =
  options.port !== undefined
    ? options.port
    : Number.isInteger(envPort) && envPort > 0 && envPort < 65536
      ? envPort
      : 3000;

const server = serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/tree") {
      const tree = await scanDir(rootDir, "");
      return Response.json({ tree });
    }

    if (url.pathname === "/api/tree-events") {
      let client: ReadableStreamDefaultController<Uint8Array> | undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          client = controller;
          treeEventClients.add(controller);
          controller.enqueue(eventEncoder.encode(": connected\n\n"));
        },
        cancel() {
          if (client) treeEventClients.delete(client);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (url.pathname === "/api/search") {
      const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      const files: string[] = [];
      await listMarkdownFiles(rootDir, "", files);

      if (!query) {
        return Response.json({ matches: files });
      }

      const matches: string[] = [];
      for (const relPath of files) {
        const resolved = await safeResolveRoot(relPath);
        if (!resolved) continue;
        const text = await Bun.file(resolved).text();
        if (text.toLowerCase().includes(query)) {
          matches.push(relPath);
        }
      }

      return Response.json({ matches });
    }

    if (url.pathname === "/api/asset") {
      const relPath = url.searchParams.get("path");
      if (!relPath) {
        return new Response("Missing path", { status: 400 });
      }
      const resolved = await safeResolveRoot(relPath);
      if (!resolved) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(resolved);
      if (!await file.exists()) {
        return new Response("Not found", { status: 404 });
      }
      return new Response(file, {
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
    }

    if (url.pathname === "/api/render") {
      const relPath = url.searchParams.get("path");
      if (!relPath) {
        return new Response("Missing path", { status: 400 });
      }
      if (!isMarkdown(relPath)) {
        return new Response("Not a markdown file", { status: 400 });
      }

      const resolved = await safeResolveRoot(relPath);
      if (!resolved) {
        return new Response("Forbidden", { status: 403 });
      }

      const text = await Bun.file(resolved).text();
      const html = Bun.markdown.html(text, { headingIds: true });
      return Response.json({ html, path: relPath });
    }

    const staticResponse = tryServeStatic(url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    if (isMarkdown(url.pathname)) {
      return serveStatic("/");
    }

    return new Response("Not found", { status: 404 });
  },
});

server.ref();
const url = server.url.toString().replace(/\/$/, "");
console.log(`Notæ running on ${url}`);
if (options.shouldOpen) openBrowser(url);
