import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import mermaid from "mermaid";

const treeEl = document.getElementById("tree");
const searchInput = document.getElementById("search");
const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const viewerEl = document.querySelector(".viewer");
const tocEl = document.getElementById("toc");
const tocListEl = document.getElementById("toc-list");

let fullTree = [];
let filteredTree = [];
let matchedSet = new Set();
let currentQuery = "";
let currentPath = "";
let renderGeneration = 0;
let mermaidSequence = 0;
let tocHeadings = [];
let tocUpdateScheduled = false;
const collapsedDirectoryStorageKey = "notae:collapsed-directories";
const collapsedDirectories = loadCollapsedDirectories();

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
});

const debounce = (fn, delay = 150) => {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function loadCollapsedDirectories() {
  try {
    const paths = JSON.parse(localStorage.getItem(collapsedDirectoryStorageKey) || "[]");
    return new Set(Array.isArray(paths) ? paths : []);
  } catch (_error) {
    return new Set();
  }
}

function saveCollapsedDirectories() {
  try {
    localStorage.setItem(collapsedDirectoryStorageKey, JSON.stringify([...collapsedDirectories]));
  } catch (_error) {
    // Folding still works for the current page when storage is unavailable.
  }
}

function treeToHtml(nodes, isRoot = false) {
  const items = nodes.map((node) => {
    if (node.type === "dir") {
      const isCollapsed = !currentQuery && collapsedDirectories.has(node.path);
      return `<li class="dir">
        <button class="dir-label" data-dir="${escapeHtml(node.path)}" aria-expanded="${!isCollapsed}">
          <span class="tree-icon dir-icon" aria-hidden="true"></span>
          <span class="dir-name">${escapeHtml(node.name)}</span>
        </button>
        <div class="dir-children"${isCollapsed ? " hidden" : ""}>
          ${treeToHtml(node.children || [])}
        </div>
      </li>`;
    }

    const classes = [
      "file",
      node.path === currentPath ? "active" : "",
      matchedSet.size && matchedSet.has(node.path) ? "matched" : "",
    ].filter(Boolean).join(" ");
    return `<li class="file-item">
      <button class="${classes}" data-file="${escapeHtml(node.path)}">
        <span class="tree-icon file-icon" aria-hidden="true"></span>
        <span class="file-name">${escapeHtml(node.name)}</span>
      </button>
    </li>`;
  }).join("");

  return `<ul class="tree-list${isRoot ? " root" : ""}">${items}</ul>`;
}

function filterTree(nodes, matches) {
  const result = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (matches.has(node.path)) result.push(node);
      continue;
    }
    const children = filterTree(node.children || [], matches);
    if (children.length) result.push({ ...node, children });
  }
  return result;
}

function countFiles(nodes) {
  return nodes.reduce(
    (sum, node) => sum + (node.type === "file" ? 1 : countFiles(node.children || [])),
    0,
  );
}

function renderTree() {
  if (!filteredTree.length) {
    treeEl.innerHTML = currentQuery
      ? '<div class="empty">No matches found.</div>'
      : '<div class="empty">No markdown files found.</div>';
    statusEl.textContent = currentQuery ? "0 files matched" : "0 markdown files";
    return;
  }

  treeEl.innerHTML = treeToHtml(filteredTree, true);
  const count = currentQuery ? matchedSet.size : countFiles(fullTree);
  statusEl.textContent = currentQuery
    ? `${count} file${count === 1 ? "" : "s"} matched`
    : `${count} markdown file${count === 1 ? "" : "s"}`;
}

function findFirstFile(nodes) {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    const found = findFirstFile(node.children || []);
    if (found) return found;
  }
  return "";
}

