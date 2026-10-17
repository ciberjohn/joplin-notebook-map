# Joplin Notebook Map

A read-only web view of a Joplin notebook: click a notebook to expand it, click a note to read it, and open the same note in Joplin with one click. It is built on Joplin's own REST API, not on a plugin.

The static Mermaid maps people draw by hand answer "what is in my notebook" for a week. This answers it for the next two years, because the tree is read live from Joplin every time you open the page.

- **Notebook tree**: the whole hierarchy, expand and collapse, live note counts
- **Note list and preview**: newest first, full note body rendered, Mermaid fences drawn
- **Full-text search**: Joplin's own FTS, not a reimplementation
- **Graph view**: note-to-note links, or the folder tree as a clickable diagram, with drag, wheel zoom and pan
- **Open in Joplin**: `joplin://` deep links from the browser
- **Read-only**: no write endpoints exist in the app at all

## Why not a plugin

Joplin's plugin API is deliberately narrow (panels, editor commands and a private data folder). Reading the entire notebook, walking every folder and rendering an arbitrary note is better done against the REST API that Joplin already ships for its web clipper. The app is therefore a small FastAPI service, not an extension inside Joplin.

## Architecture

```
browser ── HTTP(S) ──► 127.0.0.1:8910   FastAPI + static UI
                            │
                            ▼
                    Joplin REST API      127.0.0.1:41184
```

The container binds loopback only. If you want to reach it from another device, put a TLS-terminating proxy in front of it on the same host: Tailscale Serve, Caddy, nginx, or an SSH tunnel. Never publish port 8910 to the internet.

## Requirements

- Joplin with its REST API reachable. The desktop app exposes it through the Web Clipper service (Tools → Options → Web Clipper), which runs only while the app is open. A headless Joplin instance works as well; either way the API listens on `127.0.0.1:41184` by default.
- Docker with Compose, on Linux. Host networking is used so the container can reach the Joplin API on the host's loopback.
- The API token from Joplin settings (`api.token` in `~/.config/joplin/settings.json`).

## Quick start

```bash
git clone https://github.com/ciberjohn/joplin-notebook-map.git
cd joplin-notebook-map

# writes .env (mode 0600) from your Joplin settings — never committed
./scripts/make-env.sh

docker compose up -d --build
curl -s http://127.0.0.1:8910/api/health
# {"status":"ok","joplin":"ok","notes":1234,"folders":56}
```

If your Joplin settings live somewhere unusual, point the script at them:

```bash
JOPLIN_SETTINGS=/path/to/settings.json ./scripts/make-env.sh
```

`status: degraded` means the app is up but cannot reach Joplin or the token was rejected. Run the app on the host (`uvicorn main:app --host 127.0.0.1 --port 8910`) and read the log line naming the failing call.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `JOPLIN_API_TOKEN` | required | Joplin API token |
| `JOPLIN_TOKEN_FILE` | unset | Alternative: read the token from a mounted file |
| `JOPLIN_API_BASE` | `http://127.0.0.1:41184` | Where the Joplin REST API lives |
| `CACHE_TTL` | `60` | Seconds to cache the folder tree, note counts and note lists |
| `NOTE_CACHE_TTL` | `30` | Seconds to cache a note body |

## API

| Endpoint | Returns |
|---|---|
| `GET /api/health` | Liveness plus Joplin reachability and totals |
| `GET /api/tree?force=1` | Flat folder list, per-folder note counts, total notes |
| `GET /api/folders/{id}/notes` | Notes directly inside one folder |
| `GET /api/note/{id}` | One note: title, body, parent, updated time |
| `GET /api/search?q=…&limit=20` | Joplin full-text search results |
| `GET /api/graph?folder_id=…&mode=notes\|tree` | Graph payload: note links, or folder tree |

Every route is a read. Upstream errors are logged in full and returned to the client as a plain `502 upstream Joplin error`, so token values and note content never leak into error responses.

## Security posture

- Binds `127.0.0.1` only; no published ports, no LAN or internet exposure of its own
- Runs as uid 10001 with a read-only rootfs, all capabilities dropped, `no-new-privileges`
- The token comes from `.env` or a mounted secret file, never from the image
- CSP `default-src 'self'`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS
- Mermaid renders with `securityLevel: strict`, so note content stays inert

Details in [docs/SECURITY.md](docs/SECURITY.md) and [docs/OPERATIONS.md](docs/OPERATIONS.md).

The obvious caveat: anything that can read the token can read every note you own. Treat the token like a password, keep the service on loopback, and put authentication in front of it if more than one person can reach the host.

## Limits worth knowing

- Read-only by design. There is no create, edit, move or delete.
- The folder tree is loaded whole on refresh, then cached. Fine for tens of thousands of notes; not built for a hundred thousand.
- The graph matches formal Joplin links and unique eight-character note IDs. Ambiguous short IDs are ignored rather than guessed.
- Desktop Joplin must be running for its clipper API to be reachable. A headless instance avoids that.

## Licence

MIT. See [LICENSE](LICENSE).
