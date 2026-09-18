const treeEl = document.getElementById("tree");
const searchInput = document.getElementById("search");
const statusEl = document.getElementById("status");
const contentEl = document.getElementById("content");
const tocEl = document.getElementById("toc");
const tocListEl = document.getElementById("toc-list");

let fullTree = [];
let filteredTree = [];
let matchedSet = new Set();
let currentQuery = "";
let currentPath = "";

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
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function treeToHtml(nodes, isRoot = false) {
  const items = nodes
    .map((node) => {
      if (node.type === "dir") {
        const children = treeToHtml(node.children || []);
        return `<li class="dir">
          <div class="dir-label">
            <span class="tree-icon dir-icon" aria-hidden="true"></span>
            <span class="dir-name">${escapeHtml(node.name)}</span>
          </div>
          ${children}
        </li>`;
      }

      const isActive = node.path === currentPath;
      const isMatched = matchedSet.size ? matchedSet.has(node.path) : false;
      const classes = ["file", isActive ? "active" : "", isMatched ? "matched" : ""]
        .filter(Boolean)
        .join(" ");
      return `<li class="file-item">
        <button class="${classes}" data-file="${escapeHtml(node.path)}">
          <span class="tree-icon file-icon" aria-hidden="true"></span>
          <span class="file-name">${escapeHtml(node.name)}</span>
        </button>
      </li>`;
    })
    .join("");

  const listClass = isRoot ? "tree-list root" : "tree-list";
  return `<ul class="${listClass}">${items}</ul>`;
}

function filterTree(nodes, matches) {
  const result = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (matches.has(node.path)) {
        result.push(node);
      }
      continue;
    }
    const children = filterTree(node.children || [], matches);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
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

function countFiles(nodes) {
  return nodes.reduce((sum, node) => {
    if (node.type === "file") return sum + 1;
    return sum + countFiles(node.children || []);
  }, 0);
}

async function fetchTree() {
  const res = await fetch("/api/tree");
  const data = await res.json();
  fullTree = data.tree || [];
  filteredTree = fullTree;
  matchedSet = new Set();
  renderTree();
  const urlPath = getPathFromUrl();
  if (urlPath) {
    openFile(urlPath, { updateUrl: false });
    return;
  }
  const first = findFirstFile(fullTree);
  if (first) {
    openFile(first, { updateUrl: true, replace: true });
  }
}

function findFirstFile(nodes) {
  for (const node of nodes) {
    if (node.type === "file") return node.path;
    if (node.children) {
      const found = findFirstFile(node.children);
      if (found) return found;
    }
  }
  return "";
}

async function runSearch(query) {
  if (!query) {
    matchedSet = new Set();
    filteredTree = fullTree;
    renderTree();
    return;
  }
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  matchedSet = new Set(data.matches || []);
  filteredTree = query ? filterTree(fullTree, matchedSet) : fullTree;
  renderTree();
}

