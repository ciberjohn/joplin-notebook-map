# Operations

Deploying, updating and diagnosing the Joplin Notebook Map. Written for a single Linux host running Docker with a Joplin REST API on the same machine.

## 1. Before you deploy

1. Joplin is running and its REST API answers:

   ```bash
   TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.config/joplin/settings.json'))['api.token'])")
   curl -s "http://127.0.0.1:41184/ping?token=$TOKEN"     # -> JoplinClipperServer
   ```

   No answer means the clipper service is off (desktop: Tools → Options → Web Clipper) or Joplin is not running.

2. Docker and Compose are installed, and port 8910 is free:

   ```bash
   ss -ltnp | grep 8910 || echo free
   ```

## 2. First deploy

```bash
git clone https://github.com/ciberjohn/joplin-notebook-map.git
cd joplin-notebook-map
./scripts/make-env.sh                       # writes .env, mode 0600
docker compose up -d --build
curl -s http://127.0.0.1:8910/api/health
```

Expect `{"status":"ok","joplin":"ok",...}`. Then open `http://127.0.0.1:8910` from the host, or through your proxy from another device.

## 3. Exposure

The app is loopback-only. Two sane ways to reach it from elsewhere, both on the same host:

```bash
# Tailscale, tailnet peers only, TLS with a tailnet certificate
tailscale serve --bg --https=8443 http://127.0.0.1:8910
tailscale serve status

# or an SSH tunnel from the client
ssh -N -L 8910:127.0.0.1:8910 you@host
```

Do not expose it publicly without authentication in front. If you use Tailscale, `tailscale funnel` is the wrong command: it publishes to the internet, which is the opposite of what this service assumes.

## 4. Update

```bash
cd joplin-notebook-map
git pull
docker compose up -d --build
```

If the Joplin token changed, regenerate `.env` first and recreate rather than restart:

```bash
./scripts/make-env.sh && docker compose up -d --force-recreate
```

## 5. Health and logs

```bash
curl -s http://127.0.0.1:8910/api/health
docker compose logs --tail=50
```

`status: degraded` with HTTP 200 is the important distinction. The container healthcheck only asserts the HTTP status, so a degraded container still reports healthy to Docker. Read the JSON body, not the exit code.

## 6. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| 403 from Joplin, `status: degraded` | Wrong or stale token in `.env` | Regenerate with an explicit `JOPLIN_SETTINGS` path, recreate the container |
| 502 on every tab | Joplin API unreachable | `curl 127.0.0.1:41184/ping?token=…` on the host |
| Empty tree, healthy status | Token valid but pointing at a different, empty Joplin profile | Compare `notes` in `/api/health` with what the Joplin app shows |
| Port already in use | Another service on 8910 | `ss -ltnp \| grep 8910`, change the uvicorn port and the proxy target together |
| UI loads, nothing renders | Static files not copied into the image | `docker compose build --no-cache` |
| Graph is empty | No internal links in that folder subtree | Open a note and confirm it uses `:/<id>` links or unique 8-character IDs |

## 7. Uninstall

```bash
docker compose down
docker image rm joplin-notebook-map:0.1.3
```

That leaves `.env` and the clone on disk. Delete them yourself if you want them gone; neither is needed once the container is down.
