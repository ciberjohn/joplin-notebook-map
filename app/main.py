"""Joplin Notebook Map — interactive notebook tree + note preview for a Joplin brain.

Read-only web UI backed by the Joplin REST API. Tailnet-only by design:
the container binds 127.0.0.1 and is exposed via `tailscale serve` (never Funnel).
No write endpoints. The Joplin API token is injected at runtime via environment
(JOPLIN_API_TOKEN) or a mounted secret file (JOPLIN_TOKEN_FILE) — never baked
into the image or committed to the repo.

Endpoints
---------
GET /api/health             liveness + Joplin reachability
GET /api/tree               folder tree (flat list) + note counts
GET /api/folders/{id}/notes notes directly inside a folder
GET /api/note/{id}          full note (title, body, meta)
GET /api/search?q=          Joplin FTS search
"""
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger("joplin-notebook-map")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
API_BASE = os.environ.get("JOPLIN_API_BASE", "http://127.0.0.1:41184").rstrip("/")
CACHE_TTL = int(os.environ.get("CACHE_TTL", "60"))
NOTE_CACHE_TTL = int(os.environ.get("NOTE_CACHE_TTL", "30"))


def _load_token():
    token = os.environ.get("JOPLIN_API_TOKEN", "").strip()
    if token:
        return token
    token_file = os.environ.get("JOPLIN_TOKEN_FILE", "").strip()
    if token_file and os.path.exists(token_file):
        with open(token_file, encoding="utf-8") as fh:
            return fh.read().strip()
    raise RuntimeError("JOPLIN_API_TOKEN (or JOPLIN_TOKEN_FILE) is required")


TOKEN = _load_token()


class JoplinError(RuntimeError):
    pass


def joplin(method, path, params=None, data=None, timeout=15):
    """Raw Joplin REST call. Token appended to every request."""
    url = f"{API_BASE}{path}?" + urllib.parse.urlencode({**(params or {}), "token": TOKEN})
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raise JoplinError(f"HTTP {exc.code} on {path}: {exc.read().decode()[:200]}") from exc
    except urllib.error.URLError as exc:
        raise JoplinError(f"connection to {API_BASE} failed: {exc}") from exc


# ---------------------------------------------------------------- cache
# Simple TTL caches. Note bodies can be large; per-note cache keeps the UI snappy.
_cache = {"folders": (None, 0.0), "counts": (None, 0.0), "notes": {}, "note": {}}


def _fresh(key, ttl):
    entry = _cache.get(key)
    if entry is None:
        return None
    val, ts = entry
    return val if time.time() - ts < ttl else None


def _put(key, val):
    if key.startswith("note:") and len(_cache["note"]) > 5000:
        _cache["note"] = {}  # bounded note cache
    _cache[key] = (val, time.time())


def get_folders(force=False):
    if not force:
        cached = _fresh("folders", CACHE_TTL)
        if cached is not None:
            return cached
    items, page = [], 1
    while True:
        d = joplin("GET", "/folders", {"fields": "id,title,parent_id", "limit": 100, "page": page})
        items += d.get("items", [])
        if not d.get("has_more"):
            break
        page += 1
    _put("folders", items)
    return items


def get_counts(force=False):
    if not force:
        cached = _fresh("counts", CACHE_TTL)
        if cached is not None:
            return cached
    counts, total, page = {}, 0, 1
    while True:
        d = joplin("GET", "/notes", {"fields": "id,parent_id", "limit": 100, "page": page})
        for n in d.get("items", []):
            counts[n.get("parent_id") or ""] = counts.get(n.get("parent_id") or "", 0) + 1
            total += 1
        if not d.get("has_more"):
            break
        page += 1
    _put("counts", (counts, total))
    return counts, total


def get_notes_in(folder_id, force=False):
    key = f"notes:{folder_id}"
    if not force:
        cached = _fresh(key, CACHE_TTL)
        if cached is not None:
            return cached
    items, page = [], 1
    while True:
        d = joplin("GET", f"/folders/{folder_id}/notes",
                   {"fields": "id,title,updated_time", "limit": 100, "page": page})
        items += d.get("items", [])
        if not d.get("has_more"):
            break
        page += 1
    _put(key, items)
    return items


def get_note(note_id, force=False):
    if not force:
        cached = _fresh(f"note:{note_id}", NOTE_CACHE_TTL)
        if cached is not None:
            return cached
    n = joplin("GET", f"/notes/{note_id}", {"fields": "id,title,body,parent_id,updated_time"})
    _put(f"note:{note_id}", n)
    return n


# ---------------------------------------------------------------- app
app = FastAPI(title="Joplin Notebook Map", docs_url=None, redoc_url=None, openapi_url=None)