async function fetchTree(options = {}) {
  const res = await fetch("/api/tree");
  if (!res.ok) throw new Error("Could not load the Markdown tree");
  const data = await res.json();
  fullTree = data.tree || [];
  if (currentQuery) await runSearch(currentQuery);
  else {
    matchedSet = new Set();
    filteredTree = fullTree;
    renderTree();
  }

  if (!options.openInitial) return;

  const urlPath = getPathFromUrl();
  if (urlPath) {
    await openFile(urlPath, { updateUrl: false, hash: window.location.hash });
    return;
  }

  const first = findFirstFile(fullTree);
  if (first) await openFile(first, { updateUrl: true, replace: true });
}

async function runSearch(query) {
  if (!query) {
    matchedSet = new Set();
    filteredTree = fullTree;
    renderTree();
    return;
  }

  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error("Search failed");
  const data = await res.json();
  matchedSet = new Set(data.matches || []);
  filteredTree = filterTree(fullTree, matchedSet);
  renderTree();
}

function closeDocumentDialogs() {
  document.querySelectorAll("dialog.markdown-mermaid-dialog").forEach((dialog) => {
    if (dialog.open) dialog.close();
    else dialog.remove();
  });
}

async function openFile(path, options = {}) {
  const generation = ++renderGeneration;
  closeDocumentDialogs();
  currentPath = path;
  contentEl.innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    const res = await fetch(`/api/render?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (generation !== renderGeneration) return;

    contentEl.innerHTML = data.html || "<p>No content.</p>";
    prepareDocument(path, generation);
    renderTree();
    viewerEl.scrollTop = 0;

    const heading = contentEl.querySelector("h1, h2, h3, h4, h5, h6");
    const fallbackTitle = path.split("/").pop().replace(/\.(?:md|markdown)$/i, "");
    document.title = `${heading?.textContent.trim() || fallbackTitle} — Notæ`;

    if (options.updateUrl !== false) {
      updateUrl(path, options.replace === true, options.hash || "");
    }

    const hash = options.hash || "";
    if (hash) requestAnimationFrame(() => jumpToHash(hash, false));
  } catch (error) {
    if (generation !== renderGeneration) return;
    contentEl.innerHTML = `<div class="empty-state"><div class="empty-title">Could not open file</div><div class="empty-sub">${escapeHtml(String(error.message || error))}</div></div>`;
  }
}

function prepareDocument(path, generation) {
  rewriteLocalUrls(path);
  ensureHeadingIds();
  highlightCode();
  enhanceCodeBlocks();
  enhanceTables();
  buildToc();
  clearHighlights(contentEl);
  if (currentQuery) highlightText(contentEl, currentQuery);
  void renderMermaidDiagrams(generation);
}

function clearHighlights(root) {
  root.querySelectorAll("mark.search-hit").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
    parent.normalize();
  });
}

function highlightText(root, query) {
  if (!query) return;
  const regex = new RegExp(escapeRegExp(query), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest("code, pre, mark, script, style")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  nodes.forEach((node) => {
    const text = node.nodeValue;
    regex.lastIndex = 0;
    if (!regex.test(text)) return;
    regex.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      if (match.index > lastIndex) fragment.append(text.slice(lastIndex, match.index));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = match[0];
      fragment.append(mark);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) fragment.append(text.slice(lastIndex));
    node.replaceWith(fragment);
  });
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodePath(path) {
  return path.split("/").map(decodeURIComponent).join("/");
}

function getPathFromUrl() {
  const raw = window.location.pathname.replace(/^\/+/, "");
  return raw ? decodePath(raw) : "";
}

function updateUrl(path, replace = false, hash = "") {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({ path }, "", `/${encodePath(path)}${hash}`);
}

function resolveRelativePath(value, documentPath) {
  try {
    const base = new URL(`/${encodePath(documentPath)}`, "http://notae.local");
    const resolved = new URL(value, base);
    return {
      path: decodePath(resolved.pathname.replace(/^\/+/, "")),
      hash: resolved.hash,
    };
  } catch (_error) {
    return null;
  }
}

function isExternalUrl(value) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

function rewriteLocalUrls(path) {
  contentEl.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || isExternalUrl(href)) return;
    if (href.startsWith("#")) {
      link.href = `/${encodePath(path)}${href}`;
      link.dataset.documentHash = href;
      return;
    }
    const resolved = resolveRelativePath(href, path);
    if (!resolved) return;

    if (/\.(?:md|markdown)$/i.test(resolved.path)) {
      link.href = `/${encodePath(resolved.path)}${resolved.hash}`;
      link.dataset.documentPath = resolved.path;
      link.dataset.documentHash = resolved.hash;
    } else {
      link.href = `/api/asset?path=${encodeURIComponent(resolved.path)}${resolved.hash}`;
    }
  });

  contentEl.querySelectorAll("img[src], audio[src], video[src], source[src]").forEach((asset) => {
    const src = asset.getAttribute("src");
    if (!src || src.startsWith("data:") || src.startsWith("blob:") || isExternalUrl(src)) return;
    const resolved = resolveRelativePath(src, path);
    if (resolved) asset.src = `/api/asset?path=${encodeURIComponent(resolved.path)}`;
  });
}

function ensureHeadingIds() {
  const headings = Array.from(contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const used = new Set(
    Array.from(contentEl.querySelectorAll("[id]"), (element) => element.id).filter(Boolean),
  );

  headings.forEach((heading) => {
    if (heading.id) return;
    const base = heading.textContent.trim().toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
    let id = base;
    let suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    heading.id = id;
  });
}

function languageFor(code) {
  const languageClass = Array.from(code.classList).find((name) => name.startsWith("language-"));
  const requested = languageClass?.slice("language-".length).toLowerCase();
  const aliases = { "emacs-lisp": "lisp", text: "plaintext", shell: "bash" };
  return aliases[requested] || requested;
}

function highlightCode() {
  contentEl.querySelectorAll("pre > code").forEach((code) => {
    const language = languageFor(code);
    if (language === "mermaid" || code.classList.contains("nohighlight")) return;

    const result = language && hljs.getLanguage(language)
      ? hljs.highlight(code.textContent, { language, ignoreIllegals: true })
      : hljs.highlightAuto(code.textContent);
    code.innerHTML = result.value;
    code.classList.add("hljs");
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_error) {
    const staging = document.createElement("textarea");
    staging.value = text;
    staging.readOnly = true;
    staging.className = "clipboard-staging";
    document.body.append(staging);
    staging.select();
    let copied = false;
    try { copied = document.execCommand("copy"); } catch (_copyError) { copied = false; }
    staging.remove();
    return copied;
  }
}

function enhanceCodeBlocks() {
  contentEl.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(":scope > code.language-mermaid") || !pre.textContent.trim()) return;
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-code-block";
    pre.replaceWith(wrapper);
    wrapper.append(pre);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "markdown-code-copy";
    button.textContent = "Copy";
    button.title = "Copy code to clipboard";
    button.setAttribute("aria-label", "Copy code to clipboard");
    let timer = 0;
    button.addEventListener("click", async () => {
      const copied = await copyText(pre.textContent);
      clearTimeout(timer);
      button.dataset.state = copied ? "copied" : "failed";
      button.textContent = copied ? "Copied" : "Failed";
      timer = window.setTimeout(() => {
        delete button.dataset.state;
        button.textContent = "Copy";
      }, 1500);
    });
    wrapper.append(button);
  });
}

function enhanceTables() {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const minimumColumnWidth = 48;

  const prepareColumns = (table) => {
    let colgroup = table.querySelector(":scope > colgroup");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      table.prepend(colgroup);
    }
    const headers = Array.from(table.tHead.rows[table.tHead.rows.length - 1].cells);
    while (colgroup.children.length < headers.length) colgroup.append(document.createElement("col"));
    if (!table.dataset.columnsSized) {
      const tableWidth = table.getBoundingClientRect().width;
      headers.forEach((header, index) => {
        colgroup.children[index].style.width = `${header.getBoundingClientRect().width}px`;
      });
      table.style.tableLayout = "fixed";
      table.style.width = `${tableWidth}px`;
      table.dataset.columnsSized = "true";
    }
    return colgroup;
  };

  const resizeColumn = (table, columnIndex, delta) => {
    const column = prepareColumns(table).children[columnIndex];
    const oldWidth = parseFloat(column.style.width);
    const newWidth = Math.max(minimumColumnWidth, oldWidth + delta);
    const tableWidth = table.getBoundingClientRect().width;
    column.style.width = `${newWidth}px`;
    table.style.width = `${tableWidth + newWidth - oldWidth}px`;
    table.tHead.rows[table.tHead.rows.length - 1].cells[columnIndex]
      ?.querySelector(".markdown-column-resizer")
      ?.setAttribute("aria-valuenow", String(Math.round(newWidth)));
  };

  contentEl.querySelectorAll("table").forEach((table) => {
    if (!table.tHead || !table.tBodies.length) return;
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-table-wrapper";
    table.before(wrapper);
    wrapper.append(table);

    const headers = Array.from(table.tHead.rows[table.tHead.rows.length - 1].cells);
    let columnIndex = 0;
    headers.forEach((header) => {
      const currentColumn = columnIndex;
      columnIndex += header.colSpan;
      if (header.colSpan !== 1) return;

      const label = header.textContent.trim();
      header.classList.add("markdown-sortable");
      header.tabIndex = 0;
      header.setAttribute("aria-sort", "none");
      header.title = "Click to sort; drag the edge to resize";

      const sort = () => {
        const ascending = header.dataset.sortDirection !== "ascending";
        table.querySelectorAll("thead th").forEach((other) => {
          delete other.dataset.sortDirection;
          other.setAttribute("aria-sort", "none");
        });
        header.dataset.sortDirection = ascending ? "ascending" : "descending";
        header.setAttribute("aria-sort", header.dataset.sortDirection);
        const direction = ascending ? 1 : -1;
        Array.from(table.tBodies).forEach((body) => {
          Array.from(body.rows)
            .map((row, index) => ({ row, index }))
            .sort((left, right) => {
              const leftText = left.row.cells[currentColumn]?.textContent.trim() || "";
              const rightText = right.row.cells[currentColumn]?.textContent.trim() || "";
              if (!leftText && rightText) return 1;
              if (leftText && !rightText) return -1;
              return collator.compare(leftText, rightText) * direction || left.index - right.index;
            })
            .forEach(({ row }) => body.append(row));
        });
      };

      header.addEventListener("click", (event) => {
        if (!event.target.closest("a, button, input, select, textarea, .markdown-column-resizer")) sort();
      });
      header.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        sort();
      });

      const resizer = document.createElement("span");
      resizer.className = "markdown-column-resizer";
      resizer.tabIndex = 0;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", "vertical");
      resizer.setAttribute("aria-label", `Resize ${label || "table"} column`);
      resizer.setAttribute("aria-valuemin", String(minimumColumnWidth));
      resizer.setAttribute("aria-valuemax", "2000");
      resizer.setAttribute("aria-valuenow", String(Math.round(header.getBoundingClientRect().width)));
      header.append(resizer);
      resizer.addEventListener("click", (event) => event.stopPropagation());
      resizer.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        resizeColumn(table, currentColumn, event.key === "ArrowLeft" ? -10 : 10);
      });
      resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add("markdown-resizing-columns");
        let previousX = event.clientX;
        const move = (moveEvent) => {
          resizeColumn(table, currentColumn, moveEvent.clientX - previousX);
          previousX = moveEvent.clientX;
        };
        const finish = () => {
          document.body.classList.remove("markdown-resizing-columns");
          resizer.removeEventListener("pointermove", move);
          resizer.removeEventListener("pointerup", finish);
          resizer.removeEventListener("pointercancel", finish);
        };
        resizer.addEventListener("pointermove", move);
        resizer.addEventListener("pointerup", finish);
        resizer.addEventListener("pointercancel", finish);
      });
    });
  });
}

const mermaidIcons = {
  check: ["M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"],
  close: ["M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"],
  code: ["M5.72 3.22a.75.75 0 0 1 1.06 1.06L3.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L1.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25Zm4.56 0 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L12.94 8 9.22 4.28a.75.75 0 0 1 1.06-1.06Z"],
  copy: ["M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z", "M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"],
  expand: ["M3.72 3.72a.75.75 0 0 1 1.06 1.06L2.56 7h10.88l-2.22-2.22a.75.75 0 0 1 1.06-1.06l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 0 1-1.06-1.06l2.22-2.22H2.56l2.22 2.22a.75.75 0 0 1-1.06 1.06l-3.5-3.5a.75.75 0 0 1 0-1.06l3.5-3.5Z"],
  reset: ["M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204A.25.25 0 0 1 11.104 10h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"],
  zoomIn: ["M3.75 7.5a.75.75 0 0 1 .75-.75h2.25V4.5a.75.75 0 0 1 1.5 0v2.25h2.25a.75.75 0 0 1 0 1.5H8.25v2.25a.75.75 0 0 1-1.5 0V8.25H4.5a.75.75 0 0 1-.75-.75Z", "M7.5 0a7.5 7.5 0 0 1 5.807 12.247l2.473 2.473a.75.75 0 0 1-1.06 1.06l-2.473-2.473A7.5 7.5 0 1 1 7.5 0Zm-6 7.5a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z"],
  zoomOut: ["M4.5 6.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5Z", "M0 7.5a7.5 7.5 0 1 1 13.307 4.747l2.473 2.473a.75.75 0 0 1-1.06 1.06l-2.473-2.473A7.5 7.5 0 0 1 0 7.5Zm7.5-6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"],
};

function makeIcon(paths) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 16 16");
  paths.forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  });
  return icon;
}

function makeMermaidControl(label, className, icon) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = `markdown-mermaid-control ${className}`;
  control.setAttribute("aria-label", label);
  control.title = label;
  control.append(makeIcon(icon));
  return control;
}

async function renderMermaidDiagrams(generation) {
  const sources = Array.from(contentEl.querySelectorAll("pre > code.language-mermaid"));
  for (const code of sources) {
    if (generation !== renderGeneration || !code.isConnected) return;
    const source = code.parentElement;
    const sourceText = code.textContent;
    try {
      const id = `notae-mermaid-${++mermaidSequence}`;
      const { svg, bindFunctions } = await mermaid.render(id, sourceText);
      if (generation !== renderGeneration || !source.isConnected) return;

      const diagram = document.createElement("div");
      diagram.className = "markdown-mermaid";
      diagram.setAttribute("role", "region");
      diagram.setAttribute("aria-label", "Mermaid diagram");
      const viewport = document.createElement("div");
      viewport.className = "markdown-mermaid-viewport";
      viewport.innerHTML = svg;
      const renderedSvg = viewport.querySelector("svg");
      const view = { scale: 1, x: 0, y: 0 };
      const updateView = () => {
        renderedSvg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      };

      viewport.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        viewport.setPointerCapture(event.pointerId);
        viewport.dataset.panning = "";
        const origin = { x: event.clientX - view.x, y: event.clientY - view.y };
        const move = (moveEvent) => {
          view.x = moveEvent.clientX - origin.x;
          view.y = moveEvent.clientY - origin.y;
          updateView();
        };
        const finish = () => {
          delete viewport.dataset.panning;
          viewport.removeEventListener("pointermove", move);
          viewport.removeEventListener("pointerup", finish);
          viewport.removeEventListener("pointercancel", finish);
        };
        viewport.addEventListener("pointermove", move);
        viewport.addEventListener("pointerup", finish);
        viewport.addEventListener("pointercancel", finish);
      });

      const navigation = document.createElement("nav");
      navigation.className = "markdown-mermaid-navigation";
      navigation.setAttribute("aria-label", "Diagram navigation");
      [
        ["Zoom in", "zoom-in", mermaidIcons.zoomIn, () => { view.scale = Math.min(5, +(view.scale + 0.1).toFixed(1)); }],
        ["Zoom out", "zoom-out", mermaidIcons.zoomOut, () => { view.scale = Math.max(0.2, +(view.scale - 0.1).toFixed(1)); }],
        ["Reset view", "reset", mermaidIcons.reset, () => Object.assign(view, { scale: 1, x: 0, y: 0 })],
      ].forEach(([label, className, icon, action]) => {
        const control = makeMermaidControl(label, `markdown-mermaid-${className}`, icon);
        control.addEventListener("click", () => { action(); updateView(); });
        navigation.append(control);
      });

      const expand = makeMermaidControl("Open expanded view", "markdown-mermaid-expand", mermaidIcons.expand);
      expand.setAttribute("aria-haspopup", "dialog");
      const toggleSource = makeMermaidControl("Show Mermaid code", "markdown-mermaid-toggle-source", mermaidIcons.code);
      toggleSource.setAttribute("aria-pressed", "false");
      const copy = makeMermaidControl("Copy Mermaid code", "markdown-mermaid-copy", mermaidIcons.copy);

      source.classList.add("markdown-mermaid-source");
      source.hidden = true;
      toggleSource.addEventListener("click", () => {
        const showSource = toggleSource.getAttribute("aria-pressed") === "false";
        toggleSource.setAttribute("aria-pressed", String(showSource));
        toggleSource.setAttribute("aria-label", showSource ? "Show Mermaid diagram" : "Show Mermaid code");
        toggleSource.title = showSource ? "Show Mermaid diagram" : "Show Mermaid code";
        viewport.hidden = showSource;
        source.hidden = !showSource;
      });
      copy.addEventListener("click", async () => {
        const copied = await copyText(sourceText);
        copy.dataset.state = copied ? "copied" : "failed";
        copy.setAttribute("aria-label", copied ? "Copied Mermaid code" : "Could not copy Mermaid code");
        if (copied) copy.replaceChildren(makeIcon(mermaidIcons.check));
        window.setTimeout(() => {
          delete copy.dataset.state;
          copy.setAttribute("aria-label", "Copy Mermaid code");
          copy.replaceChildren(makeIcon(mermaidIcons.copy));
        }, 1500);
      });

      const dialog = document.createElement("dialog");
      dialog.className = "markdown-mermaid-dialog";
      dialog.setAttribute("aria-label", "Expanded Mermaid diagram");
      const close = makeMermaidControl("Close expanded view", "markdown-mermaid-dialog-close", mermaidIcons.close);
      let marker = null;
      expand.addEventListener("click", () => {
        marker = document.createComment("Mermaid diagram position");
        diagram.before(marker);
        dialog.append(close, diagram);
        document.body.append(dialog);
        dialog.showModal();
        close.focus();
      });
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener("close", () => {
        if (marker?.isConnected) marker.replaceWith(diagram);
        dialog.remove();
      });
      viewport.addEventListener("wheel", (event) => {
        if (!dialog.open) return;
        event.preventDefault();
        view.scale = Math.min(5, Math.max(0.2, +(view.scale + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(1)));
        updateView();
      }, { passive: false });

      const actions = document.createElement("div");
      actions.className = "markdown-mermaid-actions";
      actions.append(navigation, expand, toggleSource, copy);
      source.replaceWith(diagram);
      diagram.append(actions, viewport, source);
      bindFunctions?.(diagram);
    } catch (error) {
      source.classList.add("markdown-mermaid-error");
      source.title = `Could not render Mermaid diagram: ${error.message || error}`;
      console.error("Could not render Mermaid diagram", error);
    }
  }
}

function buildToc() {
  const tocHandle = document.getElementById("toc-resize-handle");
  tocHeadings = Array.from(contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  if (tocHeadings.length <= 1) {
    tocEl.classList.add("hidden");
    tocHandle.classList.add("hidden");
    treeEl.style.flex = "";
    treeEl.style.height = "";
    tocListEl.replaceChildren();
    return;
  }

  tocEl.classList.remove("hidden");
  tocHandle.classList.remove("hidden");
  const topLevel = Math.min(...tocHeadings.map((heading) => Number(heading.tagName.slice(1))));
  const fragment = document.createDocumentFragment();
  tocHeadings.forEach((heading, index) => {
    const link = document.createElement("a");
    link.href = `/${encodePath(currentPath)}#${encodeURIComponent(heading.id)}`;
    link.dataset.index = String(index);
    link.dataset.level = String(Math.min(Number(heading.tagName.slice(1)) - topLevel, 5));
    link.title = heading.textContent.trim();
    link.textContent = heading.textContent.trim();
    fragment.append(link);
  });
  tocListEl.replaceChildren(fragment);
  scheduleTocUpdate();
}

