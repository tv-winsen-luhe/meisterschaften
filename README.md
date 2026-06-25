# Winsener Meisterschaften 2026

Website zur **Stadtmeisterschaft von TV Winsen/Luhe und TSV Winsen** am **22./23. August 2026** —
mit Online-Anmeldung und öffentlicher, live wachsender Teilnehmerliste.

**Geplant live:** <https://meisterschaften.tennisverein-winsen.de/>

## Tech

- [Astro 7](https://astro.build/) — statische Site, zero client JS by default
- [Tailwind CSS 4](https://tailwindcss.com/) via `@tailwindcss/vite`
- TypeScript (strict)
- pnpm, Node 24
- **Ein Cloudflare Worker** liefert die statische Seite (Workers Assets) **und** die API
  (Anmeldung, Teilnehmerliste, Admin) aus — same-origin, kein CORS. Daten in **Cloudflare D1**.

## Architektur

```
meisterschaften.tennisverein-winsen.de  →  ein Worker
  ├─ statische Astro-Seite (dist/ als Assets)
  ├─ POST /api/register       Anmeldung speichern (status='new')
  ├─ POST /api/cancel         Selbst-Abmeldung (E-Mail + Nachname → status='cancelled')
  ├─ GET  /api/participants   öffentliche, bestätigte Liste (Name, Verein, Konkurrenz, LK)
  ├─ GET  /admin              Access-geschützte Admin-Seite (bestätigen, LK setzen, verstecken)
  ├─ POST /api/admin/*        Admin-API (list, update, refresh-lk)
  └─ D1   Tabelle „registrations"
```

- Konkurrenzen: **Herren**, **Herren Challenger** (geschützt, ab LK 20) und **Damen** (in Planung,
  aber bereits im Formular wählbar).
- Anmeldungen erscheinen **erst nach Bestätigung** durch die Turnierleitung öffentlich
  (Confirm-Gate). Das Bestätigen im Admin ist zugleich der Übertrag in nuTurnier.
- **Abmeldung:** Mitglieder ziehen ihre Anmeldung selbst über `/abmelden` zurück (Abgleich aus
  E-Mail + Nachname, Status `cancelled` → fällt sofort aus der öffentlichen Liste).
- Die **LK** wird nicht abgefragt, sondern beim Bestätigen im Admin gesetzt (Default `25.0`).
- Kill-Switch `PUBLIC_LIST_ENABLED` (in `wrangler.toml`) schaltet die öffentliche Liste an/aus.

## Admin-Zugang (Cloudflare Access)

Die Operator-Flächen (`/admin`, `/api/admin/*`) sind **in Produktion durch Cloudflare Zero Trust
Access am Edge** abgesichert — Login per **E-Mail-OTP** (One-time PIN) über das Team-Portal
`https://tv-winsen.cloudflareaccess.com`. Unauthentifizierte Requests werden vom Edge auf den
Login umgeleitet und erreichen den Worker gar nicht erst. Die öffentliche API (`/api/participants`)
und der wöchentliche Cron bleiben **außerhalb** von Access.

- Zugang verwalten (erlaubte E-Mails): Cloudflare-Dashboard → **Zero Trust → Access → Applications
  → „Winsener Meisterschaften – Admin"**.
- **Kein `ADMIN_TOKEN` mehr** — der Worker hat keine eigene Auth, Access am Edge ist der einzige
  Gate (ADR-0008). Zwei Dinge tragen das ab: `workers_dev = false` (keine ungeschützte
  `*.workers.dev`-URL als zweiter Hostname) und die Regel, dass **jede Operator-Route unter
  `/api/admin/*` liegen muss** — eine Route außerhalb wäre von Geburt an öffentlich. Lokal
  (`wrangler dev`) greift Access nicht und es gibt keinen Token: die Admin ist auf `localhost`
  schlicht offen.

## Lokal entwickeln

```bash
pnpm install
pnpm dev          # Astro-Dev-Server (ohne API) auf http://localhost:4321
pnpm cf-dev       # Build + `wrangler dev` (Seite + API + lokale D1) auf http://localhost:8787
pnpm build        # astro check + build
pnpm lint         # ESLint
pnpm format       # Prettier
```

Für die lokale D1 beim ersten `wrangler dev` die Migrationen einspielen:

```bash
wrangler d1 migrations apply winsener-meisterschaften --local
```

## Deployment (Cloudflare-Account „TV Winsen / Luhe")

```bash
wrangler login                                    # mit dem Vereins-Cloudflare-Account
export CLOUDFLARE_ACCOUNT_ID=<account-id>         # liegt nicht mehr in wrangler.toml
wrangler d1 create winsener-meisterschaften       # database_id → wrangler.toml
wrangler d1 migrations apply winsener-meisterschaften --remote   # Schema aus worker/migrations/
pnpm cf-deploy                                    # = pnpm build && wrangler deploy
```

Danach Custom Domain `meisterschaften.tennisverein-winsen.de` im Cloudflare-Dashboard auf den
Worker legen. Admin: `…/admin` (Login per Cloudflare Access / E-Mail-OTP).

### Automatischer Deploy (CI)

Bei jedem Push auf `main` baut und deployt GitHub Actions automatisch zum Worker
(`.github/workflows/deploy.yml`: lint → format:check → build → `wrangler deploy`). Dafür muss im
Repo einmalig ein Secret hinterlegt sein:

- **`CLOUDFLARE_API_TOKEN`** (Secret) — Cloudflare-API-Token mit „Edit Cloudflare Workers"-Rechten
  (Account „TV Winsen / Luhe"), zusätzlich D1: Edit. Setzen via
  `gh secret set CLOUDFLARE_API_TOKEN` oder in den GitHub-Repo-Settings → Secrets.
- **`CLOUDFLARE_ACCOUNT_ID`** (Variable) — die Cloudflare-Account-ID. Als Repo-_Variable_ (kein
  Secret, da kein Geheimnis) hinterlegt via `gh variable set CLOUDFLARE_ACCOUNT_ID` oder in den
  GitHub-Repo-Settings → Variables.

In `wrangler.toml` steht nur die `database_id`; die `account_id` zieht Wrangler aus
`CLOUDFLARE_ACCOUNT_ID` (lokal als Env-Variable, in CI aus der Repo-Variable). Die Worker-Secrets
(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) bleiben über Deploys hinweg erhalten und
müssen nicht erneut gesetzt werden.

> Die D1-Datenbank kann auch via Cloudflare-MCP angelegt und befüllt werden — dann entfallen die
> `wrangler d1`-Schritte (nur `database_id` aus dem MCP-Ergebnis in `wrangler.toml` eintragen).

## Lizenz

© 2026 Tennisverein Winsen (Luhe) von 1913 e.V. — alle Rechte vorbehalten. Siehe [`LICENSE`](./LICENSE).
