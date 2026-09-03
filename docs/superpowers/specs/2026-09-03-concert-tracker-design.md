# Concert Tracker: Design

Date: 2026-09-03
Status: Approved for planning

## 1. Purpose

A public, multi-user website where people record the concerts they have
attended, post photos from each show, and attach the setlist imported from
Setlist.fm.

Success criteria:

1. A signed-in user can log a show in under a minute, either by importing it
   from Setlist.fm or by typing it in manually.
2. A user can upload photos from a show and see them on a public page they can
   share with someone who has no account.
3. Two users who attended the same show see the same concert and the same
   setlist, not two disconnected copies.
4. The site renders every public page without making a single call to
   Setlist.fm.

Non-goals for this design: native mobile apps, ticket purchasing, private or
follower-only profiles, real-time notifications, and multi-artist festival
events as first-class objects (see 3.4).

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js (App Router), TypeScript |
| Rendering | React Server Components for public pages, client components for interactive flows |
| Database | PostgreSQL via Prisma |
| Auth | Auth.js (Google OAuth plus email magic link), sessions in Postgres |
| Object storage | S3-compatible (Cloudflare R2, Backblaze B2, or AWS S3) behind a driver interface |
| Image processing | sharp |
| Validation | zod at every route handler boundary |
| Tests | Vitest, Playwright, Postgres in Docker for integration |

Rationale: roughly half the app is read-heavy public content (profiles, concert
pages, setlists) that benefits from server rendering and produces good link
previews when shared. A single deployable avoids the CORS, cross-origin session,
and duplicated-type costs of a split SPA plus API. A separate API is worth
revisiting only if a native client is actually built.

## 3. Data model

### 3.1 Principle

A concert is a shared object, not a personal note. Personal content (notes,
photos, rating) hangs off a per-user `Attendance` row that points at the shared
`Concert`. This is what makes "9 other people were at this show" possible,
prevents duplicate setlist imports, and makes cross-user stats meaningful.

### 3.2 Canonical layer

Written mostly by imports, deduplicated, shared by all users.

**Artist**
- `id`, `name`, `mbid` (MusicBrainz id, nullable, unique), `imageUrl` (nullable)
- Setlist.fm keys artists on `mbid`, so it is the dedup key when present.

**Venue**
- `id`, `name`, `city`, `state` (nullable), `country`
- `setlistfmVenueId` (nullable, unique)
- `lat`, `lng` (nullable, reserved for a future map; not used in v1)

**Concert**
- `id`, `artistId`, `venueId`, `date` (date, no time)
- `tourName` (nullable), `eventName` (nullable, see 3.4)
- `setlistfmId` (nullable, unique)
- `setlistfmVersionId` (nullable), `lastSyncedAt` (nullable)
- Unique constraint on `(artistId, venueId, date)`

The second unique constraint is load-bearing: it makes a manually entered show
and a later Setlist.fm import of the same show collapse into one row rather than
forking into two.

**SetlistSong**
- `id`, `concertId`, `position` (int, ordering within the whole setlist)
- `name`, `info` (nullable, the per-song annotation Setlist.fm provides)
- `isTape` (bool), `coverArtistName` (nullable), `encore` (int, 0 for main set)
- A local copy of imported data. Never fetched live at render time.

### 3.3 Personal layer

**Attendance**
- `id`, `userId`, `concertId`, `notes` (nullable), `rating` (nullable, 1 to 5)
- `attendedWith` (nullable free text), `createdAt`
- Unique on `(userId, concertId)`

**Photo**
- `id`, `attendanceId`, `storageKey`, `width`, `height`
- `caption` (nullable), `sortOrder`, `createdAt`
- Belongs to Attendance, not Concert. Your photos stay yours even though the
  setlist is shared.

### 3.4 Festivals and openers (accepted simplification)

Setlist.fm models one setlist per artist per event. A `Concert` here follows
that: it is one artist's performance, not the whole night. A user attending a
festival or a show with openers logs each act separately. `Concert.eventName`
groups them visually on a profile.

Rejected alternative: a first-class `Event` entity with many performances. It
roughly doubles the model and complicates dedup, import, and every query, to
serve a minority of shows. Revisit if festival logging becomes a common
complaint.

### 3.5 Social layer

**Follow**: `followerId`, `followingId`, `createdAt`. Unique on the pair. A user
cannot follow themselves.

**Comment**: `id`, `attendanceId`, `userId`, `body`, `createdAt`, `deletedAt`
(soft delete).

