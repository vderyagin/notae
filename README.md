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
bun /path/to/notæ/server.ts
```

The default port is `3000`. Pass another port as the first argument:

```sh
bun /path/to/notæ/server.ts 8080
```

When working on Notæ itself, `bun start` serves Markdown from the repository
root.
