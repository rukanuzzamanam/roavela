# Roavela

**Find somewhere worth the drive.**

Roavela is an Australian travel marketplace built around one idea: discover stays and weekend escapes by **how far you want to drive**. It starts with Sydney as the primary origin (Blue Mountains, Hunter Valley, Kiama, Jervis Bay…), but nothing in the architecture is tied to Sydney, NSW or Australia.

> **Status: Phase 1 (foundation).** Architecture, database, authentication, design system, homepage and demo search are built. Booking, payments, host portal, admin tools, explore, trip planner and destination SEO pages come in later phases — see [Roadmap](#roadmap).

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript 5.9 |
| Styling | Tailwind CSS 4 (CSS-first tokens in `src/app/globals.css`) |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg` driver adapter) |
| Validation | Zod 4 |
| Auth | Database-backed sessions (bcrypt + hashed opaque tokens) — see [Security](#security-notes) |
| Tests | Vitest (unit + DB integration) |
| Providers | Interfaces with no-key fallbacks: routing (heuristic), maps (schematic), analytics (console), email (console), rate limit (memory) |

Prisma is pinned to **7.10 (stable)**. At the time of writing npm's `latest` tag pointed at an 8.0 release candidate, which was deliberately not used.

## Architecture

```
Browser ──► Next.js App Router (src/app)          routes only: fetch → render
              │
              ├── components/        UI (design system in components/ui)
              ├── lib/               pure logic: pricing, dates, geo, permissions, validation
              │                      (no I/O, no framework — unit tested)
              └── server/            server-only
                    ├── auth/        sessions, password hashing, guards
                    ├── actions/     Server Actions (mutations; always re-authorise)
                    ├── services/    data access & domain logic (search, fees, properties)
                    ├── providers/   external-service interfaces + local fallbacks
                    ├── rate-limit.ts, env.ts, db.ts
```

Key design decisions:

- **Location model is generic.** `Destination` is a hierarchical place (`COUNTRY → STATE → CITY/REGION/TOWN`) with a country code, admin area and timezone. Any destination can be an origin (`isOrigin`).
- **Drive times are data, not code.** `DriveEstimate` stores origin → destination estimates tagged `MANUAL_ESTIMATE | HEURISTIC | ROUTING_API`. A routing provider (Mapbox/Google) can overwrite rows later without schema changes. Property-level times add a heuristic local leg and are always labelled *approx.*
- **Money is integer minor units** with a currency code. Fees are **basis points** in a versioned `PlatformFeeSchedule` table (global or per-country, with `effectiveFrom`). Bookings snapshot the rates and amounts they were created with.
- **Double bookings are impossible at the database level.** The initial migration adds a PostgreSQL `EXCLUDE USING gist` constraint rejecting overlapping `PENDING`/`CONFIRMED` bookings for the same property. Application checks exist too, but the database is the final arbiter (tested with concurrent inserts).
- **Only `PUBLISHED` properties are searchable.** New listings start as `DRAFT`/`PENDING_REVIEW` and need admin approval.
- **Demo data is quarantined.** Every seeded row has `isDemo = true`; demo listings show a "Demo listing" badge, are `noindex`, and are **hidden in production** unless `SHOW_DEMO_LISTINGS=true`.

### Marketplace fee maths

Fees apply to accommodation + cleaning. With the default schedule (6% guest fee, 4% host commission):

| | |
|---|---|
| Stay subtotal | $800.00 |
| Guest service fee (6%) | $48.00 |
| **Guest pays** | **$848.00** |
| Host commission (4%) | $32.00 |
| Host gross payout | $768.00 |
| Platform **gross** revenue | $80.00 |

Gross platform revenue is not profit: payment-processing costs are tracked separately (`Payment.processingFeeCents`).

## Folder structure

```
prisma/
  schema.prisma            data model (enums, indexes, constraints)
  migrations/              SQL migrations (incl. hand-written exclusion/check constraints)
  seed.ts, seed-data.ts    demo seed (idempotent, refuses to run in production)
public/
  brand/hero.svg           original illustration
  demo/scenes/*.svg        original demo illustrations (no stock/borrowed photos)
src/
  app/                     routes: /, /search, /stays/[slug], /login, /signup, /account, /host, /admin
                           + not-found, forbidden, error, global-error, loading
  components/
    ui/                    Button, Input, Select, DatePicker, Modal, Card, Badge, Rating, Skeleton,
                           EmptyState, ErrorState, GuestSelector, PriceBreakdown, Logo, Icon
    layout/                Navbar, MobileMenu, Footer
    property/              PropertyCard, PropertyImage, FavouriteButton, StayQuoteForm
    destination/           DestinationCard
    search/                SearchBar, FiltersPanel, ResultsMap, SortSelect
    auth/                  AuthForm, AuthShell
  config/                  amenities catalogue, search options, homepage collections, site
  lib/                     pure logic (pricing, dates, geo, permissions, validation)
  server/                  server-only code (see Architecture)
  types/                   DTOs shared between server and UI
tests/
  unit/                    pure-logic tests (no DB)
  integration/             tests against a real PostgreSQL database
```

## Database

Main models: `User`, `Session`, `PasswordResetToken`, `HostProfile`, `Destination`, `DriveEstimate`, `Property`, `PropertyImage`, `Amenity`, `PropertyAmenity`, `Availability` (per-night overrides), `BlockedDate`, `Booking`, `Payment`, `Payout`, `PlatformFeeSchedule`, `Review` (one per booking), `Favourite`, `Experience`, `ComplianceDocument`, `AdminAction`.

Booking-date queries are indexed on `(propertyId, checkIn, checkOut)`; stay dates are `date` columns with **exclusive** check-out, so back-to-back stays don't conflict.

## Getting started

### Prerequisites

- Node.js ≥ 20.19 (developed on Node 24)
- PostgreSQL 14+ — **or** no install at all: `npx prisma dev` runs a local Prisma Postgres server

### Install and run

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then edit values (see below)

# Option A — local Postgres without installing anything:
npx prisma dev --name roavela --detach
#   copy the printed TCP URL (postgres://postgres:postgres@localhost:51214/template1?sslmode=disable)
#   into DATABASE_URL, and the shadow URL (port 51215) into SHADOW_DATABASE_URL

# Option B — your own PostgreSQL: set DATABASE_URL accordingly

npm run db:migrate               # apply migrations
npm run db:seed                  # load demo data (prints demo account details)
npm run dev                      # http://localhost:3000
```

### Environment variables

See `.env.example` for the full list. Required for Phase 1:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | ≥ 32 random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `APP_URL` | Public base URL |

Optional: `SHADOW_DATABASE_URL`, `SHOW_DEMO_LISTINGS`, `SEED_DEMO_PASSWORD`, `ANALYTICS_PROVIDER`, `NEXT_PUBLIC_MAPBOX_TOKEN`. Stripe, Cloudinary, Resend and AI variables are placeholders for later phases; nothing breaks when they are empty.

### Demo accounts

The seed creates `admin@demo.roavela.test`, `host@demo.roavela.test` and `guest@demo.roavela.test` (plus a few more). They share one password: `SEED_DEMO_PASSWORD` if set, otherwise a random one printed by the seed. `.test` is a reserved TLD, so these addresses can never receive email.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | TypeScript (`tsc --noEmit`) |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript rules) |
| `npm test` | Unit tests (no database needed) |
| `npm run test:integration` | Integration tests against `DATABASE_URL` (creates and removes its own fixtures) |
| `npm run check` | typecheck + lint + unit tests |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:deploy` | Apply migrations in production (`prisma migrate deploy`) |
| `npm run db:seed` | Seed demo data (idempotent) |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:studio` | Browse data |

## Testing

- **Unit** (`tests/unit`): commission/fee maths (incl. the $800 example and rounding), stay pricing (weekend rates, overrides), date handling (exclusive check-out, DST, timezone "today"), drive-time estimates, role permissions and host-ownership checks, password hashing, session tokens, auth validation (role injection ignored), open-redirect protection, rate limiting, search-parameter parsing and query building.
- **Integration** (`tests/integration`): the database rejects overlapping bookings (including a 5-way concurrent race where exactly one wins), back-to-back and cancelled bookings are allowed, and search excludes booked, blocked, unpublished and too-small properties.

## Stripe test setup (later phase)

Payments are not implemented in Phase 1. The schema already models `Payment` and `Payout` with provider IDs, `HostProfile.stripeAccountId` for Stripe Connect, and separate processing-fee tracking. The payments phase will use Stripe **test mode** only, with a mock provider when keys are absent. Card data will never touch Roavela's servers.

## Deployment

1. Provision PostgreSQL (e.g. Neon, Supabase, RDS). The `btree_gist` extension must be available (it is on all major providers).
2. Set the environment variables. Never set `SHOW_DEMO_LISTINGS=true` for a public launch.
3. Build with `npm run build`, run `npm run db:deploy` on release, then `npm start` (or deploy to Vercel).
4. Do **not** run the demo seed against production.
5. Before multi-instance/serverless deployment, replace the in-memory rate limiter with a shared store (see below).

## Security notes

- **Sessions:** 256-bit random tokens in an `httpOnly`, `SameSite=Lax` cookie (`Secure` and `__Host-` prefixed in production). Only a SHA-256 hash is stored. User role and status are **re-read from the database on every request**, so suspensions take effect immediately and the browser can never assert a role.
- **Passwords:** bcrypt (cost 12). Timing is equalised for unknown emails, and the error is a generic "incorrect email or password".
- **Authorisation:** capability checks (`src/lib/permissions.ts`) enforced server-side in every protected page and Server Action (`requirePermission` / `authorize`). Non-authorised roles get a real 403.
- **CSRF:** Server Actions are POST-only and Next.js verifies the `Origin` header against `Host`. The session cookie is `SameSite=Lax`.
- **Validation:** Zod on all inputs. URL search params degrade safely, and redirect targets are restricted to same-origin paths.
- **Rate limiting:** sign-in (per IP and per email) and sign-up (per IP) via a pluggable limiter.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS and `Permissions-Policy`. `X-Powered-By` is removed.
- **Errors:** users see generic messages; server logs never include secrets or values from failed env validation.
- **Privacy:** exact property addresses are not exposed publicly, and reviewer names are shortened.

## Known limitations (Phase 1)

- No booking, checkout, payments, host portal, admin moderation, `/explore`, `/trip-planner` or destination pages yet.
- Forgot-password: the token model exists; the flow and email delivery come in Phase 2.
- The rate limiter is **in-memory** (single instance only).
- Drive times are hand-entered regional estimates plus a heuristic local leg — approximate by design until a routing API is connected.
- The map view is a schematic (relative positions, no roads) until a Mapbox/Google key and SDK are added.
- No Content-Security-Policy yet (needs nonce support for Next inline scripts).
- Search returns up to 48 results (no pagination yet), and price filters use the base nightly rate.
- Demo images are original illustrations, not photos.
- Only one origin (Sydney) is seeded.

## Roadmap

1. ✅ **Phase 1** — architecture, database, auth, design system, homepage, demo search
2. Customer marketplace (forgot password, profile, full property page, map provider)
3. Host portal and 8-step onboarding, compliance submissions
4. Booking engine (availability calendar, holds, cancellation)
5. Admin portal (moderation, suspensions, compliance review, fee configuration, audit log UI)
6. Road-trip discovery (`/explore`), destination SEO pages, sitemap, robots.txt, structured data
7. AI trip planner (provider interface + mock)
8. Payments (Stripe Connect, test mode) and payouts
9. Hardening: CSP, shared rate limiting, observability, E2E tests

Longer term: all Australian cities, international destinations, routing APIs and EV trip planning, dynamic pricing, iCal sync, multi-currency and multi-language support, native apps and PMS integrations.