def _joplin_error(path, exc):
    """Log the real upstream error; expose only a sanitized 502 to clients."""
    logger.warning("joplin error on %s: %s", path, exc)
    raise HTTPException(status_code=502, detail="upstream Joplin error") from exc


@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    resp.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'"
    return resp


@app.get("/api/health")
def health():
    try:
        counts, total = get_counts()
        return {"status": "ok", "joplin": "ok", "notes": total, "folders": len(get_folders())}
    except JoplinError:
        return {"status": "degraded", "joplin": "unreachable", "notes": 0, "folders": 0}


@app.get("/api/tree")
def tree(force: int = 0):
    try:
        folders = get_folders(force=bool(force))
        counts, total = get_counts(force=bool(force))
        return {"folders": folders, "counts": counts, "total_notes": total}
    except JoplinError as exc:
        _joplin_error("/api/tree", exc)


@app.get("/api/folders/{folder_id}/notes")
def folder_notes(folder_id: str, force: int = 0):
    try:
        return {"notes": get_notes_in(folder_id, force=bool(force))}
    except JoplinError as exc:
        _joplin_error(f"/api/folders/{folder_id}/notes", exc)


@app.get("/api/note/{note_id}")
def note(note_id: str, force: int = 0):
    try:
        return get_note(note_id, force=bool(force))
    except JoplinError as exc:
        _joplin_error(f"/api/note/{note_id}", exc)


@app.get("/api/search")
def search(q: str, limit: int = 20):
    if not q or not q.strip():
        return {"results": []}
    try:
        d = joplin("GET", "/search", {"query": q, "limit": min(limit, 50), "fields": "id,title,parent_id,updated_time"})
        return {"results": d.get("items", [])}
    except JoplinError as exc:
        _joplin_error("/api/search", exc)


# ---------------------------------------------------------------- graph
# Note-link graph for the interactive diagram view. Mirrors the link semantics
# of joplin_mapper.py: formal :/ links + unique 8-hex short-id references.
LINK_RE = re.compile(r":/[0-9a-f]{32}|openNote\?id=[0-9a-f]{32}")
SHORT_ID_RE = re.compile(r"(?<![0-9a-f])[0-9a-f]{8}(?![0-9a-f])")
GRAPH_TTL = 60


def get_all_notes(force=False):
    key = "all_notes"
    if not force:
        cached = _fresh(key, GRAPH_TTL)
        if cached is not None:
            return cached
    items, page = [], 1
    while True:
        d = joplin("GET", "/notes", {"fields": "id,title,parent_id,body", "limit": 100, "page": page})
        items += d.get("items", [])
        if not d.get("has_more"):
            break
        page += 1
    _put(key, items)
    return items


@app.get("/api/graph")
def graph(folder_id: str, mode: str = "notes", force: int = 0):
    """Interactive graph payload for a folder subtree.

    mode=notes: nodes = notes under the folder (recursive), links = internal
                references (formal :/ links + unique short-id refs).
    mode=tree:  nodes = subfolders, links = parent->child (clickable folder tree).
    """
    try:
        folders = get_folders(force=bool(force))
        children = defaultdict(list)
        for f in folders:
            children[f.get("parent_id") or ""].append(f)
        fids = set()

        def walk(pid):
            fids.add(pid)  # include the folder itself, not just descendants
            for c in children.get(pid, []):
                fids.add(c["id"])
                walk(c["id"])

        walk(folder_id)

        if mode == "tree":
            nodes = [{"id": f["id"], "title": f["title"], "kind": "folder", "parent": f.get("parent_id") or ""}
                     for f in folders if f["id"] in fids]
            links = [[f["parent_id"], f["id"]] for f in folders
                     if f["id"] in fids and f.get("parent_id") and f["parent_id"] in fids]
            return {"nodes": nodes, "links": links}

        notes = get_all_notes(force=bool(force))
        nids = {n["id"] for n in notes if n.get("parent_id") in fids}
        pref = defaultdict(list)
        for n in notes:
            pref[n["id"][:8]].append(n["id"])

        def soft(body):
            out = set()
            for m in LINK_RE.findall(body or ""):
                out.add(m[2:] if m.startswith(":/") else m.split("=")[1])
            for m in SHORT_ID_RE.findall(body or ""):
                cands = pref.get(m.lower(), [])
                if len(cands) == 1:
                    out.add(cands[0])
            return out

        edges = set()
        for n in notes:
            if n["id"] not in nids:
                continue
            for t in soft(n.get("body")):
                if t in nids and t != n["id"]:
                    edges.add(tuple(sorted((n["id"], t))))
        nodes = [{"id": n["id"], "title": n["title"] or "(untitled)", "folder": n.get("parent_id")}
                 for n in notes if n["id"] in nids]
        return {"nodes": nodes, "links": [list(e) for e in edges]}
    except JoplinError as exc:
        _joplin_error("/api/graph", exc)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