function flashHeading(heading) {
  contentEl.querySelectorAll(".markdown-heading-flash").forEach((other) => {
    other.classList.remove("markdown-heading-flash", "markdown-heading-fading");
  });
  heading.classList.add("markdown-heading-flash");
  requestAnimationFrame(() => requestAnimationFrame(() => heading.classList.add("markdown-heading-fading")));
  window.setTimeout(() => heading.classList.remove("markdown-heading-flash", "markdown-heading-fading"), 1350);
}

function jumpToHeading(heading, smooth = true) {
  const targetTop = heading.getBoundingClientRect().top
    - viewerEl.getBoundingClientRect().top
    + viewerEl.scrollTop
    - 16;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  viewerEl.scrollTo({
    top: targetTop,
    behavior: smooth && !reduceMotion ? "smooth" : "auto",
  });
  flashHeading(heading);
}

function jumpToHash(hash, smooth = true) {
  let id;
  try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch (_error) { id = hash.replace(/^#/, ""); }
  const target = Array.from(contentEl.querySelectorAll("[id]")).find((element) => element.id === id);
  if (target) jumpToHeading(target, smooth);
}

function updateTocState() {
  const links = Array.from(tocListEl.querySelectorAll("a[data-index]"));
  if (!links.length) return;
  const viewerBox = viewerEl.getBoundingClientRect();
  let activeIndex = 0;
  tocHeadings.forEach((heading, index) => {
    const box = heading.getBoundingClientRect();
    links[index].classList.toggle("visible", box.bottom > viewerBox.top && box.top < viewerBox.bottom);
    if (box.top <= viewerBox.top + 32) activeIndex = index;
  });
  links.forEach((link, index) => {
    const active = index === activeIndex;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });

  const linkBox = links[activeIndex].getBoundingClientRect();
  const listBox = tocListEl.getBoundingClientRect();
  if (linkBox.top < listBox.top) tocListEl.scrollTop -= listBox.top - linkBox.top;
  else if (linkBox.bottom > listBox.bottom) tocListEl.scrollTop += linkBox.bottom - listBox.bottom;
}

function scheduleTocUpdate() {
  if (tocUpdateScheduled) return;
  tocUpdateScheduled = true;
  requestAnimationFrame(() => {
    tocUpdateScheduled = false;
    updateTocState();
  });
}

treeEl.addEventListener("click", (event) => {
  const directory = event.target.closest("button[data-dir]");
  if (directory) {
    if (currentQuery) return;
    const path = directory.dataset.dir;
    if (collapsedDirectories.has(path)) collapsedDirectories.delete(path);
    else collapsedDirectories.add(path);
    saveCollapsedDirectories();
    renderTree();
    return;
  }

  const button = event.target.closest("button[data-file]");
  if (button) void openFile(button.dataset.file);
});

contentEl.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-document-path], a[data-document-hash]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (link.dataset.documentPath) {
    void openFile(link.dataset.documentPath, { hash: link.dataset.documentHash });
    return;
  }
  window.history.replaceState(
    { path: currentPath },
    "",
    `/${encodePath(currentPath)}${link.dataset.documentHash}`,
  );
  jumpToHash(link.dataset.documentHash);
});

