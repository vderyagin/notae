import { describe, expect, test } from "bun:test";

import {
  countFiles,
  filterTree,
  findFirstFile,
  isDirectoryCollapsed,
  type TreeNode,
} from "./tree.ts";

const tree: TreeNode[] = [
  {
    type: "dir",
    name: "notes",
    path: "notes",
    children: [
      { type: "file", name: "first.md", path: "notes/first.md" },
      {
        type: "dir",
        name: "nested",
        path: "notes/nested",
        children: [{ type: "file", name: "match.md", path: "notes/nested/match.md" }],
      },
    ],
  },
  { type: "file", name: "root.md", path: "root.md" },
];

describe("Markdown tree helpers", () => {
  test("filters files while retaining their ancestor directories", () => {
    expect(filterTree(tree, new Set(["notes/nested/match.md"]))).toEqual([
      {
        type: "dir",
        name: "notes",
        path: "notes",
        children: [
          {
            type: "dir",
            name: "nested",
            path: "notes/nested",
            children: [{ type: "file", name: "match.md", path: "notes/nested/match.md" }],
          },
        ],
      },
    ]);
  });

  test("counts nested files", () => {
    expect(countFiles(tree)).toBe(3);
  });

  test("finds the first file in display order", () => {
    expect(findFirstFile(tree)).toBe("notes/first.md");
  });

  test("preserves folding outside search", () => {
    expect(isDirectoryCollapsed("notes", "", new Set(["notes"]))).toBeTrue();
  });

  test("expands folded matching branches during search", () => {
    expect(isDirectoryCollapsed("notes", "needle", new Set(["notes"]))).toBeFalse();
  });
});
