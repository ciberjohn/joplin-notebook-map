/* Joplin Notebook Map — interactive notebook tree + note preview.
 * Dependency-free. Talks to the read-only API of the same origin.
 * "Open in Joplin" uses the joplin:// x-callback URL scheme (desktop/mobile app).
 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const state = {
  folders: [],
  children: {},
  counts: {},
  totalNotes: 0,
  currentFolder: null,
  currentNote: null,
};

// ---------------------------------------------------------------- api
async function api(path, params) {
  const qs = params ? "?" + new URLSearchParams(params) : "";
  const resp = await fetch("/api" + path + qs, { cache: "no-store" });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

// ---------------------------------------------------------------- helpers
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function fmtTime(ts) {
  if (!ts) return "";
  const ms = ts > 1e12 ? ts : ts * 1000; // Joplin API may return seconds or ms
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function joplinNoteUrl(id) {
  return "joplin://x-callback-url/openNote?id=" + encodeURIComponent(id);
}

// ---------------------------------------------------------------- tree
async function loadTree(force) {
  const data = await api("/tree", force ? { force: 1 } : {});
  state.folders = data.folders || [];
  state.counts = data.counts || {};
  state.totalNotes = data.total_notes || 0;
  state.children = {};
  for (const f of state.folders) {
    const pid = f.parent_id || "";
    (state.children[pid] = state.children[pid] || []).push(f);
  }
  for (const pid of Object.keys(state.children)) {
    state.children[pid].sort((a, b) => a.title.localeCompare(b.title));
  }
  renderTree();
}

function folderSubtreeCount(id) {
  let n = state.counts[id] || 0;
  for (const c of state.children[id] || []) n += folderSubtreeCount(c.id);
  return n;
}

function renderTree() {
  const root = $("#tree");
  root.textContent = "";
  const head = el("div", "tree-head");
  head.textContent = `Notebooks · ${state.totalNotes} notes`;
  root.appendChild(head);
  const ul = el("ul", "tree");
  for (const f of (state.children[""] || [])) {
    if (f.title === "INBOX") continue;
    ul.appendChild(renderNode(f));
  }
  root.appendChild(ul);
}

function renderNode(f) {
  const kids = state.children[f.id] || [];
  const li = el("li");
  const row = el("div", "tree-row" + (state.currentFolder === f.id ? " active" : ""));
  row.dataset.id = f.id;

  const chev = el("span", "chev" + (kids.length ? " has-kids" : ""));
  chev.textContent = kids.length ? "▸" : "·";
  row.appendChild(chev);

  const label = el("span", "tree-label");
  label.textContent = f.title;
  label.title = f.title;
  row.appendChild(label);

  const n = folderSubtreeCount(f.id);
  const badge = el("span", "badge" + (n === 0 ? " zero" : ""));
  badge.textContent = n;
  row.appendChild(badge);

  if (kids.length) {
    const sub = el("ul", "tree children");
    for (const c of kids) sub.appendChild(renderNode(c));
    row.addEventListener("click", (ev) => {
      if (ev.target === chev || ev.target.classList.contains("chev")) {
        chev.classList.toggle("open");
        sub.classList.toggle("hidden");
        ev.stopPropagation();
        return;
      }
      selectFolder(f.id, f.title);
    });
    li.appendChild(row);
    li.appendChild(sub);
    if (state.currentFolder === f.id) sub.classList.remove("hidden");
  } else {
    row.addEventListener("click", () => selectFolder(f.id, f.title));
    li.appendChild(row);
  }
  return li;
}

// ---------------------------------------------------------------- notes
async function selectFolder(id, title) {
  state.currentFolder = id;
  state.currentNote = null;
  document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
  const row = document.querySelector(`.tree-row[data-id="${id}"]`);
  if (row) row.classList.add("active");

  const header = $("#notes-header");
  header.textContent = "";
  header.appendChild(el("h2", "", title));
  const sub = el("span", "sub", `${state.counts[id] || 0} notes here · ${folderSubtreeCount(id)} in subtree`);
  header.appendChild(sub);

  const list = $("#notes-list");
  list.textContent = "";
  list.appendChild(el("div", "hint", "Loading…"));

  const previewHeader = $("#preview-header");
  previewHeader.textContent = "";
  const ph = el("span", "sub", "Select a note to preview");
  previewHeader.appendChild(ph);
  $("#preview").textContent = "";

  try {
    const data = await api(`/folders/${id}/notes`);
    list.textContent = "";
    const notes = (data.notes || []).sort((a, b) => b.updated_time - a.updated_time);
    if (!notes.length) {
      list.appendChild(el("div", "hint", "No notes directly in this notebook."));
      return;
    }
    for (const n of notes) {
      const item = el("div", "note-item");
      item.dataset.id = n.id;
      const t = el("div", "note-title", n.title);
      const m = el("div", "note-meta", `updated ${fmtTime(n.updated_time)}`);
      item.appendChild(t);
      item.appendChild(m);
      item.addEventListener("click", () => selectNote(n.id));
      list.appendChild(item);
    }
  } catch (err) {
    list.textContent = "";
    list.appendChild(el("div", "hint error", `Error: ${err.message}`));
  }
}

// ---------------------------------------------------------------- preview
async function selectNote(id) {
  state.currentNote = id;
  document.querySelectorAll(".note-item.active").forEach((r) => r.classList.remove("active"));
  const item = document.querySelector(`.note-item[data-id="${id}"]`);
  if (item) item.classList.add("active");

  const header = $("#preview-header");
  header.textContent = "";
  const openBtn = el("a", "open-btn", "Open in Joplin ↗");
  openBtn.href = joplinNoteUrl(id);
  openBtn.target = "_blank";
  openBtn.rel = "noopener";
  header.appendChild(openBtn);

  const prev = $("#preview");
  prev.textContent = "";
  prev.appendChild(el("div", "hint", "Loading…"));

  try {
    const n = await api(`/note/${id}`);
    prev.textContent = "";
    const h = el("h1", "note-title", n.title || "(untitled)");
    prev.appendChild(h);
    const meta = el("div", "note-meta");
    meta.textContent = `Note ${n.id} · updated ${fmtTime(n.updated_time)}`;
    prev.appendChild(meta);
    prev.appendChild(renderMarkdown(n.body || "_empty note_"));
    renderMermaid(prev);
    maybeInteractiveGraph(prev, n);
  } catch (err) {
    prev.textContent = "";
    prev.appendChild(el("div", "hint error", `Error: ${err.message}`));
  }
}

// Render any ```mermaid blocks in the preview via the vendored library.
// securityLevel 'strict' keeps note content inert (no HTML injection).
async function renderMermaid(root) {
  if (typeof mermaid === "undefined") return;
  const blocks = root.querySelectorAll("div.mermaid");
  if (!blocks.length) return;
  try {
    mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  } catch (e) {
    return;
  }
  let n = 0;
  for (const b of blocks) {
    const src = b.textContent || "";
    try {
      const { svg } = await mermaid.render("mmd-" + (++n), src);
      b.innerHTML = svg;
      b.classList.add("rendered");
      makeSvgNodesClickable(b.querySelector("svg"));
    } catch (err) {
      b.classList.add("err");
      const note = el("div", "md-err-note", "Diagram failed to render: " + (err && err.message ? err.message : err));
      b.appendChild(note);
    }
  }
}

// Tree maps (Brain/JMS mindmaps): labels are folder titles + counts, so wire the
// rendered SVG nodes to the real navigation — click a node → open that notebook.
function makeSvgNodesClickable(svg) {
  if (!svg) return;
  const byLabel = new Map();
  for (const f of state.folders) byLabel.set(norm(f.title), f);
  svg.querySelectorAll("g.node").forEach((g) => {
    const label = norm(g.textContent || "").replace(/\s*\(\d+\)$/, "").replace(/\s*-\s*\d+$/, "");
    const f = byLabel.get(label);
    if (!f) return;
    g.style.cursor = "pointer";
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectFolder(f.id, f.title);
    });
  });
}

function norm(s) {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Map notes carry a hidden marker the mapper stamps in the body:
//   <!-- map:notes <folder-id> -->  link map  (notes + their links)
//   <!-- map:tree [folder-id] -->   tree map  (folders + parent-child)
// The static mermaid is replaced by the interactive force graph; tree maps
// drill down: folder node → its subtree, leaf folder → its notes.
async function maybeInteractiveGraph(root, note) {
  const body = note.body || "";
  const notesM = body.match(/<!--\s*map:notes\s+([0-9a-f]{32})\s*-->/);
  const treeM = body.match(/<!--\s*map:tree(?:\s+([0-9a-f]{32}))?\s*-->/);
  if (!notesM && !treeM) return;
  const mermaidBlocks = root.querySelectorAll("div.mermaid");
  if (!mermaidBlocks.length) return;

  const wrap = el("div", "graph-wrap");
  const head = el("div", "graph-head");
  const svgBox = el("div", "graph-box");
  wrap.appendChild(head);
  wrap.appendChild(svgBox);
  mermaidBlocks[0].replaceWith(wrap);
  mermaidBlocks.forEach((b) => { if (b !== mermaidBlocks[0]) b.remove(); });

  const crumbs = [];

  async function render(mode, folder, title) {
    head.textContent = "";
    if (crumbs.length) {
      const back = el("button", "crumb-btn", "◀ back");
      back.addEventListener("click", () => {
        const prev = crumbs.pop();
        render(prev.mode, prev.folder, prev.title);
      });
      head.appendChild(back);
    }
    if (title) head.appendChild(el("span", "crumb", title));
    const hint = mode === "tree"
      ? "click a folder to expand · leaf folders show their notes"
      : "click a node to open the note";
    head.appendChild(el("span", "graph-hint", hint));
    svgBox.textContent = "";
    try {
      const data = await api("/graph", { folder_id: folder, mode });
      buildForceGraph(svgBox, data.nodes || [], data.links || [], {
        onNodeClick: (n) => {
          if (mode === "tree" && n.kind === "folder") {
            const hasKids = (data.nodes || []).some((x) => x.parent === n.id);
            crumbs.push({ mode, folder, title });
            if (hasKids) render("tree", n.id, n.title);
            else render("notes", n.id, n.title + " — notes");
          } else {
            selectNote(n.id);
          }
        },
      });
    } catch (err) {
      svgBox.appendChild(el("div", "hint error", "Graph failed: " + err.message));
    }
  }

  render(notesM ? "notes" : "tree", notesM ? notesM[1] : (treeM[1] || ""), notesM ? "" : (note.title || "").replace(/^Map — /, ""));
}

// Interactive force graph — nodes FLOAT continuously, are draggable, and the
// canvas zooms (wheel) and pans (drag background). Click a node (no drag) to
// open it, or dispatch to opts.onNodeClick (tree drill-down).
function buildForceGraph(container, nodes, links, opts) {
  opts = opts || {};
  const W = 860, H = 520;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("graph-svg");
  container.appendChild(svg);

  const shown = nodes.slice(0, 120);
  const ids = new Set(shown.map((n) => n.id));
  const edges = links.filter(([a, b]) => ids.has(a) && ids.has(b));

  const view = { x: 0, y: 0, k: 1 }; // pan/zoom transform
  const viewport = document.createElementNS(svgNS, "g");
  svg.appendChild(viewport);

  const pos = new Map();
  for (const n of shown) {
    pos.set(n.id, {
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0, vy: 0,
    });
  }

  const K = 130, C = 2600;   // spring rest length, repulsion strength
  const AMBIENT = 0.06;      // gentle random drift so nodes never freeze
  const DAMP = 0.92;

  function physics() {
    const draggedId = drag && drag.type === "node" ? drag.id : null;
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = pos.get(shown[i].id), b = pos.get(shown[j].id);
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const f = C / d2;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
    }
    for (const [aId, bId] of edges) {
      if (aId === draggedId || bId === draggedId) continue; // don't fight the drag
      const a = pos.get(aId), b = pos.get(bId);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - K) * 0.04;
      a.vx += (dx / d) * f; a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
    }
    for (const n of shown) {
      const p = pos.get(n.id);
      p.vx = p.vx * DAMP + (Math.random() - 0.5) * AMBIENT;
      p.vy = p.vy * DAMP + (Math.random() - 0.5) * AMBIENT;
      p.x += p.vx; p.y += p.vy;
      if (n.id !== draggedId) {
        p.x += (W / 2 - p.x) * 0.008;
        p.y += (H / 2 - p.y) * 0.008;
      }
    }
  }

  const lineEls = edges.map(([aId, bId]) => {
    const a = pos.get(aId), b = pos.get(bId);
    const line = document.createElementNS(svgNS, "line");
    line.classList.add("graph-edge");
    viewport.appendChild(line);
    return { el: line, a, b };
  });

  const nodeByEl = new Map();
  const nodeEls = shown.map((n) => {
    const p = pos.get(n.id);
    const g = document.createElementNS(svgNS, "g");
    g.classList.add("graph-node");
    g.style.cursor = "pointer";
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("r", 9);
    g.appendChild(circle);
    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", 13); text.setAttribute("y", 4);
    text.textContent = (n.title || "?").slice(0, 30);
    g.appendChild(text);
    viewport.appendChild(g);
    nodeByEl.set(g, n);
    return { g, circle, text, p };
  });

  function draw() {
    viewport.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
    for (const l of lineEls) {
      l.el.setAttribute("x1", l.a.x); l.el.setAttribute("y1", l.a.y);
      l.el.setAttribute("x2", l.b.x); l.el.setAttribute("y2", l.b.y);
    }
    for (const ne of nodeEls) {
      ne.circle.setAttribute("cx", ne.p.x); ne.circle.setAttribute("cy", ne.p.y);
      ne.text.setAttribute("x", ne.p.x + 13); ne.text.setAttribute("y", ne.p.y + 4);
    }
  }

  function toWorld(ev) {
    const r = svg.getBoundingClientRect();
    return { x: (ev.clientX - r.left - view.x) / view.k, y: (ev.clientY - r.top - view.y) / view.k };
  }

  let drag = null; // { type: 'node'|'pan', id?, moved, x0, y0 }

  svg.addEventListener("pointerdown", (ev) => {
    svg.setPointerCapture(ev.pointerId);
    const g = ev.target.closest ? ev.target.closest("g.graph-node") : null;
    if (g && nodeByEl.has(g)) {
      drag = { type: "node", id: nodeByEl.get(g).id, moved: 0, x0: ev.clientX, y0: ev.clientY };
    } else {
      drag = { type: "pan", x0: ev.clientX, y0: ev.clientY };
      svg.classList.add("panning");
    }
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (drag.type === "pan") {
      view.x += ev.clientX - drag.x0;
      view.y += ev.clientY - drag.y0;
      drag.x0 = ev.clientX; drag.y0 = ev.clientY;
    } else {
      drag.moved += Math.abs(ev.clientX - drag.x0) + Math.abs(ev.clientY - drag.y0);
      drag.x0 = ev.clientX; drag.y0 = ev.clientY;
      const p = pos.get(drag.id);
      const w = toWorld(ev);
      p.x = w.x; p.y = w.y; p.vx = 0; p.vy = 0;
    }
  });
  svg.addEventListener("pointerup", (ev) => {
    if (drag && drag.type === "node" && drag.moved < 6) {
      const n = shown.find((x) => x.id === drag.id);
      if (n && opts.onNodeClick) opts.onNodeClick(n);
      else if (n) selectNote(n.id);
    }
    drag = null;
    svg.classList.remove("panning");
  });

  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const k2 = Math.min(4, Math.max(0.2, view.k * factor));
    view.x = cx - (cx - view.x) * (k2 / view.k);
    view.y = cy - (cy - view.y) * (k2 / view.k);
    view.k = k2;
  }, { passive: false });

  // initial fit, then a short settle, then float forever
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ne of nodeEls) {
    minX = Math.min(minX, ne.p.x); maxX = Math.max(maxX, ne.p.x);
    minY = Math.min(minY, ne.p.y); maxY = Math.max(maxY, ne.p.y);
  }
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  view.k = Math.min((W - 60) / bw, (H - 60) / bh, 1.2);
  view.x = W / 2 - ((minX + maxX) / 2) * view.k;
  view.y = H / 2 - ((minY + maxY) / 2) * view.k;

  for (let i = 0; i < 120; i++) physics();
  draw();
  (function loop() {
    physics();
    draw();
    requestAnimationFrame(loop);
  })();

  const cap = el("div", "graph-cap",
    `${shown.length} of ${nodes.length} notes · ${edges.length} links — drag nodes · scroll to zoom · click to open`);
  container.appendChild(cap);
}

// ---------------------------------------------------------------- search
async function doSearch(q) {
  const list = $("#notes-list");
  const header = $("#notes-header");
  header.textContent = "";
  header.appendChild(el("h2", "", "Search"));
  header.appendChild(el("span", "sub", `“${q}”`));
  list.textContent = "";
  if (!q.trim()) {
    list.appendChild(el("div", "hint", "Type to search the brain."));
    return;
  }
  list.appendChild(el("div", "hint", "Searching…"));
  try {
    const data = await api("/search", { q, limit: 20 });
    list.textContent = "";
    const results = data.results || [];
    if (!results.length) {
      list.appendChild(el("div", "hint", "No matches."));
      return;
    }
    for (const n of results) {
      const item = el("div", "note-item");
      item.dataset.id = n.id;
      const t = el("div", "note-title", n.title || "(untitled)");
      const m = el("div", "note-meta", `folder ${folderTitle(n.parent_id)} · ${fmtTime(n.updated_time)}`);
      item.appendChild(t);
      item.appendChild(m);
      item.addEventListener("click", () => selectNote(n.id));
      list.appendChild(item);
    }
  } catch (err) {
    list.textContent = "";
    list.appendChild(el("div", "hint error", `Error: ${err.message}`));
  }
}

function folderTitle(id) {
  const f = state.folders.find((x) => x.id === id);
  return f ? f.title : "?";
}

// ---------------------------------------------------------------- markdown-lite
function renderMarkdown(src) {
  const wrap = el("div", "md");
  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let listType = null;

  const closeList = () => {
    if (listType) {
      wrap.appendChild(el(listType, "md-list"));
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeList();
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; // closing fence
      if (lang === "mermaid") {
        // rendered client-side by the vendored mermaid lib (see renderMermaid)
        const div = el("div", "mermaid");
        div.textContent = buf.join("\n");
        wrap.appendChild(div);
      } else {
        const pre = el("pre", "md-pre");
        const code = el("code");
        code.textContent = buf.join("\n");
        pre.appendChild(code);
        wrap.appendChild(pre);
      }
      continue;
    }

    const m = line.match(/^(#{1,6})\s+(.*)/);
    if (m) {
      closeList();
      wrap.appendChild(el(`h${m[1].length}`, "md-h", inline(m[2])));
      i++;
      continue;
    }

    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) {
      const type = ul ? "ul" : "ol";
      if (listType !== type) {
        closeList();
        listType = type;
        wrap.appendChild(el(listType, "md-list"));
      }
      wrap.lastChild.appendChild(el("li", "", inline((ul || ol)[1])));
      i++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      const quote = el("blockquote", "md-quote");
      quote.appendChild(el("div", "", inline(line.replace(/^>\s?/, ""))));
      wrap.appendChild(quote);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      closeList();
      wrap.appendChild(el("hr"));
      i++;
      continue;
    }

    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    closeList();
    const para = el("p", "md-p");
    para.appendChild(inlineEl(line));
    wrap.appendChild(para);
    i++;
  }
  closeList();
  return wrap;
}

function inline(src) {
  return inlineEl(src).textContent; // safe fallback for heading/list use
}

function inlineEl(src) {
  // escape first — everything below operates on escaped text
  let s = esc(src);
  // inline code (before link handling)
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code class="md-code">${c}</code>`);
  // joplin internal links: [text](:/id) → joplin://x-callback-url/openNote
  s = s.replace(/\[([^\]]+)\]\(:\/([0-9a-f]{32})\)/g, (_m, t, id) => {
    return `<a class="md-link" href="${joplinNoteUrl(id)}">${t}</a>`;
  });
  // http(s) links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');
  // bold / italic
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  const span = el("span");
  span.innerHTML = s;
  return span;
}

// ---------------------------------------------------------------- boot
function setStatus(text, ok) {
  const s = $("#status");
  s.textContent = text;
  s.classList.toggle("ok", ok);
  s.classList.toggle("bad", !ok);
}

async function init() {
  $("#refresh").addEventListener("click", () => {
    if (state.currentFolder) selectFolder(state.currentFolder, folderTitle(state.currentFolder));
    loadTree(true);
  });
  let debounce;
  $("#search").addEventListener("input", (ev) => {
    clearTimeout(debounce);
    const q = ev.target.value;
    debounce = setTimeout(() => doSearch(q), 300);
  });

  try {
    const h = await api("/health");
    setStatus(h.status === "ok" ? `Joplin OK · ${h.notes} notes` : "Joplin degraded", h.status === "ok");
  } catch {
    setStatus("offline", false);
  }

  try {
    await loadTree();
  } catch (err) {
    $("#tree").textContent = "";
    $("#tree").appendChild(el("div", "hint error", `Failed to load tree: ${err.message}`));
  }
}

init();
