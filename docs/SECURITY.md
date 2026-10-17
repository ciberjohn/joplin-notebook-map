# Security

What this service exposes, what it does not, and which controls are worth keeping if you change it.

## 1. Assets

The asset is your notebook. Everything readable through the Joplin REST API is readable through this app, because the app holds the token that talks to it. The container itself holds nothing else: no database, no user accounts, no write access.

## 2. Trust boundaries

| Boundary | Attacker | Reachable? |
|---|---|---|
| Public internet | anyone | No. Nothing is published; the only way in is whatever proxy you put in front of loopback. |
| Your private network or tailnet | other devices and users on it | Yes, if your proxy exposes it to them. Browsing the notebook is the product. Put identity in front if that network is not entirely yours. |
| Host shell | anyone with a shell | Yes, fully. A host compromise reads `.env` and the Joplin settings directly. Container hardening limits blast radius, it cannot save you from a rooted host. |

## 3. Network exposure

- uvicorn binds `127.0.0.1:8910` inside a host-networked container. Nothing listens on a public interface.
- Any external access should terminate TLS in a proxy on the same host and proxy to loopback.
- Do not change `--host 127.0.0.1` to `0.0.0.0` in the Dockerfile. If you need container-bridge networking instead of host networking, publish the port as `127.0.0.1:8910:8910` and bind the app to a container interface, never to a public one.
- Never put this behind a public tunnel without an authentication layer. A URL is not an access control.

## 4. Container hardening

| Control | Setting |
|---|---|
| Runtime user | `appuser`, uid 10001, `nologin`, no password |
| Root filesystem | `read_only: true` |
| Writable paths | `/tmp` only, 8 MB tmpfs |
| Capabilities | `cap_drop: [ALL]` |
| Privilege escalation | `no-new-privileges: true` |
| Secrets in image | none; token injected at runtime |
| Base image | `python:3.12-slim-bookworm`, pinned by digest |

Dependencies are pinned with `--require-hashes` in `app/requirements.txt`, and the build uses `--require-hashes`, so a tampered index cannot swap a package silently.

## 5. API surface

Six GET endpoints, all read-only. There is no POST, PUT, PATCH or DELETE in the app, and no endpoint accepts a Joplin write parameter. If you add one, you are changing the threat model: a write endpoint turns a leaked token from a disclosure into a corruption risk.

## 6. Response hygiene

- Upstream Joplin errors are logged server-side in full and returned as `502 upstream Joplin error`. Tokens and note fragments do not reach the browser in error text.
- Security headers are set by middleware on every response: CSP `default-src 'self'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS.
- The search box sends the query to `/api/search` and nowhere else. There is no analytics, no CDN, no external font.

## 7. Note content is untrusted input

Notes come from the web clipper, from email, from anywhere. The preview renders into a sandboxed DOM with Mermaid in `securityLevel: strict`, and the page never evaluates note HTML as script. Keep it that way when changing the renderer: `innerHTML` with note bodies and a relaxed CSP is how a read-only app turns into a stored-XSS gadget.

## 8. Token handling

- `scripts/make-env.sh` writes `.env` with mode 0600 and a `umask 077`.
- `.env` is gitignored. `.env.example` carries a placeholder only.
- Stale-token symptom: HTTP 403 from Joplin and `status: degraded` in the UI. That usually means `.env` was generated from a different Joplin profile than the one you think you are pointing at. Regenerate with an explicit `JOPLIN_SETTINGS` path and `docker compose up -d --force-recreate`.
- Rotate the token in Joplin settings and rerun `make-env.sh` if it was ever pasted into a chat, a ticket, or a screenshot.
