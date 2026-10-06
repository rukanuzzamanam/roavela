# Roavela

**Find somewhere worth the drive.**

Roavela is an Australian travel marketplace built around one idea: discover stays and weekend escapes by **how far you want to drive**. It starts with Sydney as the primary origin (Blue Mountains, Hunter Valley, Kiama, Jervis Bay…), but nothing in the architecture is tied to Sydney, NSW or Australia.

> **Status: Phase 5 (admin operations, marketplace control & financial oversight).**
>
> - **Travellers** can search, view stays, save stays and manage their account (Phase 2), and **book and pay** — in Stripe **test mode** (Phase 4).
> - **Property owners and managers** can become hosts, build listings, set pricing and availability, submit for review (Phase 3), and see their bookings and estimated proceeds (Phase 4).
> - **Admins** run the marketplace from `/admin`: listing and compliance review, bookings, payments, reconciliation, TEST refunds, host/customer suspension, review moderation, destinations, commission schedules and an append-only audit log (Phase 5).
> - **Submitted listings are not public until an admin approves them.**
> - **LIVE PAYMENTS ARE NOT ENABLED.** Stripe runs in test mode only and live keys are refused. No host payouts are made.
> - **Not available yet:** live payments, host payouts. See [Roadmap](#roadmap).

## Phase 5 at a glance — admin operations

> **TEST MODE ONLY.** Admin refunds run against Stripe test mode (or the development simulator). Host proceeds are estimates; no money is transferred to hosts.

| Route | What it does |
|---|---|
| `/admin` | Overview: attention queue, marketplace counts, bookings & revenue for a date range (7/30 days, this/previous month, custom) with the formulas shown on the page |
| `/admin/properties`, `/admin/properties/[id]` | Review queue (pending, under review, changes requested, published, paused, suspended, rejected, archived, draft) and the full review page: details, photos, pricing, availability, rules, public vs private location, compliance, host, history, internal notes, decisions |
| `/admin/compliance` | Compliance queue: awaiting review, under review, reviewed, needs correction, expired, expiring in 30 days; search by STRA number, title, host or jurisdiction |
| `/admin/bookings`, `/admin/bookings/[reference]` | Search/filter bookings; detail with timeline, price & commission snapshot, reconciliation checks, Stripe TEST ids, refund ledger, admin cancellation and refunds |
| `/admin/payments`, `/admin/payments/reconciliation` | Payment records; per-booking reconciliation for a date range with a "flagged only" view |
| `/admin/refunds` | Refunds needing action (owed, failed or pending) and the full refund ledger |
| `/admin/hosts`, `/admin/hosts/[id]` | Hosts with listing/booking/compliance counts; detail with "needs review" signals, suspend/reactivate, notes |
| `/admin/customers`, `/admin/customers/[id]` | Customers with booking counts; detail with bookings, cancellations, reviews, suspend/reactivate, notes |
| `/admin/reviews` | Moderation: keep, hide, remove (policy violation), restore |
| `/admin/destinations`, `/admin/destinations/[id]` | Destination editorial/SEO metadata and publish toggle |
| `/admin/commission` | Versioned fee schedules and scheduling a change |
| `/admin/audit` | Admin decisions and host/customer activity, filterable |
| `/admin/settings` | Read-only operational configuration (modes only, never secret values) |

### Admin architecture & authorisation

- **One table of capabilities** (`src/lib/permissions.ts`): `admin:portal`, `admin:properties:moderate`, `admin:compliance:review`, `admin:bookings:view|manage`, `admin:finance:view`, `admin:refunds:manage`, `admin:commission:manage`, `admin:users:manage`, `admin:reviews:moderate`, `admin:destinations:manage`, `admin:audit:view`, `admin:notes:manage`, `admin:config:manage`. Today all belong to `ADMIN`; a future `SUPPORT`, `COMPLIANCE_REVIEWER` or `FINANCE_ADMIN` role is added by listing it against the capabilities it needs — no call sites change.
- **Two entry points only** (`src/server/auth/admin-guard.ts`): `requireAdmin(capability)` for pages (signed-out → login, wrong role → 403) and `gateAdminAction(capability, limit)` for Server Actions (authorise + per-admin rate limit). The `/admin` layout checks too, but it is not the boundary: **every page and action checks its own capability**, and every service re-checks it again.
- **The role always comes from the database** for the current session. Suspended accounts have no session user at all. A `role`, `status`, `hostId` or amount in a form, URL or cookie is never read.
- **Services** live in `src/server/services/admin/*`; pure rules (transitions, refund limits, reconciliation, commission validation, ranges, compliance flags, moderation) in `src/lib/admin/*` with unit tests.

### Property review workflow

Statuses are reused from Phase 3 — no duplicates. `PENDING_REVIEW` is "submitted"; it shows as **under review** once an admin presses *Start review* (`reviewStartedAt/By`). Approval publishes directly (**approved ≡ `PUBLISHED`**), so there is no approved-but-hidden state.

```
PENDING_REVIEW ──approve──▶ PUBLISHED          (admin confirms they reviewed details + compliance)
               ──request changes──▶ CHANGES_REQUESTED ──host resubmits──▶ PENDING_REVIEW
               ──reject──▶ REJECTED            (kept, never deleted)
PUBLISHED/PAUSED ──suspend──▶ SUSPENDED ──reinstate──▶ PAUSED   (host resumes when ready)
```

- Request changes / reject require a **category** and a **host-facing message** (shown on the host's listing page as "Reviewer notes" and emailed). An optional **internal note** goes to `AdminNote` and is never shown to the host.
- `DRAFT`, `CHANGES_REQUESTED`, `REJECTED`, `SUSPENDED` and `ARCHIVED` can never be approved; a suspended host's listings can't be approved or reinstated.
- **Concurrency:** every decision form carries the record's `updatedAt` as a version and the update is conditional on it. A stale page gets "This listing was already updated by another administrator" instead of overwriting a newer decision.

### Compliance review

Per record (STRA registration, insurance, authority to list, local rules & strata acknowledgement): *Start review* → *Mark information reviewed* / *Needs correction* (host-facing note required) / *Mark expired* (only once its recorded expiry has passed). The wording is deliberately "**Compliance information reviewed**" — Roavela does not verify registrations with government registers and never certifies a listing as legally compliant.

Flags are **jurisdiction-aware** (`src/lib/admin/compliance.ts`): expired / expiring within 30 days only where the host recorded an expiry; "registration number missing" only where the jurisdiction requires one (NSW) and no exemption was declared; unconfirmed insurance/authority; missing requirements. Hosts see each record's status and the reviewer's note on their compliance page.

**Documents** stay in private storage with no public URL. The download route (`/host/compliance/[id]/file`) serves them only to the owning host or an admin with `admin:compliance:review`; everyone else gets the same 404. Responses are `no-store`, `noindex` and sandboxed; downloads are rate-limited and admin reads are audited (`compliance.document_viewed`). Local storage can't sign URLs, so access is authorised per request instead.

### Booking operations, payment oversight & reconciliation

Admins can search bookings by reference, customer, host, property or payment id and filter by booking status, payment status and check-in dates. The booking page shows the timeline (hold, verified payment, cancellation, webhook outcomes, refunds, admin actions), the **immutable price and commission snapshot**, Stripe TEST identifiers (never secrets or card data) and the refund ledger.

**Reconciliation** (`src/lib/admin/reconciliation.ts`) re-derives every figure from the booking's own snapshot and checks: guest total = accommodation + cleaning + guest fee; nightly rates sum to accommodation; guest fee and commission = snapshot rates applied to accommodation; snapshot rates match the booking; platform revenue = guest fee + commission; host proceeds = accommodation − commission + cleaning; total = proceeds + platform revenue; captured payment = guest total; currency matches everywhere; refunds ≤ amount paid; a "refunded" booking really was refunded. Problems are **flagged for investigation, never repaired**. Processing fees are shown only if the provider reported them — they are never estimated — so "net platform amount" usually reads "not calculable".

### Refund workflow

`executeRefund` (`src/server/payments/refunds.ts`) is the single refund path for guest cancellations, late payments and admins:

1. **Preview** on the booking page: amount paid, previously refunded, in flight, maximum refundable, policy refund still owed.
2. **Confirm** (two-step form, reason required). Each page render issues a one-time **request key**.
3. **Server execution:** under a `SELECT … FOR UPDATE` lock on the Payment, the key is checked against the ledger (`Refund.idempotencyKey` is UNIQUE) and the amount against *paid − confirmed refunds − refunds in flight* (for policy refunds: *refund due − already refunded*). A `Refund` row is reserved as `PENDING`.
4. **Provider:** the refund is sent with an idempotency key derived from the request key.
5. **Database:** the row takes the provider's status (`SUCCEEDED`/`PENDING`/`FAILED`). The booking moves `REFUND_PENDING → REFUNDED` and `Payment.refundedCents` changes **only** when the provider reports the refund (`charge.refunded`; `refund.*` events update ledger rows).

Repeated clicks, retries and replays return the original refund. A provider failure leaves the booking and payment unchanged ("Refund could not be completed. No booking or payment status was changed.") and the booking appears in the refund queue. Amounts are integer cents parsed without floats. *Decline* records a decision without moving money (not allowed where a policy refund is owed). **Admin cancellation** of a confirmed booking goes through the normal lifecycle with a full, policy or no refund — never an arbitrary state change.

### Commission management

Fee schedules are append-only versions. A change creates a new global schedule with an effective date (today = immediately; later dates = Sydney midnight; never in the past; at most a year ahead), within configured bounds (guest service fee 0–20%, host commission 0–25%), with a reason and an explicit confirmation, written together with its audit record. **Every booking keeps the rates and schedule id snapshotted at booking time**, so changes never alter historical economics. Country-specific schedules (if any) take precedence over the global one.

### Account suspension

- **Customer:** signed out everywhere and can't log in, so can't book. Bookings, payments and reviews are kept.
- **Host:** signed out; every `PUBLISHED`/`PAUSED` listing becomes `SUSPENDED` (hidden, unbookable); listings in review can't be approved. **Confirmed bookings are not cancelled or refunded automatically** — they are flagged ("upcoming bookings with suspended hosts need handling") for an explicit admin cancellation/refund.
- **Reactivation** restores the account; listings suspended by the host suspension return as `PAUSED` (the host chooses when to go live). Listings suspended individually stay suspended.
- A reason and confirmation are required; admins can't suspend themselves or other admins; nothing is deleted.

### Reviews & destinations

Moderation changes visibility only (keep, hide, remove, restore) with an internal reason; text and ratings are never edited, admins can't create reviews, and public rating aggregates are recomputed from `PUBLISHED` reviews. Only guests with a completed booking can review (one per booking, unique in the database). Destination editing covers editorial/SEO fields, coordinates and publishing; slugs and hierarchy are structural and read-only.

### Audit log & internal notes

`AdminAction` (admin decisions: actor, action, target, reason, safe metadata) and `AuditLog` (host/customer activity) are **append-only**: no code path updates or deletes them (enforced by a unit test), and a **database trigger rejects any UPDATE**, also on `AdminNote`. High-impact changes and their audit row are written in the same transaction. `AdminNote` is internal-only and never selected by host, customer or public queries; host- and customer-facing text lives separately (`Property.rejectionReason`, `ComplianceDocument.reviewNote`, emails).

### Dashboard metric definitions

Cohort: bookings **confirmed (paid) within the range**, by `confirmedAt`, whatever their status now. Demo (seeded) bookings are excluded. Amounts are AUD; other currencies are counted but never added to AUD totals.

| Metric | Formula |
|---|---|
| Confirmed bookings | cohort size |
| Gross booking value (GBV) | Σ guest totals of the cohort, before refunds |
| Platform gross revenue | Σ (guest service fee + host commission) of the cohort − that revenue on bookings refunded **in full**. Partial refunds aren't split between host and platform yet. **Not profit**: processing fees and costs aren't deducted. |
| Refunds confirmed | Σ refunds created in the range that the provider confirmed |
| Cancelled bookings / rate | cohort bookings now `CANCELLED`, `REFUND_PENDING` or `REFUNDED` ÷ cohort size |
| Average booking value | GBV ÷ AUD cohort size |
| Active hosts | ACTIVE host accounts with at least one `PUBLISHED` listing |

The attention queue counts (listings awaiting review, compliance to review, expired/expiring compliance on active listings, refunds awaiting confirmation, failed refunds, upcoming bookings of suspended hosts, failed payments in 7 days) are simple database counts labelled "needs review" — never accusations.

## Phase 4 at a glance — booking & payments

> **LIVE PAYMENTS ARE NOT ENABLED.** Everything below runs against Stripe **test mode**, or a clearly labelled simulated provider in development when no Stripe keys are set.

**Server owns pricing. Database owns availability. The Stripe webhook owns payment confirmation. The client owns none of those.**

| Route | What it does |
|---|---|
| `/stays/[slug]/reserve` | Trip review: the server re-validates the stay and shows its price, the cancellation policy and house rules. "Continue to payment" creates a 20-minute hold. |
| `/checkout/[reference]` | Checkout for the guest's own hold: TEST MODE banner, property summary, dates, guests, price breakdown, cancellation policy, house rules, customer details, Stripe Payment Element (or simulated buttons), hold countdown, "Pay securely". |
| `/checkout/[reference]/complete` | Status/confirmation page. Shows the **server's** state only and polls while the webhook is pending. Stripe's `redirect_status` is ignored. |
| `/account/bookings` | Upcoming / Past / Cancelled trips |
| `/account/bookings/[reference]` | Booking detail, payment status, address (confirmed bookings only), cancellation with a refund preview |
| `/host/bookings`, `/host/bookings/[reference]` | Bookings on the host's own listings: guest first name, party size, dates and a proceeds breakdown |
| `POST /api/webhooks/stripe` | Signature-verified Stripe webhook — the only way a Stripe-paid booking is confirmed |
| `GET /api/cron/release-holds` | Housekeeping (Bearer `CRON_SECRET`): expire lapsed holds and cancel their unpaid PaymentIntents |

### Booking flow

1. **Reserve.** The server validates the request (published listing, dates, min/max nights, guest count, blocked dates, overlaps) and prices it from database rates and the active fee schedule. It stores a PENDING booking that *is* the quote, with an immutable snapshot (per-night rates, fee schedule id and rates, rules version, cancellation policy, house rules). The dates are held for 20 minutes by the database exclusion constraint.
2. **Checkout.** The server creates one Payment and one PaymentIntent, taking the amount and currency from the booking, with an idempotency key. The browser collects card details inside Stripe's iframe.
3. **Webhook.** The signature is verified, the event is de-duplicated, and the reference, amount and currency are checked. In one transaction the Payment becomes SUCCEEDED and the Booking CONFIRMED; emails (guest and host) and analytics follow the commit.

- **Lifecycle** (`src/lib/booking-lifecycle.ts`): `PENDING → CONFIRMED | EXPIRED`, `CONFIRMED → CANCELLED | REFUND_PENDING | COMPLETED`, `REFUND_PENDING → REFUNDED`. Status is never accepted from a client; server code names an event and the table decides.
- **Holds:** a PENDING booking blocks the dates only while `expiresAt` is in the future (search, quotes and host blocks use the same rule). Lapsed holds are marked `EXPIRED` on read, before any overlapping insert, and by the cron route. A CHECK constraint forces every PENDING booking to have an expiry.
- **Failed payments** never confirm anything. The attempt is recorded on the Payment (`FAILED` plus the decline code); the guest can retry until the hold lapses, after which the dates are released.
- **Late payments:** if a success arrives after the hold lapsed, the booking is confirmed only if the dates are still free; otherwise the full amount is refunded automatically. It is never double-booked.
- **Idempotency:**
  - Repeated or concurrent "Continue to payment" returns the guest's existing hold.
  - There is one Payment per booking and provider (unique index), and PaymentIntents use a deterministic idempotency key.
  - Each webhook event is recorded once (`WebhookEvent`, unique per provider and event id).
  - Payment and Booking rows are locked `FOR UPDATE` while an event is applied, so duplicate and out-of-order events are harmless.
- **References** like `ROA-8F4K2P`: 6 characters from a 31-symbol unambiguous alphabet via `crypto.randomInt` (about 887 million combinations), unique in the database and redrawn on collision.
- **Cancellation** uses the booking's **policy snapshot**:
  - Flexible: full refund at least 1 day before check-in; none on the day.
  - Moderate: full refund 5+ days before; after that, 50% of accommodation plus the cleaning fee.
  - Strict: 50% of accommodation plus the cleaning fee 14+ days before; after that, none.
  - When a refund is due, the booking becomes `REFUND_PENDING` and a refund is requested from the provider. It only becomes `REFUNDED` when the provider reports it (`charge.refunded`). A failed refund request leaves it `REFUND_PENDING` and is logged — refunds are never faked.
- **Emails** (`src/server/emails/booking-emails.ts`): booking confirmed, payment failed, booking cancelled, host new booking. They are sent after the transaction commits; failures are logged and never undo a booking. Hosts get the guest's first name only.
- **Analytics:** `booking_quote_created`, `checkout_started`, `payment_started`, `payment_succeeded`, `payment_failed`, `booking_confirmed`, `booking_cancelled`, `refund_requested` — ids and amounts only, no personal data.
- **Structured logs** (`src/server/log.ts`): one JSON line per event with identifiers only, plus a redaction pass for secret-looking values and sensitive keys.
- **Stripe Connect:** prepared only (`HostProfile.stripeAccountId`, `payoutsEnabled`, `chargesEnabled`, the `Payout` model). **No payouts are made.**
- **Currency:** every booking stores its currency; only `AUD` is accepted. **No GST is calculated or invented** — prices are shown as the total the guest pays.

## Phase 3 at a glance — hosts

| Route | What it does |
|---|---|
| `/host/start` | Public "List your property" page: benefits, how it works, no promises of bookings or income |
| `/host/onboarding` | Step 1: host profile. Upgrades the **same account** from CUSTOMER to HOST; admins can't host |
| `/host` | Dashboard: real counts only (properties, drafts, under review, live), tasks needing attention, upcoming bookings (real records only, demo ones labelled), and an earnings placeholder |
| `/host/profile` | Public profile (display name, bio, photo) and private details (legal/business name, ABN, phone) |
| `/host/properties` | All the host's listings as cards with status and % complete |
| `/host/properties/new` | Step 2: property basics. Creates a private DRAFT |
| `/host/properties/[id]` | Overview: status and help text, reviewer notes, submission checklist, lifecycle actions, private address |
| `/host/properties/[id]/edit/[section]` | Sections: basics, location, description, amenities, photos, pricing (with an earnings estimate), availability (calendar), house rules & cancellation, compliance (with private document upload) |
| `/host/properties/[id]/preview` | "PREVIEW — NOT LIVE". Uses the same layout as the public stay page |
| `/host/compliance/[id]/file` | Private compliance-document download (owner or admin only) |
| `/media/…` | Serves public uploaded images from the storage provider |

### Listing lifecycle

```
DRAFT ─submit─▶ PENDING_REVIEW ─approve (admin)─▶ PUBLISHED ◀─resume─ PAUSED
  ▲              │   │                             └─pause─────────────▲
  └─withdraw─────┘   ├─request changes (admin)─▶ CHANGES_REQUESTED ─resubmit─▶ PENDING_REVIEW
                     └─reject (admin)─▶ REJECTED
PUBLISHED/PAUSED ─suspend (admin)─▶ SUSPENDED ─reinstate (admin)─▶ PAUSED
DRAFT / CHANGES_REQUESTED / REJECTED / PAUSED ─archive (host)─▶ ARCHIVED
```

- The rules live in `src/lib/listing-lifecycle.ts`.
- **Status is never accepted from the client.** Actions take a named intent (`submit`, `pause`, …), and the server works out the target state. Hosts have no intent that approves anything; their only path to `PUBLISHED` is resuming a listing an admin already approved.
- "Incomplete" and "ready for review" are computed from the checklist, not stored. `PENDING_REVIEW` is shown to hosts as "Under review".
- **Editing:**
  - Editing is locked while a listing is under review; the host withdraws it to edit.
  - Edits to `PUBLISHED`/`PAUSED` listings are allowed and audit-logged as `property.edited_after_review`.
- **Submission** is validated server-side against `src/lib/listing-checklist.ts`:
  - basics, location, description, at least one amenity
  - at least 3 photos, each with a description
  - a nightly price, a reviewed calendar and saved house rules
  - compliance, and a complete host profile
- **Database backstop:** a CHECK constraint refuses any submitted, live, paused or suspended listing that lacks the required fields, even if application code is bypassed.
- **Admin review foundation:** `reviewListing()` in `src/server/services/listing-review.ts` supports approve, request changes, reject, suspend and reinstate. It requires `admin:properties:moderate` and records reviewer, reason and timestamp in `AdminAction`. The review UI arrives with the admin phase.

### Compliance (jurisdiction-aware)

- **Storage:** compliance is stored as one `ComplianceDocument` per requirement per listing (unique on `propertyId + type`), tagged with a jurisdiction such as `AU-NSW`.
- **Requirements are configuration**, in `src/config/jurisdictions.ts`:
  - NSW requires an STRA registration number, or a declared exemption with a reason.
  - Other states and territories are set up with no registration requirement and can be tightened later without schema changes.
- **What's collected:**
  - registration number and expiry (expired registrations are rejected)
  - ownership or management status and confirmed authority to list
  - insurance confirmation
  - strata scheme answer, plus by-law permission when applicable
  - acknowledgement of local obligations and planning rules
  - optional supporting documents (PDF or image), stored **privately**
- **Statuses:**
  - "Not submitted" means no record exists.
  - Hosts only ever create **SUBMITTED** records; any edit resets a record to SUBMITTED.
  - Only admins can mark records UNDER_REVIEW, APPROVED or REJECTED.
- **What Roavela claims:** it records what hosts declare and reviews it. It **does not** verify registrations with government registers, and nothing in the UI says a property is legally compliant.

### Photos & storage

- **Storage abstraction** (`src/server/storage.ts`):
  - `LocalDiskStorage` stores files under `STORAGE_LOCAL_DIR` (default `.data/uploads`, gitignored) for development.
  - It's refused in production unless `STORAGE_LOCAL_ALLOW_PRODUCTION=true`, because local disk isn't shared or durable.
  - A Cloudinary or S3 adapter implements the same interface; credentials stay on the server.
- **Keys** are generated by the server. `public/…` objects are served by `/media/…` (nosniff, sandboxed CSP, no path traversal). `private/…` objects (compliance documents) are only readable through an ownership-checked route.
- **Upload checks:**
  - The type is detected from **file contents**: JPEG, PNG or WebP only. SVG and renamed HTML are rejected.
  - Up to 10 MB per file and up to 24 photos per listing.
  - **EXIF/XMP metadata, including GPS, is stripped** before storage.
- **Management:** upload several files (sent one at a time with per-file status), add descriptions, reorder, set the cover (position 0), and delete. Live listings can't drop below the photo minimum.

### Pricing & availability

- **Pricing** is entered in dollars and stored as **integer cents** (`$250` → `25000`). It's validated (strict format, $20–$10,000 per night), with a weekend rate, a cleaning fee, and minimum and maximum stays.
- **Earnings estimate:** the pricing step shows an estimated host payout for an example 2-night stay. It uses the **active fee schedule** and the shared `calculateFees()`, is labelled as an estimate, and is calculated before processing costs.
- **Availability** is "open unless blocked":
  - Hosts block and unblock ranges on a calendar. Ranges merge and split cleanly.
  - Past dates, dates more than 2 years ahead, and dates overlapping active bookings are rejected.
  - Blocks are separate from bookings; the database double-booking constraint is unchanged.

### Host security model

- **Identity:** every host Server Action takes the user **from the session**, checks the role permission, rate-limits, and validates with Zod.
- **Ownership is enforced in the database query.** Properties are only ever loaded through `where: { id, host: { userId } }` (`src/server/services/host-access.ts`). Another host's id behaves exactly like a missing one: pages return **404**, and actions return "not found".
- **Never read from the client:** `hostId`, `userId`, `role`, `status` and computed prices.
- **Audit:** `AuditLog` records host actions (profile created, property created, submitted, withdrawn, paused, resumed, archived, edited after review, compliance submitted, document attached) and never includes document contents or addresses. Admin decisions go to `AdminAction`.

**Database changes in Phase 3:** 3 migrations.
- `phase3_host_marketplace`:
  - host type and private host fields (legal name, ABN, avatar)
  - structured house rules and section-progress tracking
  - the `CHANGES_REQUESTED` status and the `HOUSE`/`GUESTHOUSE` property types
  - `ComplianceStatus.PENDING_REVIEW` renamed to `UNDER_REVIEW`, preserving data
  - the `AuditLog` model
  - draft-stage fields made nullable, backed by the listable-complete CHECK and a coordinate-range CHECK
- `phase3_listable_check_country_agnostic`: removes the state requirement from the DB check, since not every country has states.
- `compliance_unique_per_listing`: one compliance record per requirement per listing.

## Phase 2 at a glance

| Route | What it does |
|---|---|
| `/search` | Search by origin, destination (`?destination=`), max drive, dates and guests. Filters: price, type, bedrooms, bathrooms, capacity and amenities. Sort by recommended, price, rating or estimated drive. Server-side pagination (12 per page). List and map views. Every state lives in the URL. |
| `/stays/[slug]` | Property page: gallery (full-screen, keyboard-navigable), highlights, grouped amenities, house rules, cancellation policy, approximate-area map with nearby attractions, review category averages, host info, sticky booking-preview card and a mobile bottom bar. |
| `/stays/[slug]/reserve` | Booking **preview** only in Phase 2 (replaced by the trip review and checkout in Phase 4). |
| `/saved` | The signed-in traveller's saved stays, paginated. |
| `/account` | Dashboard: profile, saved-stays preview, read-only trip history (with an empty state when there are no bookings). |
| `/account/profile` | Edit name and phone. Email is read-only until verified email change exists. |
| `/forgot-password`, `/reset-password` | Secure password reset (see [Password reset](#password-reset)). |
| `/destinations/[slug]` | Placeholder destination page linking to stays (`noindex` until full guides exist). |

**Database changes in Phase 2:** none. `Favourite` and `PasswordResetToken` already existed from Phase 1, so no migration was needed. New amenity catalogue entries (heating, dryer, workspace, beach access, mountain and vineyard views) are data rows created by the seed.

### Search architecture

1. `parseSearchParams` validates every URL parameter with Zod. Invalid or empty values are dropped rather than failing the page. `?to=` and `?guests=` are accepted as aliases.
2. `buildPropertyWhere` builds a Prisma filter: `PUBLISHED` only, demo visibility, capacity, price, type, amenities (all selected must match), destination (including child places), a coarse drive-time filter from stored `DriveEstimate` rows, and date availability. Availability uses the same half-open overlap rules as the database's double-booking constraint.
3. **Phase A:** lightweight sort keys for every match (capped at 2,000) are loaded. Drive time is refined per property, then results are ranked and the requested page is sliced — so totals are exact.
4. **Phase B:** full card data (images, amenities, favourite state) is loaded for that page's ids only.

The map view plots every match. All public coordinates are rounded to about 1 km (`approximateLocation`), and street addresses never leave the server.

### Maps and routing

- **Maps:** every map renders through `<MapView>`, and `resolveMapProvider()` picks the implementation. Only the **fallback** schematic map exists today. It needs no key and ships no client JavaScript, and its caption states it is not a road map. Setting `MAP_PROVIDER=mapbox|google` without an implementation or key falls back safely. Property pages show an approximate *area*, never a pin.
- **Routing:** search reads stored origin → destination estimates plus a heuristic local leg (`services/drive-time.ts`), so drive times are always labelled *estimated*. `RoutingProvider` (`getDrivingDistance`, `getDrivingDuration`, `estimateDrive`) is the interface a Mapbox or Google routing implementation would provide; its results are written as `ROUTING_API` estimates.

### Password reset

- Tokens are 256-bit random values; only a SHA-256 hash is stored.
- Tokens expire after `PASSWORD_RESET_TOKEN_TTL_MINUTES` (default 30) and are single-use via an atomic claim that is safe under concurrency.
- A new request invalidates earlier unused tokens.
- A successful reset revokes **all sessions** and removes the user's remaining tokens.
- The response is identical whether or not the email exists. The email is sent fire-and-forget, and per-email rate limiting is silent.
- Email goes through Resend when `RESEND_API_KEY` is set. Otherwise the development console adapter prints the message, including the link, **in development only**. Tokens are never shown in the UI.
- The reset page uses `Referrer-Policy: no-referrer` and shows clear expired, used and invalid states.

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

Since Phase 4 (rule version `2026-09.accommodation-fee-base`), Roavela's fees apply to **accommodation only**. The cleaning fee passes through to the host in full, with no commission. With the default schedule (6% guest fee, 4% host commission):

| | |
|---|---|
| Accommodation | $500.00 |
| Cleaning fee | $80.00 |
| Guest service fee (6% of accommodation) | $30.00 |
| **Guest pays** | **$610.00** |
| Host commission (4% of accommodation) | $20.00 |
| Host gross proceeds (500 − 20 + 80) | $560.00 |
| Platform **gross** revenue (30 + 20) | $50.00 |

A database CHECK enforces `guest total = host proceeds + platform revenue`. Each booking snapshots the fee schedule id, rates and rule version, so later schedule changes never alter existing bookings. Gross platform revenue is not profit: payment-processing costs are tracked separately (`Payment.processingFeeCents`).

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
  app/                     routes: /, /search, /stays/[slug](/reserve), /saved, /account(/profile),
                           /login, /signup, /forgot-password, /reset-password, /destinations/[slug], /host, /admin
                           + not-found, forbidden, error, global-error, loading
  components/
    ui/                    Button, Input, Select, DatePicker, Modal, Card, Badge, Rating, Skeleton,
                           EmptyState, ErrorState, GuestSelector, PriceBreakdown, Logo, Icon
    layout/                Navbar, MobileMenu, Footer
    property/              PropertyCard, PropertyImage, PropertyGallery, AmenityList, ReviewSummary,
                           BookingCard, LocationSection, FavouriteButton, StayQuoteForm
    destination/           DestinationCard
    search/                SearchBar, FiltersPanel, SortSelect
    maps/                  MapView, MapProvider registry, FallbackMap
    account/               ProfileForm
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

See `.env.example` for the full list. Required:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | ≥ 32 random characters (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) |
| `APP_URL` | Public base URL (also used to build password-reset links) |

Optional:

| Variable | Purpose |
|---|---|
| `SHADOW_DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS` | Migration shadow DB and pool tuning (`prisma dev` needs `DATABASE_IDLE_TIMEOUT_MS=1`) |
| `SHOW_DEMO_LISTINGS` | Show demo listings in production builds (never for a public launch) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email. Without a key, emails are logged in development only |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | Reset-link lifetime (default 30, min 5) |
| `MAP_PROVIDER`, `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Map provider selection. Only the fallback is implemented, so any other value falls back |
| `ROUTING_PROVIDER` | `heuristic` (the only implementation today) |
| `ANALYTICS_PROVIDER` | `console` or `none` |
| `SEED_DEMO_PASSWORD` | Password for seeded demo accounts |
| `STORAGE_PROVIDER` | `local` (the only adapter today) |
| `STORAGE_LOCAL_DIR` | Where the local adapter writes uploads (default `.data/uploads`, gitignored) |
| `STORAGE_LOCAL_ALLOW_PRODUCTION` | Explicit opt-in to local disk storage in production (not recommended) |

| `STRIPE_MODE` | Must be `test`. Any other value disables payments |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe **test** secret key (`sk_test_`/`rk_test_`) and webhook secret (`whsec_`). Server only. Live keys are refused |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** publishable key (`pk_test_`) |
| `PAYMENT_PROVIDER` | `auto` (default), `stripe` or `mock`. Without a secret key, development uses the simulated provider; production refuses it |
| `CRON_SECRET` | Bearer secret for `/api/cron/release-holds` (the route is disabled when unset) |

Phase 5 adds **no** environment variables: the admin area reuses the database, session, payment (test-mode) and email configuration above. `.env.example` is unchanged.

Cloudinary and AI variables are placeholders for later phases. Nothing breaks when they are empty.

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
- **Phase 2 unit** (`tests/unit/phase2.test.ts`):
  - search: `?destination=`/`?to=`/`?guests=` aliases, page validation, empty form fields, filter counting, pagination maths, deterministic sort tie-breaks
  - coordinate rounding and profile validation
- **Phase 2 integration** (`tests/integration/marketplace.test.ts`), using isolated fixtures:
  - search: destination, capacity, price and amenity filters; demo isolation; no exact coordinates; server-side pagination and clamping; price and rating sorts
  - property detail visibility, and server-side quotes (including booked dates and too many guests)
  - favourites: save, duplicate prevention, removal, visibility rules, authorisation, and a forged `userId` being ignored
  - profile update authorisation
  - password reset: hashing, expiry, invalidation, single use, session revocation, concurrent use

- **Phase 3 unit** (`tests/unit/phase3.test.ts`):
  - lifecycle transitions (hosts can never approve or publish)
  - the checklist, including NSW STRA vs other states
  - integer-cent money parsing and host form validation (including the ABN checksum)
  - date-range merge and split
  - content-based image type detection and EXIF/GPS stripping for JPEG, PNG and WebP
- **Phase 3 integration and security** (`tests/integration/host-marketplace.test.ts`, real Postgres plus temp-dir storage):
  - becoming a host on the same account, with a forged `ADMIN` role ignored; admins can't host
  - forged `hostId` and `status` ignored on create
  - prices stored in cents, and manipulated prices rejected
  - amenity de-duplication and the pets rule/amenity sync
  - the database refusing to publish an incomplete listing
  - photo upload, reorder, cover and delete; disguised and oversized files; the photo limit
  - calendar rules
  - submission gating, and the full submit → changes requested → resubmit → approve flow with its audit trail
  - host self-approval and status forgery rejected
  - pause, resume and archive rules
  - compliance saved only as SUBMITTED and reset on edit
  - an **IDOR matrix** (host B against host A's listing) through both services and Server Actions

- **Phase 4 unit** (`tests/unit/phase4.test.ts`):
  - the commission worked example (500 + 80 → 610 / 560 / 50), no commission on cleaning, server-side weekend pricing
  - every legal and illegal lifecycle transition
  - cancellation refunds per policy and boundary day, never more than was paid
  - the payment config guard: live keys (`sk_live_`, `rk_live_`, `pk_live_`) and non-test modes refused, the mock refused in production
  - reference format and unpredictability; booking input stripping price, status, commission and currency
  - Stripe webhook signatures (valid, wrong secret, tampered body, missing, replayed) and event mapping
  - log redaction
- **Phase 4 integration** (`tests/integration/booking-payments.test.ts`):
  - server pricing and snapshot, the 20-minute hold, and a tampered price, commission, currency and status ignored through the Server Action
  - idempotent reserve (concurrent double-submit), guest count, min/max nights, past, far-future and impossible dates, unpublished listings, the host's own listing, blocked dates
  - **concurrency: Customer A (10–12) vs Customer B (11–13) at once — exactly one wins**; lapsed holds release their dates
  - exactly one Payment however often checkout opens; a verified success confirms once; duplicate and concurrent duplicate events; confirmed dates unavailable in search and booking
  - a failed payment never confirms and releases the dates after expiry
  - amount, currency and reference mismatches rejected; unknown payments ignored; a failure after success ignored; late payments confirmed or refunded
  - cancellation: full refund → REFUND_PENDING → REFUNDED; a partial refund inside 5 days
  - **IDOR:** another customer can't view, pay, simulate or cancel; another host can't see the booking; hosts see the first name only and never see unpaid holds
  - the webhook route: unsigned, wrong-secret and tampered requests (400), a verified success, a redelivery (duplicate), a wrong amount, a missing reference, livemode events, failures, and no stored payloads

- **Phase 5 unit** (`tests/unit/phase5.test.ts`):
  - every admin capability is ADMIN-only; unknown/client-sent role strings grant nothing
  - listing transitions: no route to `PUBLISHED` except approval from review (or a host resuming an approved, paused listing); suspension/reinstatement admin-only
  - compliance transitions and jurisdiction-aware expiry/registration flags; moderation transitions
  - refund limits: paid − confirmed − in flight, conservative in-flight counting, zero/negative/fractional/over-limit rejected, policy refund owed; integer-cent parsing
  - reconciliation: a correct booking passes; guest total, fee, commission, proceeds, snapshot, nightly-rate, currency, over-refund, ledger and refund-state problems flagged; no processing fee invented
  - commission: percent → bps without floats, bounds, confirmation, no back-dating, schedule state
  - reporting ranges across DST and invalid custom ranges; admin query-parameter validation
  - audit immutability: no source file updates or deletes `AdminAction`, `AuditLog` or `AdminNote`
- **Phase 5 integration & security** (`tests/integration/admin-operations.test.ts`, real sessions — the role is re-read from the database):
  - signed-out, customer, host and **suspended ADMIN** sessions are denied; customers and hosts calling every admin action (approve, start review, refund, cancel, commission, suspend, notes, compliance, moderation) with `role=ADMIN`/`status=PUBLISHED` in the request are rejected with no state change; services re-check too
  - review flow: queue → start review → request changes (host sees the message, never the internal note) → resubmit → approval requires the compliance acknowledgement; reject keeps the listing; invalid routes to `PUBLISHED` blocked
  - a **stale page** can't overwrite a newer decision; two concurrent decisions → exactly one wins
  - compliance review with versions, required notes and expiry; **document IDOR**: signed-out, other host and customer get 404, owner and admin 200 (`no-store`, `noindex`), admin reads audited
  - refunds: manipulated amounts rejected; **duplicate and concurrent duplicate submissions → one refund**; three concurrent full refunds → one succeeds; never more than paid; a provider failure changes nothing and queues the booking; **two admins retrying an owed refund at once → one refund**; **a live Stripe key → refused, nothing recorded**; admin cancellation via the lifecycle
  - reconciliation flags tampered commission and currency without repairing them; booking search; dashboard GBV/platform revenue deltas match a real booking
  - commission bounds, back-dating and confirmation; a new schedule prices new bookings while **existing bookings keep their snapshot** and still reconcile
  - host suspension (sessions revoked, listings suspended, bookings kept, new bookings and approvals blocked, reactivation restores as paused); customer suspension blocks booking; no self/admin suspension
  - moderation changes visibility only and recomputes aggregates; no second review per booking
  - notes are admin-only; **UPDATE on audit rows and notes is rejected by the database**; server-side pagination

Run `npm run test:integration` with the database running. With `prisma dev`, integration tests use a single pooled connection (see `vitest.integration.config.mts`), because that local server garbles concurrent connections. The concurrency tests still race at the application level and the database constraint decides. Against a real PostgreSQL, set `TEST_DATABASE_POOL_MAX` to also race parallel sessions. Tests create and delete their own data and don't depend on the seed.

## Stripe test setup

> **LIVE PAYMENTS ARE NOT ENABLED.** Only Stripe test mode is supported. Never put live keys in any environment; they are refused.

Without keys, development uses a **simulated provider**. Checkout shows a "Pay securely" button and a "Simulate a declined card" button, which send a simulated event through the same verification and confirmation code as a real webhook. No card form is shown and nothing is charged.

To use real Stripe test mode:

1. In the [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys), switch to **Test mode** and copy the test keys into `.env`: `STRIPE_SECRET_KEY=sk_test_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…`, `STRIPE_MODE=test`.
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and forward webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`. Copy the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.
3. Book a stay and pay with a [Stripe test card](https://docs.stripe.com/testing):

| Case | Card | Expected |
|---|---|---|
| Success | `4242 4242 4242 4242` | The status page shows "You're booked!" once the webhook arrives |
| Generic decline | `4000 0000 0000 0002` | An error is shown, the booking stays unconfirmed, and retrying is possible until the hold lapses |
| Insufficient funds | `4000 0000 0000 9995` | As above, with the failure code recorded |
| 3-D Secure | `4000 0025 0000 3155` | An authentication modal, then success |

Use any future expiry date, any CVC and any postcode. Webhook events handled: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.processing`, `payment_intent.canceled`, `charge.refunded`, and (Phase 5) `refund.created`, `refund.updated`, `refund.failed` and `charge.refund.updated` for refund-ledger status; others are recorded as ignored. Include the refund events if you filter `stripe listen --events`. Card data never reaches Roavela: it is entered in Stripe's iframe, and Roavela stores only PaymentIntent ids, amounts, statuses and decline codes.

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
- **Admin (Phase 5):** see [Admin architecture & authorisation](#admin-architecture--authorisation). Every high-impact action needs a two-step confirmation and a reason, is version-checked against concurrent edits, and is written in one transaction with its audit record. Admin pages are `noindex` and dynamic (never cached).
- **Rate limiting:** a pluggable limiter covers:
  - sign-in (per IP and per email)
  - sign-up (per IP)
  - password-reset requests (per IP, plus a silent per-email limit) and submissions
  - profile updates and favourites (per user)
  - admin mutations, refunds and commission changes (per admin), and compliance-document downloads (per user)
- **Payments:**
  - Stripe test mode only: live keys are refused, `STRIPE_MODE` must be `test`, and livemode webhook events are rejected.
  - Webhooks are signature-verified with replay protection, and a browser redirect never confirms a booking.
  - Amount and currency always come from the booking row.
  - `WebhookEvent` stores ids and outcomes, never payloads.
  - Secret keys never leave the server (checked against the client bundle).
- **Booking rate limits:** reserve (quote), payment start, simulated payments and cancellation (per user), and the webhook (per IP).
- **Never trusted from the client:** user id, role, ownership, prices and fees. Actions derive the user from the session. Quotes are computed from database prices and the active fee schedule.
- **Location privacy:** public data carries only a locality and coordinates rounded to about 1 km. Property maps show an area, not a pin.
- **Structured data:** JSON-LD is only emitted for non-demo listings, and it is escaped against `</script>` injection. Demo listings are `noindex, nofollow`.
- **Headers:** `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS and `Permissions-Policy`. `X-Powered-By` is removed.
- **Errors:** users see generic messages; server logs never include secrets or values from failed env validation.
- **Privacy:** exact property addresses are not exposed publicly, and reviewer names are shortened.

## Known limitations (Phase 5)

- **TEST MODE only**, no payouts. Admin refunds use the same test-mode provider; real Stripe refunds are not exercised by the automated tests (the simulator covers the pipeline).
- **Partial refunds aren't allocated** between host proceeds and platform revenue; the dashboard reverses platform revenue only for full refunds and reports refunds separately. Processing fees aren't recorded yet, so net platform figures are "not calculable".
- **Charts** were optional and aren't included; the dashboard focuses on operational figures and queues.
- **Search** uses indexed exact/prefix matches plus case-insensitive `contains` on a few text columns; there's no full-text or trigram index yet. Admin page loads aren't rate-limited (actions are).
- **Single admin role.** Capabilities are granular, but only `ADMIN` exists and there's no admin-user management screen (create admins with the seed or directly in the database).
- **Suspended customers** can't log in at all, so they can't view their bookings or contact support through the app; a live checkout hold (≤ 20 minutes) isn't cancelled on suspension.
- **Reviews:** there's still no guest review form or "report review" flow, so the moderation queue only contains reviews that already exist (seed data).
- **Destinations** can be edited and (un)published but not created or re-parented from the UI.
- **Commission** management covers the global schedule only; country-specific schedules are shown and take precedence but can't be created from the UI.
- **Compliance documents** are authorised per request on local storage; signed short-lived URLs will come with a cloud storage adapter.
- **Mobile layout** of the admin tables was verified at desktop width in a browser and by design (cards below `md`); check it on a real phone.
- **In-memory rate limiter** (see Deployment) and no CSP yet — both on the hardening roadmap.
- **Dev server:** after `prisma generate` (e.g. pulling this branch), restart `npm run dev` — the development Prisma client is cached across hot reloads.

## Known limitations (Phase 4)

- **LIVE PAYMENTS ARE NOT ENABLED**, and there are **no host payouts**. Stripe Connect is modelled but hosts aren't onboarded.
- **Real Stripe test mode is not exercised by the automated tests**, because no keys are available to them. Webhook verification and event handling are tested with locally signed Stripe-format events, and the PaymentIntent and refund calls use the SDK as documented. Follow [Stripe test setup](#stripe-test-setup) with your own test keys to exercise the full round trip.
- **Refunds** through Stripe are requested and then completed by the `charge.refunded` webhook; the simulated provider covers this path in tests. A refund that fails stays `REFUND_PENDING` and appears in the Phase 5 admin refund queue for a retry.
- **Guest cancellation** (plus admin cancellation from Phase 5). Hosts can't cancel, and stays aren't automatically marked `COMPLETED`.
- **Holds** last 20 minutes. Stale PaymentIntents are cancelled only when the cron route runs.
- **Single currency (AUD).** There's no GST or tax calculation, and no invoices or receipts beyond the confirmation email.
- **Host guest data** is intentionally minimal (first name and party size), and there's no messaging.
- **`prisma dev`** can't run truly parallel connections; see [Testing](#testing).

## Known limitations (Phase 3)

- **Admin review UI:** delivered in Phase 5 (`/admin/properties`).
- **Local storage only:** only the local-disk storage adapter exists, so production needs a Cloudinary or S3 adapter first.
- **Image processing:** images aren't resized or re-encoded; they're validated and have their metadata stripped. Image dimensions aren't recorded.
- **Location:**
  - There's no geocoding. Hosts may enter coordinates; otherwise the destination's centre is used and labelled approximate.
  - The country is fixed to Australia in the form, though the model is country-agnostic.
- **Compliance:**
  - Rules are configured for NSW (STRA). Other states have no registration requirement configured yet.
  - Nothing is verified against government registers, and compliance records aren't reviewed individually yet.
- **Calendar:** no per-night price overrides, iCal sync, advance-notice or booking-window rules yet.
- **Pricing:** there's no extra-guest fee. (Phase 4 changed the fee base to accommodation only, so the host fee on $500 + $80 is now $20.)
- **Editing live listings:** edits apply immediately and are audit-logged. They aren't queued for re-review.

## Known limitations (Phase 2)

- **Not built yet:**
  - online booking, checkout, payments, host portal, admin moderation, `/explore`, the trip planner, review submission, messaging and full destination guides
  - "Reserve" only opens a preview
- **Search ranking** runs on lightweight keys in memory for up to 2,000 matches per query. Beyond that, ranking (rating smoothing, per-property drive time) should move into SQL or materialised columns.
- **Price filters and price sorting** use the base nightly rate. With dates selected, sorting uses the stay total.
- **Rate limiting** is **in-memory**, so it only works on a single instance.
- **Drive times** are estimates: hand-entered regional figures plus a heuristic local leg. Only the fallback map exists, and it has no roads or basemap.
- **Password reset:**
  - Reset links carry the token in the query string, so request logs on a hosting platform could record it. It is short-lived and single-use.
  - Resend delivery is implemented against Resend's documented API but has **not** been exercised with a live key.
- **Account:**
  - There's no email verification or email change.
  - There are no profile photos, because image uploads come later.
  - Trip history is read-only.
- **No Content-Security-Policy yet.** It needs nonce support for Next inline scripts.
- **Demo data:** images are original illustrations, and only one origin (Sydney) is seeded.

## Roadmap

1. ✅ **Phase 1** — architecture, database, auth, design system, homepage, demo search
2. ✅ **Phase 2** — customer marketplace: search, filters, pagination, property page, booking preview, favourites, account, password reset, map/routing abstractions
3. ✅ **Phase 3** — host onboarding, listing drafts, photos, pricing, availability, house rules, jurisdiction-aware compliance, preview, submission lifecycle, admin review foundation
4. ✅ **Phase 4** — booking engine, checkout, Stripe **test-mode** payments, webhooks, cancellation and refunds, customer and host booking pages
5. ✅ **Phase 5** — admin operations: listing and compliance review, booking/payment oversight, reconciliation, idempotent TEST refunds, suspensions, moderation, destinations, commission schedules, audit log
6. Road-trip discovery (`/explore`), destination SEO pages, sitemap, robots.txt, structured data
7. AI trip planner (provider interface + mock)
8. Live payments, Stripe Connect onboarding and payouts (after a separate review)
9. Hardening: CSP, shared rate limiting, observability, E2E tests

Longer term: all Australian cities, international destinations, routing APIs and EV trip planning, dynamic pricing, iCal sync, multi-currency and multi-language support, native apps and PMS integrations.
