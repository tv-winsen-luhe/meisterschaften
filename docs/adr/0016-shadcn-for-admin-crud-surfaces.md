# ADR-0016: shadcn/ui for the admin CRUD surfaces — default look, admin-only, the Show carved out

- Status: accepted
- Date: 2026-06-26

## Context

The admin is already a React island (ADR-0008): ~600 lines across `src/admin/`, styled with
hand-rolled Tailwind class strings in `src/admin/styles.ts` (the legacy `admin.css` base translated to
utilities). The admin is set to grow substantially — scheduling grid (`dnd-kit`), results entry, phase
control, the post-event purge. Three things converged that hand-rolled styling answers badly: (1) the
admin looks self-built and wants polish without pinning CSS; (2) accessible interactive primitives
(dialog, dropdown, select, combobox, toast) are painful and error-prone to hand-roll correctly
(focus-trap, ARIA, keyboard); (3) the upcoming surfaces want forms/tables/dialogs not reinvented each
time.

This sits against CLAUDE.md's standing principle — _prefer the simple solution; don't add abstraction
before it's needed_ — so adopting a component system is a deliberate exception, recorded here.

## Decision

1. **Adopt the full shadcn/ui model, not just hand-picked Radix.** The CLI copies component source into
   the repo, plus `components.json`, the `cn()` util (`clsx` + `tailwind-merge`), CSS-variable theming,
   and `cva` for variants. Only the full model serves all three drivers at once: Radix alone delivers
   accessible primitives (2) and build-speed (3) but leaves the polish (1) as hand-work — the very work
   being escaped. We own the copied source (no version lock-in; also no Dependabot updates for it).
   New runtime deps: `clsx`, `tailwind-merge`, `class-variance-authority`, several `@radix-ui/*`,
   `lucide-react` — all pure JS, so `allowBuilds` in `pnpm-workspace.yaml` is unaffected.

2. **shadcn's default (neutral) look — no theming onto the event branding.** The CRUD admin is a
   private operator tool behind Cloudflare Access: one person entering results from a phone during Live.
   Brand cohesion with the public site has no value (disjoint audiences); theming would cost real work
   and eat the polish-for-free that motivated (1). Consequence: the legacy look in `styles.ts` (the
   `--color-blue` focus ring, the press-down) is replaced, not preserved — `styles.ts` is deleted.

3. **The draw reveal show is carved out — it is not a shadcn surface.** The admin has two natures. The
   **operator CRUD surfaces** (registrations, results entry, phase control, scheduling grid) get
   shadcn-default. The **presentation surface** (draw reveal show, projected on a TV/beamer to a room of
   members) is its own large, event-toned view built with React + `motion`, sharing the data chain but
   not the component vocabulary — it needs no dialog/dropdown/table/cva-button. So shadcn is scoped as
   "the component system of the operator CRUD surfaces," a narrower line than "the styling of the whole
   React area."

4. **Components live under `src/admin/ui/`, not the conventional `@/components/ui/`.** `src/components/`
   is this repo's _public Astro_ component directory (zero-JS); placing `.tsx` + Radix there would make
   a bleed into a public page trivial and leave ADR-0008's boundary as discipline, not structure.
   `components.json` points its `ui` alias at `@/admin/ui` and `utils` at `@/admin/lib/utils`. The
   boundary is then _locational_: everything under `src/admin/` is React/Radix land; everything in
   `src/components/` stays Astro/zero-JS — a stray cross-import screams in the path at review.

5. **The admin gets its own CSS entry; `admin.astro` stops importing `global.css`.** Today
   `src/pages/admin.astro` imports `../styles/global.css` — the same file the public site loads, with
   all event `@theme` tokens. shadcn's CSS variables (`--background`, `--primary`, …) must not leak
   there. A new `src/admin/admin.css` carries its own `@import 'tailwindcss'` + shadcn `:root`/`@theme
inline` vars; `admin.astro` imports only that. The admin shell thereby drops its event tokens
   (`bg-surface-alt`, `text-text`, the `--color-border` grid background) for shadcn's `bg-background
text-foreground`. `global.css` stays purely public — the zero-JS site never carries shadcn theme
   tokens.

6. **Migrate the existing surface first, then build new on the clean base.** The existing registration
   surface (app shell + `registration-card.tsx`) is ported to shadcn first and `styles.ts` is deleted
   in the same move — a single component vocabulary, no long-lived dual system (the worst outcome, and
   exactly what driver (1) complained about). This front-loads the integration risk (Tailwind-4
   CSS-first fit, `components.json`, `cn()`, the admin CSS entry) onto code already understood, rather
   than discovering setup bugs while _designing_ the scheduling grid.

## Consequences

- The deliberate deviation from "prefer the simple solution": a component system with Radix + `cva` +
  copied source enters the repo. Justified by a growing admin and all three drivers at once; confined
  to the gated admin so it never touches the public bundle.
- shadcn's copied components are owned source, not a tracked dependency — no Dependabot churn, but also
  no automatic security/upgrade flow; updating a component is a manual re-pull.
- Tailwind 4 is CSS-first here (`@tailwindcss/vite`, `@theme`, no `tailwind.config.js`); shadcn's
  Tailwind-4 mode fits. The admin runs a second Tailwind entry (`admin.css`) alongside the public
  `global.css` — independent token sets, independent dark-mode policy (the public site is
  `color-scheme: only light`; the admin decides for itself).
- `minimumReleaseAge: 1440` applies on install — `pnpm add` must not grab a same-day release of any new
  dep; all chosen libs have stable versions far older than a day.
- ADR-0008 stands and is sharpened: React is still confined to the gated admin, and now shadcn is
  confined to the admin's CRUD surfaces specifically, enforced by location (`src/admin/`) and by a
  separate admin CSS entry — boundary as structure, not convention.
- The draw reveal show's styling is explicitly out of scope here; it gets its own treatment when built.
