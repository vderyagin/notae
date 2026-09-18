# Notæ

[![CI](https://github.com/vderyagin/notae/actions/workflows/ci.yml/badge.svg)](https://github.com/vderyagin/notae/actions/workflows/ci.yml)

A local browser for Markdown collections.

Notæ scans the current directory recursively, presents its Markdown files as a
tree, renders them in the browser, and provides full-text search and a table of
contents. Rendered documents include syntax highlighting, interactive Mermaid
diagrams, sortable and resizable tables, code-copy controls, local assets, and
relative navigation between Markdown files.

## Requirements

- [Bun](https://bun.sh/)

## Run

Install the bundled browser dependencies once when running from source:

```sh
bun install
```

```sh
cd /path/to/markdown
bun /path/to/notæ/server.ts --port 8080
```

The default port is `3000`. Notæ opens it in the default browser. Suppress that
with `--no-open`:

```sh
bun /path/to/notæ/server.ts --no-open
```

When working on Notæ itself, `bun start` serves Markdown from the repository
root.

## Development

The browser and server sources are TypeScript. The quality gate runs Oxfmt,
Oxlint, strict TypeScript checking, and the Bun test suite:

```sh
just format
just check
just test
```

`just build` runs the full quality gate before producing the executable.

## Releases

Push a `v*` tag to run the checks, build Notæ, and publish a GitHub release with
the executable bundle and its SHA-256 checksum:

```sh
git tag v0.1.0
git push origin v0.1.0
```

## Build

```sh
just build
```

This builds and minifies the web UI into a self-contained HTML document, then
embeds it in the single executable file `dist/notæ`. The executable still
requires Bun to be installed, but does not require `node_modules` at runtime:

```sh
cd /path/to/markdown
/path/to/notæ/dist/notæ --port 8080 --no-open
```
