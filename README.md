# Notæ

A local browser for Markdown collections.

Notæ scans the current directory recursively, presents its Markdown files as a
tree, renders them in the browser, and provides full-text search and a table of
contents.

## Requirements

- [Bun](https://bun.sh/)

## Run

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

## Build

```sh
just build
```

This produces the single executable file `dist/notæ`. It contains the web UI
but still requires Bun to be installed:

```sh
cd /path/to/markdown
/path/to/notæ/dist/notæ --port 8080 --no-open
```
