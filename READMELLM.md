# READMELLM.md · Installing Market Radar (guide for AI agents)

You are an AI agent (Claude Code, Codex, Cursor, an SSH-capable assistant…) asked to install
Market Radar for a person, on their home server or a VPS. This file is written for you: follow it
in order, check each step, and stop at the decision points instead of guessing.

The human-facing documentation is in `README.md` (French). The app UI is in French; talk to the
person in their language.

## 0. What you are installing

A self-hosted job-search assistant: Docker Compose stack of 5 services.

| Service | Container | Port (host) | Notes |
|---|---|---|---|
| `backend` | `market-radar-convex` | 3210, 3211 | Convex self-hosted: database + file storage. Data in volume `market-radar-convex-data`. |
| `dashboard` | `market-radar-convex-dashboard` | 6791 | Convex admin UI, needs the admin key. |
| `web` | `market-radar-web` | 3100 | The app. `VITE_CONVEX_URL` is baked in at build time. |
| `worker` | `market-radar-worker` | none | Cron loop: scraping, local AI, Typst PDFs, SMTP, read-only IMAP. |
| `ollama` | `market-radar-ollama` | 11434 on 127.0.0.1 only | Local LLM. Model in volume `market-radar-ollama-data`. |

There are **no user accounts**. Whoever reaches ports 3100/3210 can read every CV and application.

## 1. Non-negotiable rules

1. **Never print secrets.** Do not `cat .env`, do not echo `SMTP_PASS`, `IMAP_PASS`,
   `CONVEX_INSTANCE_SECRET` or the admin key. To check a key exists: `grep -c '^KEY=.' .env`.
2. **Never destroy data.** No `docker compose down -v`, no `docker volume rm market-radar-*`,
   no `convex import --replace-all` unless the person explicitly asks for a reset.
3. **Never expose the app to the Internet.** On a VPS, bind to Tailscale or to 127.0.0.1 (step 3).
4. **Never send an email for the person.** Do not set `REPORT_EMAIL_ENABLED=true`, do not click
   "Lancer cette routine maintenant", do not confirm an application send, unless the person asks.
   Watch reports are automated by design; **job applications always need a human click**.
5. **Ask before** opening firewall ports, installing Tailscale, creating accounts, or entering
   passwords. Ask the person for any password you need; never guess one.
6. Do not rewrite the stack (Convex, TanStack Start, Ollama are deliberate choices).

## 2. Preflight (read-only)

Run on the target machine and report the results:

```bash
uname -m                                  # x86_64 is tested; arm64 should work (untested)
docker version --format '{{.Server.Version}}'   # need Docker Engine 24+
docker compose version                    # need Compose v2
free -g | head -2                         # 8 GB RAM minimum (model uses ~5 GB)
df -h .                                   # 15 GB free minimum
nproc
command -v tailscale && tailscale ip -4   # if present, prefer it on a VPS
docker ps --format '{{.Names}}' | grep -c market-radar   # >0 means already installed
```

- Docker missing → ask permission, then install with the official script
  (`curl -fsSL https://get.docker.com | sh`) and add the user to the `docker` group.
- Less than 8 GB RAM → tell the person: scraping and the radar work, CV import and
  application generation will be slow or fail. Offer `--model` with a smaller model.
- Already installed → skip to section 6 (update), do not reinstall.

## 3. Decide the network setup (ask the person)

| Situation | `--host` | `--bind` |
|---|---|---|
| Home server, used from the home network | the server's LAN IP (`hostname -I \| awk '{print $1}'`) | `0.0.0.0` |
| VPS with Tailscale (recommended) | `$(tailscale ip -4)` | `$(tailscale ip -4)` |
| VPS without Tailscale | `localhost` | `127.0.0.1` (the person uses an SSH tunnel) |

`--host` is the address the person's **browser** uses. It ends up in the web bundle and in
`CONVEX_PUBLIC_URL`, `CONVEX_SITE_URL`, `APP_PUBLIC_URL`.

If the person wants a domain name with HTTPS behind a reverse proxy, tell them it needs an
authentication layer in front of both the app and Convex (websocket); prefer Tailscale.

## 4. Install

```bash
git clone https://github.com/simonw31/market-radar.git
cd market-radar
./install.sh --host <HOST> --bind <BIND> --yes
```

What it does (idempotent, safe to re-run):