async function openFile(path, options = {}) {
  currentPath = path;
  contentEl.innerHTML = '<div class="empty-state">Loading...</div>';
  const res = await fetch(`/api/render?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    contentEl.innerHTML = "<p>Failed to load markdown.</p>";
    return;
  }
  const data = await res.json();
  contentEl.innerHTML = data.html || "<p>No content.</p>";
  clearHighlights(contentEl);
  if (currentQuery) {
    highlightText(contentEl, currentQuery);
  }
  renderTree();
  buildToc();
  if (options.updateUrl !== false) {
    updateUrl(path, options.replace === true);
  }
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
  const escaped = escapeRegExp(query);
  const regex = new RegExp(escaped, "gi");
  const skipTags = new Set(["SCRIPT", "STYLE", "MARK", "CODE", "PRE"]);

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest("code, pre, mark, script, style")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
    false
  );

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((node) => {
    const text = node.nodeValue;
    if (!text || !regex.test(text)) {
      regex.lastIndex = 0;
      return;
    }

    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = match[0];
      frag.appendChild(mark);
      lastIndex = end;
    }

    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    const parent = node.parentNode;
    if (parent) parent.replaceChild(frag, node);
  });
}

treeEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-file]");
  if (!button) return;
  openFile(button.dataset.file);
});

searchInput.addEventListener(
  "input",
  debounce((event) => {
    currentQuery = event.target.value.trim();
    runSearch(currentQuery).then(() => {
      if (currentPath) {
        clearHighlights(contentEl);
        if (currentQuery) highlightText(contentEl, currentQuery);
      }
    });
  }, 200)
);

fetchTree().catch(() => {
  statusEl.textContent = "Failed to load markdown tree.";
});

function updateUrl(path, replace = false) {
  const encoded = encodePath(path);
  if (replace) {
    window.history.replaceState({ path }, "", `/${encoded}`);
    return;
  }
  window.history.pushState({ path }, "", `/${encoded}`);
}

function getPathFromUrl() {
  const raw = window.location.pathname.replace(/^\/+/, "");
  if (!raw) return "";
  return decodePath(raw);
}

window.addEventListener("popstate", (event) => {
  const path = event.state?.path || getPathFromUrl();
  if (path && path !== currentPath) {
    openFile(path, { updateUrl: false });
  }
});

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodePath(path) {
  return path
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

// TOC
function buildToc() {
  const tocHandle = document.getElementById("toc-resize-handle");
  const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
  if (headings.length <= 1) {
    tocEl.classList.add("hidden");
    tocHandle.classList.add("hidden");
    treeEl.style.flex = "";
    treeEl.style.height = "";
    tocListEl.innerHTML = "";
    return;
  }
  tocEl.classList.remove("hidden");
  tocHandle.classList.remove("hidden");
  let html = "";
  headings.forEach((h, i) => {
    const level = parseInt(h.tagName[1], 10);
    const text = h.textContent || "";
    html += `<a data-level="${level}" data-index="${i}" title="${escapeHtml(text)}">${escapeHtml(text)}</a>`;
  });
  tocListEl.innerHTML = html;
}

// TOC click handler (once, delegated)
tocListEl.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-index]");
  if (!link) return;
  const index = parseInt(link.dataset.index, 10);
  const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
  const target = headings[index];
  const viewer = document.querySelector(".viewer");
  if (target && viewer) {
    const targetTop = target.getBoundingClientRect().top - viewer.getBoundingClientRect().top + viewer.scrollTop - 16;
    const start = viewer.scrollTop;
    const distance = targetTop - start;
    const duration = 200;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      viewer.scrollTop = start + distance * t;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
});

// TOC active heading tracking
document.querySelector(".viewer").addEventListener("scroll", () => {
  const tocLinks = tocListEl.querySelectorAll("a[data-index]");
  if (!tocLinks.length) return;
  const viewer = document.querySelector(".viewer");
  const viewerTop = viewer.getBoundingClientRect().top;
  const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let activeIndex = -1;
  headings.forEach((h, i) => {
    if (h.getBoundingClientRect().top - viewerTop <= 32) activeIndex = i;
  });
  tocLinks.forEach((link) => {
    link.classList.toggle("active", parseInt(link.dataset.index, 10) === activeIndex);
  });
});

// Sidebar resize
(function () {
  const handle = document.getElementById("resize-handle");
  const sidebar = document.getElementById("sidebar");
  let dragging = false;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const width = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.5);
    sidebar.style.width = width + "px";
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
})();

// TOC/tree split resize
(function () {
  const sidebar = document.getElementById("sidebar");
  let dragging = false;

  document.addEventListener("mousedown", (e) => {
    if (e.target.id !== "toc-resize-handle") return;
    e.preventDefault();
    dragging = true;
    e.target.classList.add("active");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = sidebar.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    const searchHeight = sidebar.querySelector(".search").offsetHeight;
    const minTree = 60;
    const minToc = 60;
    const available = rect.height - searchHeight - 12; // 12 for gaps
    const treeHeight = Math.min(Math.max(offset - searchHeight - 12, minTree), available - minToc);
    treeEl.style.flex = "none";
    treeEl.style.height = treeHeight + "px";
    tocEl.style.flex = "1";
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    const handle = document.getElementById("toc-resize-handle");
    if (handle) handle.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
})();
