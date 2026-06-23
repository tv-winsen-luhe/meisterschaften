# Winsener Meisterschaften 2026

Website zur **Stadtmeisterschaft von TV Winsen/Luhe und TSV Winsen** am **22./23. August 2026** —
mit Online-Anmeldung und öffentlicher, live wachsender Teilnehmerliste.

**Geplant live:** <https://meisterschaften.tennisverein-winsen.de/>

## Tech

- [Astro 6](https://astro.build/) — statische Site, zero client JS by default
- [Tailwind CSS 4](https://tailwindcss.com/) via `@tailwindcss/vite`
- TypeScript (strict)
- pnpm, Node 24
- **Ein Cloudflare Worker** liefert die statische Seite (Workers Assets) **und** die API
  (Anmeldung, Teilnehmerliste, Admin) aus — same-origin, kein CORS. Daten in **Cloudflare D1**.

## Architektur

```
meisterschaften.tennisverein-winsen.de  →  ein Worker
  ├─ statische Astro-Seite (dist/ als Assets)
  ├─ POST /api/anmeldung      Anmeldung speichern (status='neu')
  ├─ GET  /api/teilnehmer     öffentliche, bestätigte Liste (Name, Verein, Konkurrenz, LK)
  ├─ GET  /admin              token-geschützte Admin-Seite (bestätigen, LK setzen, verstecken)
  ├─ GET  /export?token=…     CSV aller Anmeldungen
  └─ D1   Tabelle „meldungen"
```

- Anmeldungen erscheinen **erst nach Bestätigung** durch die Turnierleitung öffentlich
  (Confirm-Gate). Das Bestätigen im Admin ist zugleich der Übertrag in nuTurnier.
- Die **LK** wird nicht abgefragt, sondern beim Bestätigen im Admin gesetzt (Default `25.0`).
- Kill-Switch `PUBLIC_LIST_ENABLED` (in `wrangler.toml`) schaltet die öffentliche Liste an/aus.

## Lokal entwickeln

```bash
pnpm install
pnpm dev          # Astro-Dev-Server (ohne API) auf http://localhost:4321
pnpm cf-dev       # Build + `wrangler dev` (Seite + API + lokale D1) auf http://localhost:8787
pnpm build        # astro check + build
pnpm lint         # ESLint
pnpm format       # Prettier
```

Für die lokale D1 beim ersten `wrangler dev`:

```bash
wrangler d1 execute winsener-meisterschaften --local --file=worker/schema.sql
```

## Deployment (Cloudflare-Account sportwart@tennisverein-winsen.de)

```bash
wrangler login                                   # als sportwart@…
wrangler d1 create winsener-meisterschaften       # database_id → wrangler.toml
wrangler d1 execute winsener-meisterschaften --remote --file=worker/schema.sql
wrangler secret put ADMIN_TOKEN                   # Admin-/Export-Token vergeben
pnpm cf-deploy                                    # = pnpm build && wrangler deploy
```

Danach Custom Domain `meisterschaften.tennisverein-winsen.de` im Cloudflare-Dashboard auf den
Worker legen. Admin: `…/admin` (Token eingeben). CSV: `…/export?token=<ADMIN_TOKEN>`.

### Automatischer Deploy (CI)

Bei jedem Push auf `main` baut und deployt GitHub Actions automatisch zum Worker
(`.github/workflows/deploy.yml`: lint → format:check → build → `wrangler deploy`). Dafür muss im
Repo einmalig ein Secret hinterlegt sein:

- **`CLOUDFLARE_API_TOKEN`** — Cloudflare-API-Token mit „Edit Cloudflare Workers"-Rechten
  (Account „TV Winsen / Luhe"), zusätzlich D1: Edit. Setzen via
  `gh secret set CLOUDFLARE_API_TOKEN` oder in den GitHub-Repo-Settings → Secrets.

`account_id` und `database_id` stehen in `wrangler.toml`; die Worker-Secrets (`ADMIN_TOKEN`)
bleiben über Deploys hinweg erhalten und müssen nicht erneut gesetzt werden.

> Die D1-Datenbank kann auch via Cloudflare-MCP angelegt und befüllt werden — dann entfallen die
> `wrangler d1`-Schritte (nur `database_id` aus dem MCP-Ergebnis in `wrangler.toml` eintragen).

## Inhaltliche Quelle

Redaktionelle Grundlage ist die Ausschreibung im Vereins-Vault
(`vault/documents/rules/Ausschreibung Winsener Meisterschaften 2026.md`). Offene Punkte
(Damen-Konkurrenz, Rahmenprogramm, Kontaktdaten, DSGVO-Freigabe) sind als Platzhalter markiert.

## Lizenz

© 2026 Tennisverein Winsen (Luhe) von 1913 e.V. — alle Rechte vorbehalten. Siehe [`LICENSE`](./LICENSE).
