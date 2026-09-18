import { serve } from "bun";
import { readdir } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type TreeNode = {
  type: "dir" | "file";
  name: string;
  path: string;
  children?: TreeNode[];
};

const rootDir = resolve(process.cwd());
const serverDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(serverDir, "public");
const publicDirWithSep = publicDir.endsWith(sep) ? publicDir : publicDir + sep;
const rootDirWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;

const ignoredDirs = new Set([".git", "node_modules", ".bun", "dist", "build", "out"]);
const markdownExts = new Set([".md", ".markdown"]);

const mimeByExt: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

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

function safeResolveRoot(relativePath: string) {
  const resolved = resolve(rootDir, relativePath);
  if (!resolved.startsWith(rootDirWithSep)) {
    return null;
  }
  return resolved;
}

async function serveStatic(pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = resolve(publicDir, "." + requestedPath);
  if (!resolved.startsWith(publicDirWithSep)) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    return new Response("Not found", { status: 404 });
  }

  const ext = extname(resolved).toLowerCase();
  const contentType = mimeByExt[ext] ?? file.type ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": contentType } });
}

async function tryServeStatic(pathname: string) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const resolved = resolve(publicDir, "." + requestedPath);
  if (!resolved.startsWith(publicDirWithSep)) {
    return null;
  }
  const file = Bun.file(resolved);
  if (!(await file.exists())) {
    return null;
  }
  const ext = extname(resolved).toLowerCase();
  const contentType = mimeByExt[ext] ?? file.type ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": contentType } });
}

const argPort = Number(process.argv[2]);
const envPort = Number(process.env.PORT);
const port =
  Number.isInteger(argPort) && argPort > 0 && argPort < 65536
    ? argPort
    : Number.isInteger(envPort) && envPort > 0 && envPort < 65536
      ? envPort
      : 3000;

serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/tree") {
      const tree = await scanDir(rootDir, "");
      return Response.json({ tree });
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
        const resolved = safeResolveRoot(relPath);
        if (!resolved) continue;
        const text = await Bun.file(resolved).text();
        if (text.toLowerCase().includes(query)) {
          matches.push(relPath);
        }
      }

      return Response.json({ matches });
    }

    if (url.pathname === "/api/render") {
      const relPath = url.searchParams.get("path");
      if (!relPath) {
        return new Response("Missing path", { status: 400 });
      }
      if (!isMarkdown(relPath)) {
        return new Response("Not a markdown file", { status: 400 });
      }

      const resolved = safeResolveRoot(relPath);
      if (!resolved) {
        return new Response("Forbidden", { status: 403 });
      }

      const text = await Bun.file(resolved).text();
      const html = Bun.markdown.html(text, { headingIds: true });
      return Response.json({ html, path: relPath });
    }

    const staticResponse = await tryServeStatic(url.pathname);
    if (staticResponse) {
      return staticResponse;
    }

    if (isMarkdown(url.pathname)) {
      return serveStatic("/");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Notæ running on http://localhost:${port}`);