1. Checks Docker, RAM, disk.
2. Creates `.env` from `env.example` (mode 600) and fills the URLs. Keeps an existing `.env`.
3. Generates `CONVEX_INSTANCE_SECRET` for a new database only.
4. Starts `backend`, `dashboard`, `ollama`; waits for Convex to be healthy.
5. Pulls the Ollama model (`qwen3.5:4b`, ~3.4 GB) if missing.
6. Builds the worker image and deploys `convex/` with `npx convex deploy` **inside the worker
   image** (that image holds its own copy of the code: rebuild it before every deploy).
7. Builds and starts `web` and `worker`.

Expected end: `Market Radar est prêt.` followed by the URLs. Exit code 0.

First run takes 5 to 15 minutes (npm install in Docker, model download).

## 5. Verify

```bash
docker compose ps                                   # 5 services up, backend "healthy"
curl -s -o /dev/null -w '%{http_code}\n' http://<BIND or localhost>:3100     # 200
curl -s -X POST http://<BIND or localhost>:3210/api/query \
  -H 'content-type: application/json' \
  -d '{"path":"jobs:overview","args":{},"format":"json"}' | head -c 200      # "status":"success"
docker compose logs --tail 20 worker                # no crash loop
```

Then hand over to the person (they do these steps in the UI, in French):

1. Open `APP_PUBLIC_URL` → **Profils** → create their profile (contracts, keywords, owner email).
2. **Candidature** → upload their CV as PDF → wait ~3 min → review and validate it.
3. **Collecte** → **Lancer une collecte** (collection only, sends no email).
4. Optional Chrome extension: `chrome://extensions` → Developer mode → Load unpacked →
   `extension/` → click the icon → **Réglages** → server `CONVEX_PUBLIC_URL`, app
   `APP_PUBLIC_URL` → **Enregistrer** (Chrome asks for access to those two addresses).

## 6. Update an existing install

```bash
cd market-radar
./ops/update.sh          # git pull, deploy functions, rebuild web + worker
```

It refuses while a task is running (collection, AI generation). Wait, or `--force`
only if the person agrees (the task is retried after restart).

## 7. Optional: emails

Only if the person asks. Edit `.env` (do not print it), then `docker compose up -d worker`.

| Goal | Keys |
|---|---|
| Watch reports | `REPORT_EMAIL_ENABLED=true`, `REPORT_EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |
| Reply tracking (read-only IMAP) | nothing for Gmail (reuses SMTP); otherwise `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` |

Gmail / Google Workspace needs an app password (2-step verification on). Ask the person to paste
it into `.env` themselves, or ask them for it and write it without echoing it.

To set a value without printing the file:

```bash
. ops/lib.sh && env_set SMTP_USER 'name@example.com'
```

## 8. Backups

```bash
./ops/backup.sh          # → backups/market-radar-<date>.zip (database + PDFs), mode 600
```

The archive contains CVs and personal data: keep it private. Restore command is in the
header of `ops/backup.sh` (destructive: ask first).

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| App loads but stays empty / "connexion" spinner | The browser cannot reach `CONVEX_PUBLIC_URL`. Fix `--host`, then `./install.sh --host <new> --yes` (rebuilds web). |
| `Le déploiement des fonctions Convex a échoué` | Read the printed error. TypeScript errors in `convex/`: run `npx tsc --noEmit -p convex`. Convex compiles to ES2021 (no `Array.prototype.at`). |
| Deploy succeeds but old behaviour remains | The worker image was not rebuilt before `convex deploy`. Use `./ops/update.sh`, never a bare `convex deploy`. |
| CV import stuck on "Extraction" | Ollama model missing or RAM too low: `docker exec market-radar-ollama ollama list`, `free -g`. |
| PDFs fail to render | Worker logs mention Typst: rebuild the worker image (`docker compose build worker`). |
| Extension says "Serveur injoignable" | Popup → Réglages: the server address must be `CONVEX_PUBLIC_URL`, and the computer must reach it (Tailscale up, or SSH tunnel open). |
| Port already in use | Another service uses 3100/3210/6791: stop it, or edit the host side of `ports:` in `docker-compose.yml` and the matching URLs in `.env`. |

## 10. Report back

End with a short summary for the person: URLs, what was installed, what is left for them to do
(profile, CV, extension), and anything you skipped and why. Never include secrets in it.