**Like**: `userId`, `attendanceId`, `createdAt`. Unique on the pair.

**Report**: `id`, `reporterId`, `targetType` (`photo` or `comment`),
`targetId`, `reason`, `createdAt`, `resolvedAt` (nullable).

### 3.6 Stats

Computed on read by joining Attendance to Concert, Artist, Venue, and
SetlistSong. No precomputed counter tables until a measured query is actually
slow. Stats shown: total shows, shows per year, most-seen artists, top venues,
most-heard songs, first and most recent show.

## 4. Setlist.fm integration

### 4.1 Facts that constrain the design

- Base URL: `https://api.setlist.fm/rest/1.0`
- Auth: `x-api-key` request header
- Responses default to XML; JSON requires `Accept: application/json`
- Date parameters use `dd-MM-yyyy`, not ISO 8601
- Starter key rate limit: 2 requests/second and 1,440 requests/day. Higher
  tiers exist on application.
- Free for non-commercial use only. Attribution required. The key must not be
  shared with third parties.

### 4.2 Consequences

The daily quota rules out any per-page-view call. Setlist.fm is contacted from
exactly two places: an interactive search while a user is adding a show, and a
budgeted background refresh job (4.6). Every result is copied into our own
tables. Rendering a concert page, a profile, a feed, or a stats page issues zero
external calls.

The key lives in a server-side environment variable and is never sent to the
browser, both because their terms forbid sharing it and because a leaked key
lets strangers exhaust the app's quota.

### 4.3 Import flow

1. User enters an artist name and optionally a date or city on `/add`.
2. Server calls `/search/setlists` with `artistName`, `date`, `cityName`. That
   endpoint returns full setlists including songs, so choosing a result normally
   costs one request total rather than two.
3. User picks the matching show from the candidate list.
4. Server upserts Artist, Venue, and Concert, writes SetlistSong rows, then
   creates the Attendance.
5. If a Concert with that `setlistfmId` already exists, steps 2 through 4 are
   skipped entirely and only the Attendance is created. The second user to log a
   popular show costs zero external calls.

### 4.4 Client guardrails

- Token bucket limiter at 2 requests/second, plus a daily counter, enforced
  in-process so the app degrades deliberately instead of collecting 429s.
- The daily quota is split into two named budgets, `interactive` and `refresh`,
  with the refresh budget capped at 20 percent. Every call declares which budget
  it draws from. This guarantees the background job can never starve a user who
  is trying to add a show, which is the failure that would actually matter.
- Short-lived cache keyed on the search parameters, since several users looking
  up the same tour on the same evening is the common case.
- A dedicated, unit-tested `dd-MM-yyyy` formatting helper. Passing an ISO date
  returns empty results rather than an error, which is a silent failure mode.

### 4.5 Degradation

If Setlist.fm is unreachable, erroring, or over quota, `/add` falls back to
manual entry: artist, venue, and date typed by the user, with an optional
hand-entered setlist. A third-party outage must never prevent a user from
recording that they attended a show. Manual entries later merge with imports via
the `(artistId, venueId, date)` unique constraint.

### 4.6 Freshness and attribution

Setlists get edited on Setlist.fm after the fact, most heavily in the days right
after a show while attendees correct the song order. A setlist that never
updates therefore tends to be wrong exactly when people are looking at it. So
setlists are refreshed, but on a strict budget rather than by naive polling.

Every Concert stores `setlistfmVersionId` and `lastSyncedAt`. Refresh happens
three ways:

1. **Manual.** A "refresh setlist" button on any imported concert, drawing from
   the `interactive` budget, rate limited per concert to once every 15 minutes
   so it cannot be used to drain the quota.
2. **Scheduled, budgeted, and prioritized.** A daily job spends at most the
   `refresh` budget from 4.4 (20 percent of the daily quota, roughly 288 calls
   on a starter key). It selects concerts by a decay rule rather than by
   scanning everything: a show is eligible daily for its first week after the
   event date, weekly until one month out, and never again automatically.
   Within the eligible set it orders by attendee count descending, then by
   oldest `lastSyncedAt`, so the quota is spent on the setlists the most people
   are actually reading.
3. **Never on render.** No page view triggers a refresh, and no cache miss
   triggers one. Section 4.2 still holds.

Because the decay rule stops at one month, the steady-state cost is bounded by
how many shows the site logs per week, not by how many concerts exist in total.
That is the property that makes this safe as the database grows, and it is the
reason to prefer it over a "refresh anything older than N days" sweep, which
grows without limit.

