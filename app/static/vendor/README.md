# Vendored third-party assets

| File | Upstream | Version | License |
|---|---|---|---|
| `mermaid.min.js` | https://github.com/mermaid-js/mermaid (jsdelivr: `mermaid@10.9.1/dist/mermaid.min.js`) | 10.9.1 | MIT |

Vendored locally so the app renders diagrams with **zero external network calls**
(tailnet-only, CSP `default-src 'self'`). Renderer initialized in `app.js`
(`theme: dark`, `securityLevel: strict` — note content stays inert).