tocListEl.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-index]");
  if (!link) return;
  event.preventDefault();
  const heading = tocHeadings[Number(link.dataset.index)];
  if (!heading) return;
  window.history.replaceState({ path: currentPath }, "", `/${encodePath(currentPath)}#${encodeURIComponent(heading.id)}`);
  jumpToHeading(heading);
});

searchInput.addEventListener("input", debounce(async (event) => {
  currentQuery = event.target.value.trim();
  try {
    await runSearch(currentQuery);
    if (currentPath) {
      clearHighlights(contentEl);
      if (currentQuery) highlightText(contentEl, currentQuery);
    }
  } catch (_error) {
    statusEl.textContent = "Search failed.";
  }
}, 200));

window.addEventListener("popstate", (event) => {
  const path = event.state?.path || getPathFromUrl();
  if (path && path !== currentPath) void openFile(path, { updateUrl: false, hash: window.location.hash });
  else if (window.location.hash) jumpToHash(window.location.hash, false);
});

viewerEl.addEventListener("scroll", scheduleTocUpdate, { passive: true });
window.addEventListener("resize", scheduleTocUpdate, { passive: true });

function installResizer(handle, options) {
  const { axis, onDelta, cursor } = options;
  let previous = 0;
  const coordinate = (event) => axis === "x" ? event.clientX : event.clientY;
  const finish = () => {
    handle.classList.remove("active");
    document.body.classList.remove("app-resizing");
    document.body.style.removeProperty("--resize-cursor");
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
  };
  const move = (event) => {
    const next = coordinate(event);
    onDelta(next - previous, event);
    previous = next;
  };
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    previous = coordinate(event);
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("active");
    document.body.classList.add("app-resizing");
    document.body.style.setProperty("--resize-cursor", cursor);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
  handle.addEventListener("keydown", (event) => {
    const keys = axis === "x" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    onDelta(event.key === keys[0] ? -10 : 10, event);
  });
}