If a refresh finds an unchanged `setlistfmVersionId`, nothing is written and
only `lastSyncedAt` advances. If the version changed, songs are replaced in a
single transaction so a concert page never renders a half-written setlist. If
the setlist was deleted upstream, the local copy is retained and flagged stale
rather than destroyed, because a user's attendance record should not lose its
setlist due to someone else's edit.

Every imported setlist renders a visible "Source: setlist.fm" link back to the
original page, as their terms require.

## 5. Photos and storage

### 5.1 Storage interface

One module exposing `put`, `delete`, and `urlFor`, with two drivers:

- **S3-compatible driver** for real use. Identical code against Cloudflare R2,
  Backblaze B2, or AWS S3, differing only in endpoint configuration.
- **Local disk driver** so the app runs before a bucket exists.

No code outside this module knows which driver is active.

The interface therefore includes a fourth method, `createUploadTarget`, rather
than exposing presigning directly. The S3 driver returns a presigned PUT URL.
The local driver, which cannot presign anything, returns the URL of a
development-only upload route that writes to disk. Both return the same shape,
so the client-side upload flow in 5.2 is identical against either driver and the
local path is not a separate, untested code branch.

### 5.2 Upload flow

Phone photos routinely run 10 to 15 MB, which exceeds request body limits on
several common hosts, so uploads do not pass through the app server.

1. Browser requests upload permission. Server verifies the session, that the
   target Attendance belongs to the caller, that the per-show photo cap is not
   exceeded, and that the declared content type and size are allowed.
2. Server returns a presigned PUT URL under a `staging/` prefix.
3. Browser uploads directly to the bucket.
4. Browser notifies the server. The server independently verifies the stored
   object's real size and sniffs its real content type from the file header.
   Nothing the browser asserted in step 1 is trusted.

If the browser abandons the flow between steps 3 and 4, the staged object is
orphaned. A sweep job deletes anything under `staging/` older than 24 hours.

### 5.3 Processing (step 4, mandatory)

The server reads the staged file with sharp and:

1. **Strips all EXIF metadata.** Phone photos carry GPS coordinates. Publishing
   them on a public profile would disclose where the user was standing, and
   frequently their home address if the photo was later edited there. This is
   the highest-priority requirement in this section.
2. Generates a 400px-wide thumbnail for grids and a 1600px-wide display version,
   retaining the original.
3. Writes all three objects under a final `photos/<random>/` key, deletes the
   staging object, and only then creates the `Photo` row.

The `Photo` row is written last so a failure never leaves a database row
pointing at a missing object.

### 5.4 Serving and limits

**The bucket is private. There is no public-read access and no anonymous object
URL.** Unguessable keys are obfuscation, not access control: once such a URL
leaks into a referrer header, a screenshot, a shared link, or a search index, it
is public permanently and cannot be revoked without deleting the file. Photos of
identifiable people at identifiable places and times deserve better than that.

Instead, the app issues **short-lived signed URLs**, generated server-side at
render time by the storage driver's `urlFor`. Two details make this practical
rather than a performance regression:

- **Expiry is rounded, not exact.** A signed URL is issued with an expiry
  snapped up to the next 10 minute boundary, so every viewer of the same photo
  within that window receives a byte-identical URL. The CDN therefore still gets
  a stable cache key and a high hit rate, which is the objection that would
  otherwise sink signed URLs. Effective TTL is between 10 and 20 minutes.
- **Signing is local and cheap.** Signature generation is an HMAC over the key
  and expiry with no network round trip, so it costs microseconds per photo and
  adds nothing to page latency.

This also removes the blocker on private profiles. Access can later become a
real authorization check inside `urlFor` without re-uploading a single object or
changing any storage layout, which would have been impossible on a public
bucket.

The local disk driver mirrors this: `urlFor` returns a path with the same signed
query parameters, verified by the development file route, so signing is
exercised in local development rather than only in production.

Limits: 30 photos per show, 20 MB per file, accepted input types JPEG, PNG,
WebP, and HEIC.

## 6. Auth, authorization, and pages

### 6.1 Auth

Auth.js with Google OAuth and email magic links, sessions in Postgres. No
password storage. At signup the user picks a unique `handle`, which becomes
their profile URL.

### 6.2 Authorization

Every mutation resolves the target row and verifies ownership on the server
before writing, through a single `requireOwner` helper so there is one place to
audit. A hidden UI control is not an access control.

### 6.3 Pages

