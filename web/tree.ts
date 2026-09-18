export type FileNode = {
  type: "file";
  name: string;
  path: string;
};

export type DirectoryNode = {
  type: "dir";
  name: string;
  path: string;
  children: TreeNode[];
};

export type TreeNode = FileNode | DirectoryNode;

export function filterTree(nodes: TreeNode[], matches: ReadonlySet<string>): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (matches.has(node.path)) result.push(node);
      continue;
    }

    const children = filterTree(node.children, matches);
    if (children.length > 0) result.push({ ...node, children });
  }
  return result;
}

export function countFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + (node.type === "file" ? 1 : countFiles(node.children)),
    0,
  );
}

export function findFirstFile(nodes: TreeNode[]): string {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const found = findFirstFile(node.children);
    if (found) return found;
  }
  return "";
}

export function isDirectoryCollapsed(
  path: string,
  query: string,
  collapsedDirectories: ReadonlySet<string>,
): boolean {
  return query.length === 0 && collapsedDirectories.has(path);
}