const sidebarEl = document.getElementById("sidebar");
installResizer(document.getElementById("resize-handle"), {
  axis: "x",
  cursor: "col-resize",
  onDelta(delta) {
    const width = Math.min(Math.max(sidebarEl.getBoundingClientRect().width + delta, 180), window.innerWidth * 0.5);
    sidebarEl.style.width = `${width}px`;
    document.getElementById("resize-handle").setAttribute("aria-valuenow", String(Math.round(width)));
  },
});

installResizer(document.getElementById("toc-resize-handle"), {
  axis: "y",
  cursor: "row-resize",
  onDelta(delta) {
    const sidebarBox = sidebarEl.getBoundingClientRect();
    const currentHeight = treeEl.getBoundingClientRect().height;
    const searchHeight = sidebarEl.querySelector(".search").offsetHeight;
    const available = sidebarBox.height - searchHeight - 17;
    treeEl.style.flex = "none";
    const height = Math.min(Math.max(currentHeight + delta, 60), available - 60);
    treeEl.style.height = `${height}px`;
    tocEl.style.flex = "1";
    document.getElementById("toc-resize-handle").setAttribute("aria-valuenow", String(Math.round(height)));
  },
});

fetchTree({ openInitial: true }).catch((error) => {
  statusEl.textContent = error.message || "Failed to load Markdown tree.";
});

const treeEvents = new EventSource("/api/tree-events");
treeEvents.addEventListener("tree", () => {
  void fetchTree().catch(() => {
    statusEl.textContent = "Could not refresh Markdown tree.";
  });
});