| Route | Purpose |
| --- | --- |
| `/` | Feed of followed users' shows when signed in, marketing page otherwise |
| `/u/[handle]` | Public profile: that user's shows plus a stats strip |
| `/u/[handle]/shows/[id]` | One logged show: notes, photo gallery, setlist, comments |
| `/shows/[id]` | Canonical concert: setlist, all attendees, all photos from that night |
| `/add` | Setlist.fm search and import, with manual fallback |
| `/artists/[id]` | Artist page with their concerts |
| `/venues/[id]` | Venue page with its concerts |
| `/settings` | Profile and account settings |
| `/admin/reports` | Moderation queue, admin only |

## 7. Safety and abuse

User-uploaded images and free-text comments on a public site require a reporting
path from day one.

- Report button on photos and comments, writing a `Report` row.
- Soft deletes on comments, so moderation is reversible.
- `User.isAdmin` flag and one plain moderation queue page.
- Rate limits on signup, comment creation, and upload permission requests.
- zod validation at every route handler boundary.

## 8. Error handling

| Failure | Behavior |
| --- | --- |
| Setlist.fm down, erroring, or over quota | `/add` falls back to manual entry; the user is told the import is unavailable, not shown a stack trace |
| Setlist.fm returns no matches | Offer manual entry pre-filled with the entered artist and date |
| Duplicate attendance | Caught by the unique constraint; user is redirected to their existing entry rather than shown an error |
| Upload rejected at verification | Staged object deleted, no `Photo` row created, clear message about type or size |
| Storage unavailable | Show logging still succeeds; photo upload reports failure independently |

## 9. Testing strategy

Tests are written before implementation, per the normal development workflow.

**Unit (Vitest)** on the logic most likely to fail quietly:
- The `dd-MM-yyyy` date helper
- The Setlist.fm response mapper (nested sets, encores, tapes, covers)
- Concert dedup and upsert behavior
- EXIF stripping (assert no GPS tags survive)
- Both storage drivers against the same interface contract
- Signed URL expiry rounding: two calls inside the same 10 minute window must
  produce identical URLs, and one past the boundary must not. This is what
  protects the CDN hit rate, and it would regress silently.
- The refresh eligibility rule: a show inside its first week is selected daily,
  one at five weeks is never selected, and the job stops once the refresh budget
  is spent rather than continuing into the interactive budget.

**Integration** against a real PostgreSQL in Docker for the import and dedup
path, because that logic lives mostly in database constraints and mocking them
would verify nothing.

**Setlist.fm is never called from the test suite.** The client is tested against
recorded response fixtures. A 1,440-call daily quota would not survive a test
suite running in a loop.

**End-to-end (Playwright)** on the two flows that must never break:
1. Sign up, then log a show via Setlist.fm import.
2. Upload a photo, then view it on the public profile while signed out.

## 10. Build order

| Phase | Delivers |
| --- | --- |
| 1 | Auth, schema, manual show logging, public profiles |
| 2 | Setlist.fm search and import, concert pages |
| 3 | Photo upload and galleries |
| 4 | Stats |
| 5 | Follow, feed, comments, likes, moderation |

Phases 1 through 3 deliver the originally requested product. Phases 4 and 5 are
additive and can be resequenced or dropped without rework.

## 11. Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Auth.js session signing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `EMAIL_SERVER`, `EMAIL_FROM` | Magic link delivery |
| `SETLISTFM_API_KEY` | Setlist.fm, server-side only |
| `SETLISTFM_DAILY_QUOTA` | Total daily call budget, default 1440, raised if a higher tier key is granted |
| `SETLISTFM_REFRESH_BUDGET_PCT` | Share of the quota the refresh job may spend, default 20 |
| `CRON_SECRET` | Shared secret authenticating the scheduled refresh and staging sweep endpoints |
| `STORAGE_DRIVER` | `s3` or `local` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Object storage, private bucket |
| `ASSET_BASE_URL` | CDN origin fronting the private bucket |
| `ASSET_URL_TTL_SECONDS` | Signed URL lifetime, default 600, rounded up per 5.4 |

## 12. Open items for the implementer

None blocking. Two decisions deliberately deferred:

1. Precomputed stats counters, deferred until a query is measured as slow.
2. Venue latitude and longitude are stored but unused; a map view is out of
   scope for v1.

Private profiles remain out of scope for v1, but 5.4 deliberately leaves the
door open: because photos are served through signed URLs from a private bucket,
adding an authorization check later is a change inside `urlFor` rather than a
migration of every stored object.
