# Concert Tracker Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working public site where a user signs in, manually logs a show they attended (including festivals with multiple acts), and shares a public profile page listing it.

**Architecture:** Next.js App Router monolith. Server Components render public pages; server actions handle mutations. All show-logging logic lives in one domain module (`src/domain/log-show.ts`) that the UI calls, so the Phase 2 Setlist.fm importer can reuse it unchanged. PostgreSQL via Prisma, with the Event/Performance split from the spec enforced by database unique constraints rather than application checks.

**Tech Stack:** Next.js 16.3.4, React 19.2.8, TypeScript, Prisma 7.10.0, PostgreSQL 17, Auth.js 5.0.0-beta.32, Zod 4.5.4, Vitest 5.0.0, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-09-03-concert-tracker-design.md`

## Global Constraints

- Node 20 or newer. Package manager is npm.
- Pin these exact versions: `next@16.3.4`, `react@19.2.8`, `react-dom@19.2.8`, `prisma@7.10.0`, `@prisma/client@7.10.0`, `next-auth@5.0.0-beta.32`, `@auth/prisma-adapter@2.11.3`, `zod@4.5.4`, `vitest@5.0.0`, `@playwright/test@1.62.1`, `tsx@4.23.13`.
- `next-auth` v5 is published under the `beta` dist-tag. `latest` is the v4 line and is NOT compatible with the App Router setup in this plan. Always install it as `next-auth@5.0.0-beta.32`.
- Prisma 8 exists only as a release candidate. Do not use it.
- Every mutation verifies ownership server-side via `requireOwner` (spec 6.2). A hidden UI control is not an access control.
- Every route handler and server action validates input with Zod at the boundary (spec 7).
- Dates are stored as PostgreSQL `DATE` with no time component (spec 3.2). Never store a show date as a timestamp; timezone drift silently moves shows to the wrong day.
- No em dashes in user-facing copy, comments, or docs. Use periods, commas, colons, or parentheses.
- Tests are written before implementation. Every task follows red, green, commit.
- Integration tests run against a real PostgreSQL (spec 9). Do not mock Prisma; the logic under test is mostly database constraints and mocking them verifies nothing.

## Scope

This plan covers **Phase 1 only** (spec section 10): auth, schema, manual show logging, public profiles.

Explicitly NOT in this plan, each of which gets its own plan later:
- Setlist.fm search and import (Phase 2)
- Photo upload, storage drivers, EXIF stripping (Phase 3)
- Stats pages (Phase 4)
- Follow, feed, comments, likes, moderation (Phase 5)

Tables for deferred phases are not created here. The `Photo`, `Follow`, `Comment`, `Like`, and `Report` models arrive with the phases that use them.

**Spec requirements deliberately deferred, recorded so they are not lost:**

| Spec ref | Requirement | Lands in |
| --- | --- | --- |
| 6.3 | `/artists/[id]` and `/venues/[id]` browse pages | Phase 2, where imports make them worth browsing |
| 6.3 | `/settings` | Phase 2 |
| 6.3 | `/` as a followed-user feed | Phase 5. Phase 1 leaves the `create-next-app` landing page in place |
| 6.3, 7 | `/admin/reports` and the moderation queue | Phase 5, with the content it moderates |
| 7 | Rate limiting on signup | Phase 5, alongside comment and upload limits, since all three want one shared limiter and Phase 1 has no public write path beyond logging your own shows |

The one to watch is signup rate limiting. It is the only deferred item that protects something existing in Phase 1, so if this deploys publicly before Phase 5, add it first.

## Spec Refinement Adopted In This Plan

The spec dedupes `Artist` on `mbid` and `Venue` on `setlistfmVenueId`, but both are null for manually entered shows, and Phase 1 is entirely manual entry. Without a second key, typing "Wednesday" twice creates two artists and the shared-object principle (spec 3.1) breaks on day one.

This plan therefore adds a normalized `nameKey` column to both:
- `Artist.nameKey` unique. Lowercased, trimmed, internal whitespace collapsed.
- `Venue` unique on `(nameKey, city, country)`. Two venues can share a name in different cities.

`mbid` and `setlistfmVenueId` remain as the spec defines them and stay authoritative when present in Phase 2.

## File Structure

| File | Responsibility |
| --- | --- |
| `docker-compose.yml` | Local PostgreSQL 17 for development and tests |
| `prisma/schema.prisma` | Data model, the only source of schema truth |
| `src/lib/db.ts` | Prisma client singleton (avoids exhausting connections on hot reload) |
| `src/lib/text.ts` | `normalizeName`, pure string helpers |
| `src/lib/retry.ts` | `retryOnUniqueViolation`, concurrency safety for upserts |
| `src/lib/handle.ts` | Handle validation and reserved names |
| `src/domain/log-show.ts` | `logShow`, the one place a show gets recorded |
| `src/domain/describe-attendance.ts` | `describeAttendance`, the single vs multi act display rule |
| `src/auth.ts` | Auth.js configuration and exports |
| `src/lib/authz.ts` | `requireUser`, `requireOwner` |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js route handlers |
| `src/app/onboarding/page.tsx` + `actions.ts` | Handle selection after first sign-in |
| `src/app/add/page.tsx` + `actions.ts` | Manual show entry form |
| `src/app/u/[handle]/page.tsx` | Public profile |
| `src/app/u/[handle]/shows/[id]/page.tsx` | One logged night |
| `src/app/events/[id]/page.tsx` | Canonical night: lineup and attendees |
| `tests/helpers/db.ts` | Test database reset helper |
| `e2e/*.spec.ts` | Playwright flows |

---

### Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/lib/text.ts`
- Test: `tests/lib/text.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeName(input: string): string`, a working `npm test` command

- [ ] **Step 1: Scaffold the Next.js app**

Run from `C:\Users\dmlan\Projects\concert-tracker`:

```bash
npx create-next-app@16.3.4 . --typescript --app --src-dir --eslint --no-tailwind --import-alias "@/*" --use-npm --yes
```

If it refuses because the directory is not empty, that is expected (the repo already has `docs/`). Answer yes to proceed; it does not delete existing files.

- [ ] **Step 2: Pin remaining dependencies**

```bash
npm install prisma@7.10.0 @prisma/client@7.10.0 next-auth@5.0.0-beta.32 @auth/prisma-adapter@2.11.3 zod@4.5.4 nodemailer@7.0.4
npm install -D vitest@5.0.0 @playwright/test@1.62.1 tsx@4.23.13 dotenv@17.2.3
```

- [ ] **Step 3: Add the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    setupFiles: ["tests/helpers/load-env.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

Create `tests/helpers/load-env.ts`:

```ts
import { config } from "dotenv";

config({ path: ".env.test" });
config({ path: ".env" });
```

- [ ] **Step 4: Add the test script**

In `package.json`, set the `scripts` block to:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Write the failing test**

Create `tests/lib/text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/text";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Wednesday  ")).toBe("wednesday");
  });

  it("collapses internal whitespace so spacing typos still dedupe", () => {
    expect(normalizeName("King  Gizzard\tand the\nLizard Wizard")).toBe(
      "king gizzard and the lizard wizard",
    );
  });

  it("is idempotent", () => {
    const once = normalizeName("The   National ");
    expect(normalizeName(once)).toBe(once);
  });

  it("returns an empty string for whitespace only input", () => {
    expect(normalizeName("   ")).toBe("");
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL, cannot resolve `@/lib/text`.

- [ ] **Step 7: Implement**

Create `src/lib/text.ts`:

```ts
/**
 * Normalizes a name into a dedupe key. Manually entered artists and venues
 * have no external id, so this key is what stops "Wednesday" and " wednesday "
 * from becoming two rows.
 */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
```

- [ ] **Step 8: Run it and confirm it passes**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with Vitest and name normalization"
```

---

### Task 2: Database, schema, and the constraints that carry the model

**Files:**
- Create: `docker-compose.yml`, `.env`, `.env.test`, `.env.example`
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`, `tests/helpers/db.ts`
- Test: `tests/domain/schema-constraints.test.ts`

**Interfaces:**
- Consumes: `normalizeName` (Task 1)
- Produces: `prisma` client from `@/lib/db`; `resetDb()` from `tests/helpers/db`; the `Event`, `Performance`, `Attendance`, `AttendedPerformance`, `Artist`, `Venue`, `SetlistSong` models

- [ ] **Step 1: Add PostgreSQL**

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: concert
      POSTGRES_PASSWORD: concert
      POSTGRES_DB: concert
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Port 5433 avoids colliding with any PostgreSQL already installed on the host.

Start it: `docker compose up -d`

- [ ] **Step 2: Create env files**

Create `.env`:

```
DATABASE_URL="postgresql://concert:concert@localhost:5433/concert?schema=public"
AUTH_SECRET="dev-secret-replace-me"
AUTH_URL="http://localhost:3000"
```

Create `.env.test`:

```
DATABASE_URL="postgresql://concert:concert@localhost:5433/concert_test?schema=public"
AUTH_SECRET="test-secret"
AUTH_URL="http://localhost:3000"
```

Create `.env.example` with the same keys and empty values, plus the Phase 2 and 3 keys from spec section 11 commented out so nobody has to rediscover them later.

Confirm `.env` and `.env.test` are in `.gitignore`. `create-next-app` ignores `.env*` by default; verify, and make sure `.env.example` is NOT ignored (`git check-ignore -v .env.example` should print nothing).

- [ ] **Step 3: Initialize Prisma**

```bash
npx prisma@7.10.0 init --datasource-provider postgresql
```

This writes a `prisma/schema.prisma` with the correct `generator` and `datasource` blocks for this exact Prisma version. **Keep those two blocks exactly as generated** and only replace the model section below. Do not hand-write the generator block; its required fields changed in Prisma 7.

- [ ] **Step 4: Write the models**

Append to `prisma/schema.prisma` (after the generated `generator` and `datasource` blocks):

```prisma
// ---------- Auth.js ----------

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  handle        String?   @unique
  bio           String?
  isAdmin       Boolean   @default(false)
  createdAt     DateTime  @default(now())

  accounts    Account[]
  sessions    Session[]
  attendances Attendance[]
}

model Account {
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([provider, providerAccountId])
}

model Session {
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String
  expires    DateTime

  @@id([identifier, token])
}

// ---------- Canonical layer (spec 3.2) ----------

model Artist {
  id       String  @id @default(cuid())
  name     String
  nameKey  String  @unique
  mbid     String? @unique
  imageUrl String?

  performances Performance[]
}

model Venue {
  id                String  @id @default(cuid())
  name              String
  nameKey           String
  city              String
  state             String?
  country           String
  setlistfmVenueId  String? @unique
  lat               Float?
  lng               Float?

  events Event[]

  @@unique([nameKey, city, country])
}

model Event {
  id           String   @id @default(cuid())
  venueId      String
  date         DateTime @db.Date
  name         String?
  festivalName String?
  createdAt    DateTime @default(now())

  venue        Venue         @relation(fields: [venueId], references: [id])
  performances Performance[]
  attendances  Attendance[]

  @@unique([venueId, date])
  @@index([date])
}

enum Billing {
  headliner
  support
  unknown
}

model Performance {
  id                 String    @id @default(cuid())
  eventId            String
  artistId           String
  billing            Billing   @default(unknown)
  setOrder           Int?
  tourName           String?
  setlistfmId        String?   @unique
  setlistfmVersionId String?
  lastSyncedAt       DateTime?

  event    Event                 @relation(fields: [eventId], references: [id], onDelete: Cascade)
  artist   Artist                @relation(fields: [artistId], references: [id])
  songs    SetlistSong[]
  attended AttendedPerformance[]

  @@unique([eventId, artistId])
}

model SetlistSong {
  id              String  @id @default(cuid())
  performanceId   String
  position        Int
  name            String
  info            String?
  isTape          Boolean @default(false)
  coverArtistName String?
  encore          Int     @default(0)

  performance Performance @relation(fields: [performanceId], references: [id], onDelete: Cascade)

  @@unique([performanceId, position])
}

// ---------- Personal layer (spec 3.3) ----------

model Attendance {
  id           String   @id @default(cuid())
  userId       String
  eventId      String
  notes        String?
  rating       Int?
  attendedWith String?
  createdAt    DateTime @default(now())

  user     User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  event    Event                 @relation(fields: [eventId], references: [id])
  attended AttendedPerformance[]

  @@unique([userId, eventId])
  @@index([userId, createdAt])
}

model AttendedPerformance {
  attendanceId  String
  performanceId String
  rating        Int?
  notes         String?

  attendance  Attendance  @relation(fields: [attendanceId], references: [id], onDelete: Cascade)
  performance Performance @relation(fields: [performanceId], references: [id], onDelete: Cascade)

  @@id([attendanceId, performanceId])
}
```

- [ ] **Step 5: Create the migration**

```bash
npx prisma migrate dev --name init
```

Then create the test database and apply the same migration to it:

```bash
docker compose exec db psql -U concert -d concert -c "CREATE DATABASE concert_test;"
npx dotenv -e .env.test -- prisma migrate deploy
```

If `dotenv` CLI is unavailable, set `DATABASE_URL` inline for that one command instead.

- [ ] **Step 6: Add the Prisma singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

// Next.js hot reload re-evaluates modules, which would open a new pool on
// every reload and exhaust PostgreSQL connections. Cache it on globalThis.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Note: if the Prisma 7 generator wrote the client to a custom `output` path, import from that path instead of `@prisma/client`. Check the `generator` block written in Step 3 and use whatever path it names.

- [ ] **Step 7: Add the test database helper**

Create `tests/helpers/db.ts`:

```ts
import { prisma } from "@/lib/db";

/**
 * Truncates every domain table between tests. Faster than re-running
 * migrations, and RESTART IDENTITY keeps sequences predictable.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AttendedPerformance", "Attendance", "SetlistSong",
      "Performance", "Event", "Venue", "Artist",
      "Session", "Account", "VerificationToken", "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function createTestUser(handle: string) {
  return prisma.user.create({
    data: { handle, email: `${handle}@example.test`, name: handle },
  });
}
```

- [ ] **Step 8: Write the failing constraint test**

Create `tests/domain/schema-constraints.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function makeVenue() {
  return prisma.venue.create({
    data: { name: "The Fillmore", nameKey: "the fillmore", city: "San Francisco", country: "US" },
  });
}

describe("schema constraints", () => {
  it("allows only one Event per venue per date", async () => {
    const venue = await makeVenue();
    const date = new Date("2026-06-13T00:00:00Z");

    await prisma.event.create({ data: { venueId: venue.id, date } });

    await expect(
      prisma.event.create({ data: { venueId: venue.id, date } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows only one Performance per artist per event", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });
    const artist = await prisma.artist.create({
      data: { name: "Wednesday", nameKey: "wednesday" },
    });

    await prisma.performance.create({ data: { eventId: event.id, artistId: artist.id } });

    await expect(
      prisma.performance.create({ data: { eventId: event.id, artistId: artist.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows many artists at one event, which is what makes festivals work", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });
    const a = await prisma.artist.create({ data: { name: "A", nameKey: "a" } });
    const b = await prisma.artist.create({ data: { name: "B", nameKey: "b" } });

    await prisma.performance.create({ data: { eventId: event.id, artistId: a.id } });
    await prisma.performance.create({ data: { eventId: event.id, artistId: b.id } });

    const count = await prisma.performance.count({ where: { eventId: event.id } });
    expect(count).toBe(2);
  });

  it("allows only one Attendance per user per event", async () => {
    const user = await createTestUser("dylan");
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });

    await prisma.attendance.create({ data: { userId: user.id, eventId: event.id } });

    await expect(
      prisma.attendance.create({ data: { userId: user.id, eventId: event.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores the show date without shifting it across a timezone boundary", async () => {
    const venue = await makeVenue();
    const event = await prisma.event.create({
      data: { venueId: venue.id, date: new Date("2026-06-13T00:00:00Z") },
    });

    const found = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(found.date.toISOString().slice(0, 10)).toBe("2026-06-13");
  });
});
```

- [ ] **Step 9: Run and confirm it passes**

Run: `npm test`
Expected: PASS, 9 tests total.

These tests pass on first run rather than failing first, because the deliverable under test is the schema written in Step 4. They are regression tests protecting the four constraints the entire model rests on. If any of them fail later, the model has been broken.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add Prisma schema with Event and Performance model plus constraint tests"
```

---

### Task 3: Unique-violation retry helper

**Files:**
- Create: `src/lib/retry.ts`
- Test: `tests/lib/retry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `retryOnUniqueViolation<T>(fn: () => Promise<T>, attempts?: number): Promise<T>`

Two users logging the same show at the same instant both find no existing Event, both insert, and one gets a P2002. The correct response is to retry, because the second attempt will find the row the winner just created.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/retry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { retryOnUniqueViolation } from "@/lib/retry";

function p2002() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

describe("retryOnUniqueViolation", () => {
  it("returns the value when the function succeeds first time", async () => {
    await expect(retryOnUniqueViolation(async () => "ok")).resolves.toBe("ok");
  });

  it("retries after a unique violation and returns the second result", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(p2002())
      .mockResolvedValueOnce("second");

    await expect(retryOnUniqueViolation(fn)).resolves.toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows errors that are not unique violations without retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("connection refused"));

    await expect(retryOnUniqueViolation(fn)).rejects.toThrow("connection refused");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt limit and rethrows the violation", async () => {
    const fn = vi.fn().mockRejectedValue(p2002());

    await expect(retryOnUniqueViolation(fn, 3)).rejects.toMatchObject({ code: "P2002" });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/lib/retry.test.ts`
Expected: FAIL, cannot resolve `@/lib/retry`.

- [ ] **Step 3: Implement**

Create `src/lib/retry.ts`:

```ts
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Retries on PostgreSQL unique violations surfaced by Prisma as P2002.
 *
 * Two users logging the same show simultaneously will both fail to find an
 * existing row and both try to insert. The loser retries and finds the row
 * the winner created. Any other error is a real failure and is rethrown.
 */
export async function retryOnUniqueViolation<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test tests/lib/retry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add retryOnUniqueViolation for concurrent show logging"
```

---

### Task 4: `logShow`, the single place a show gets recorded

**Files:**
- Create: `src/domain/log-show.ts`
- Test: `tests/domain/log-show.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `normalizeName` (Task 1), `retryOnUniqueViolation` (Task 3)
- Produces:

```ts
export type LogShowInput = {
  userId: string;
  artistName: string;
  venueName: string;
  city: string;
  state?: string | null;
  country: string;
  date: string;            // "yyyy-MM-dd"
  eventName?: string | null;
  festivalName?: string | null;
  notes?: string | null;
  rating?: number | null;
  attendedWith?: string | null;
  songs?: string[];
};

export type LogShowResult = {
  attendanceId: string;
  eventId: string;
  performanceId: string;
  joinedExistingEvent: boolean;
  alreadyAttended: boolean;
};

export function logShow(input: LogShowInput): Promise<LogShowResult>;
export function attendPerformance(
  userId: string,
  performanceId: string,
): Promise<{ attendanceId: string }>;
```

This is the most important module in the plan. Phase 2's importer calls it too, so its behavior is the contract for the whole app.

- [ ] **Step 1: Write the failing tests**

Create `tests/domain/log-show.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow, attendPerformance } from "@/domain/log-show";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const base = {
  venueName: "The Fillmore",
  city: "San Francisco",
  country: "US",
  date: "2026-06-13",
};

describe("logShow", () => {
  it("creates artist, venue, event, performance, attendance and attended row", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    expect(result.joinedExistingEvent).toBe(false);
    expect(result.alreadyAttended).toBe(false);

    const attendance = await prisma.attendance.findUniqueOrThrow({
      where: { id: result.attendanceId },
      include: { attended: true, event: { include: { venue: true, performances: true } } },
    });

    expect(attendance.event.venue.name).toBe("The Fillmore");
    expect(attendance.event.performances).toHaveLength(1);
    expect(attendance.attended).toHaveLength(1);
    expect(attendance.attended[0].performanceId).toBe(result.performanceId);
  });

  it("dedupes the artist by normalized name so spacing and case do not fork rows", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: b.id, artistName: "  wednesday " });

    expect(await prisma.artist.count()).toBe(1);
  });

  it("attaches a second artist on the same night to the SAME event", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    const first = await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    expect(second.eventId).toBe(first.eventId);
    expect(second.joinedExistingEvent).toBe(true);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.performance.count({ where: { eventId: first.eventId } })).toBe(2);
  });

  it("does not create a second event for a different venue on the same date", async () => {
    const user = await createTestUser("dylan");

    await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      venueName: "Great American Music Hall",
    });

    expect(await prisma.event.count()).toBe(2);
  });

  it("adds a second act to the user's EXISTING attendance instead of failing", async () => {
    const user = await createTestUser("dylan");

    const first = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: user.id, artistName: "MJ Lenderman" });

    expect(second.attendanceId).toBe(first.attendanceId);
    expect(second.alreadyAttended).toBe(true);

    const attended = await prisma.attendedPerformance.count({
      where: { attendanceId: first.attendanceId },
    });
    expect(attended).toBe(2);
  });

  it("is idempotent when the same user logs the identical show twice", async () => {
    const user = await createTestUser("dylan");

    const first = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const second = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    expect(second.attendanceId).toBe(first.attendanceId);
    expect(second.performanceId).toBe(first.performanceId);
    expect(await prisma.attendedPerformance.count()).toBe(1);
  });

  it("stores a manually typed setlist in order", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      songs: ["Bull Believer", "Chosen to Deserve", "Bath County"],
    });

    const songs = await prisma.setlistSong.findMany({
      where: { performanceId: result.performanceId },
      orderBy: { position: "asc" },
    });

    expect(songs.map((s) => s.name)).toEqual([
      "Bull Believer",
      "Chosen to Deserve",
      "Bath County",
    ]);
    expect(songs.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it("ignores blank song lines rather than storing empty songs", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({
      ...base,
      userId: user.id,
      artistName: "Wednesday",
      songs: ["Bull Believer", "   ", "", "Bath County"],
    });

    const songs = await prisma.setlistSong.findMany({
      where: { performanceId: result.performanceId },
    });
    expect(songs).toHaveLength(2);
  });

  it("does not duplicate songs when the same performance is logged again", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    await logShow({ ...base, userId: a.id, artistName: "Wednesday", songs: ["Bull Believer"] });
    await logShow({ ...base, userId: b.id, artistName: "Wednesday", songs: ["Bull Believer"] });

    expect(await prisma.setlistSong.count()).toBe(1);
  });

  it("stores the date as the calendar day given, with no timezone drift", async () => {
    const user = await createTestUser("dylan");

    const result = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: result.eventId } });

    expect(event.date.toISOString().slice(0, 10)).toBe("2026-06-13");
  });

  it("rejects a malformed date", async () => {
    const user = await createTestUser("dylan");

    await expect(
      logShow({ ...base, userId: user.id, artistName: "Wednesday", date: "13-06-2026" }),
    ).rejects.toThrow(/date/i);
  });
});

describe("attendPerformance", () => {
  it("lets a user tick another act from a lineup they already attended", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    // User A logs the headliner. User B logs the opener, creating a second
    // performance on the same event.
    await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    const opener = await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    // User A now says they also caught the opener.
    const { attendanceId } = await attendPerformance(a.id, opener.performanceId);

    const attended = await prisma.attendedPerformance.count({ where: { attendanceId } });
    expect(attended).toBe(2);
  });

  it("is idempotent when ticking the same act twice", async () => {
    const user = await createTestUser("dylan");
    const show = await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    await attendPerformance(user.id, show.performanceId);

    expect(
      await prisma.attendedPerformance.count({ where: { attendanceId: show.attendanceId } }),
    ).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/domain/log-show.test.ts`
Expected: FAIL, cannot resolve `@/domain/log-show`.

- [ ] **Step 3: Implement**

Create `src/domain/log-show.ts`:

```ts
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/text";
import { retryOnUniqueViolation } from "@/lib/retry";

export type LogShowInput = {
  userId: string;
  artistName: string;
  venueName: string;
  city: string;
  state?: string | null;
  country: string;
  /** Calendar day of the show, "yyyy-MM-dd". */
  date: string;
  eventName?: string | null;
  festivalName?: string | null;
  notes?: string | null;
  rating?: number | null;
  attendedWith?: string | null;
  songs?: string[];
};

export type LogShowResult = {
  attendanceId: string;
  eventId: string;
  performanceId: string;
  /** True when this artist joined a night already in the database. */
  joinedExistingEvent: boolean;
  /** True when the user already had an attendance for this night. */
  alreadyAttended: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses "yyyy-MM-dd" into a UTC midnight Date.
 *
 * Using `new Date("2026-06-13")` directly is correct here only because the
 * string is date-only and therefore parsed as UTC, but we validate the shape
 * first so a locale-formatted string cannot silently land on the wrong day.
 */
function parseShowDate(input: string): Date {
  if (!ISO_DATE.test(input)) {
    throw new Error(`Invalid date "${input}", expected yyyy-MM-dd`);
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date "${input}"`);
  }
  return date;
}

export async function logShow(input: LogShowInput): Promise<LogShowResult> {
  const date = parseShowDate(input.date);
  const artistKey = normalizeName(input.artistName);
  const venueKey = normalizeName(input.venueName);

  if (!artistKey) throw new Error("Artist name is required");
  if (!venueKey) throw new Error("Venue name is required");

  const songs = (input.songs ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const artist = await tx.artist.upsert({
        where: { nameKey: artistKey },
        create: { name: input.artistName.trim(), nameKey: artistKey },
        update: {},
      });

      const venue = await tx.venue.upsert({
        where: {
          nameKey_city_country: {
            nameKey: venueKey,
            city: input.city.trim(),
            country: input.country.trim(),
          },
        },
        create: {
          name: input.venueName.trim(),
          nameKey: venueKey,
          city: input.city.trim(),
          state: input.state?.trim() || null,
          country: input.country.trim(),
        },
        update: {},
      });

      const existingEvent = await tx.event.findUnique({
        where: { venueId_date: { venueId: venue.id, date } },
      });
      const joinedExistingEvent = existingEvent !== null;

      const event =
        existingEvent ??
        (await tx.event.create({
          data: {
            venueId: venue.id,
            date,
            name: input.eventName?.trim() || null,
            festivalName: input.festivalName?.trim() || null,
          },
        }));

      const performance = await tx.performance.upsert({
        where: { eventId_artistId: { eventId: event.id, artistId: artist.id } },
        create: { eventId: event.id, artistId: artist.id },
        update: {},
      });

      // Songs are written only when this performance has none. The setlist is
      // shared, so the second person to log the same set must not duplicate it
      // or silently overwrite what the first person entered.
      if (songs.length > 0) {
        const existingSongs = await tx.setlistSong.count({
          where: { performanceId: performance.id },
        });
        if (existingSongs === 0) {
          await tx.setlistSong.createMany({
            data: songs.map((name, position) => ({
              performanceId: performance.id,
              position,
              name,
            })),
          });
        }
      }

      const existingAttendance = await tx.attendance.findUnique({
        where: { userId_eventId: { userId: input.userId, eventId: event.id } },
      });
      const alreadyAttended = existingAttendance !== null;

      const attendance =
        existingAttendance ??
        (await tx.attendance.create({
          data: {
            userId: input.userId,
            eventId: event.id,
            notes: input.notes?.trim() || null,
            rating: input.rating ?? null,
            attendedWith: input.attendedWith?.trim() || null,
          },
        }));

      await tx.attendedPerformance.upsert({
        where: {
          attendanceId_performanceId: {
            attendanceId: attendance.id,
            performanceId: performance.id,
          },
        },
        create: { attendanceId: attendance.id, performanceId: performance.id },
        update: {},
      });

      return {
        attendanceId: attendance.id,
        eventId: event.id,
        performanceId: performance.id,
        joinedExistingEvent,
        alreadyAttended,
      };
    }),
  );
}

/**
 * Records that a user also saw a given act. Creates their attendance for that
 * night if they did not already have one, which is what makes the lineup
 * picker work for someone who logged only the headliner.
 */
export async function attendPerformance(
  userId: string,
  performanceId: string,
): Promise<{ attendanceId: string }> {
  return retryOnUniqueViolation(() =>
    prisma.$transaction(async (tx) => {
      const performance = await tx.performance.findUniqueOrThrow({
        where: { id: performanceId },
        select: { id: true, eventId: true },
      });

      const attendance = await tx.attendance.upsert({
        where: { userId_eventId: { userId, eventId: performance.eventId } },
        create: { userId, eventId: performance.eventId },
        update: {},
      });

      await tx.attendedPerformance.upsert({
        where: {
          attendanceId_performanceId: {
            attendanceId: attendance.id,
            performanceId: performance.id,
          },
        },
        create: { attendanceId: attendance.id, performanceId: performance.id },
        update: {},
      });

      return { attendanceId: attendance.id };
    }),
  );
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test tests/domain/log-show.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add logShow domain service with festival attach and idempotency"
```

---

### Task 5: Attendance display rule

**Files:**
- Create: `src/domain/describe-attendance.ts`
- Test: `tests/domain/describe-attendance.test.ts`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces:

```ts
export type AttendanceSummary = {
  eventName: string | null;
  festivalName: string | null;
  venueName: string;
  city: string;
  date: Date;
  attendedArtistNames: string[];
  lineupSize: number;
};

export type AttendanceDescription = {
  title: string;
  subtitle: string;
  isMultiAct: boolean;
};

export function describeAttendance(s: AttendanceSummary): AttendanceDescription;
```

Spec 3.4 requires a one act night to read as "Artist at Venue" and a multi act night to read as the event name plus the acts caught. Keeping that rule in a pure function means it is tested once and reused by the profile, the feed (Phase 5), and the attendance page.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/describe-attendance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeAttendance } from "@/domain/describe-attendance";

const base = {
  eventName: null,
  festivalName: null,
  venueName: "The Fillmore",
  city: "San Francisco",
  date: new Date("2026-06-13T00:00:00Z"),
};

describe("describeAttendance", () => {
  it("reads as 'Artist at Venue' for a single act night", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["Wednesday"],
      lineupSize: 1,
    });

    expect(result.title).toBe("Wednesday");
    expect(result.subtitle).toBe("The Fillmore, San Francisco");
    expect(result.isMultiAct).toBe(false);
  });

  it("still reads as a single act when the user caught one act of a larger bill", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["Wednesday"],
      lineupSize: 4,
    });

    expect(result.title).toBe("Wednesday");
    expect(result.isMultiAct).toBe(false);
  });

  it("lists the acts caught when there is more than one", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["MJ Lenderman", "Wednesday"],
      lineupSize: 2,
    });

    expect(result.title).toBe("MJ Lenderman, Wednesday");
    expect(result.isMultiAct).toBe(true);
  });

  it("prefers the event name as the title when one is set", () => {
    const result = describeAttendance({
      ...base,
      eventName: "Bonnaroo 2026, Day 2",
      attendedArtistNames: ["Wednesday", "MJ Lenderman", "Indigo De Souza"],
      lineupSize: 40,
    });

    expect(result.title).toBe("Bonnaroo 2026, Day 2");
    expect(result.subtitle).toContain("3 acts");
  });

  it("summarizes rather than listing when many acts were caught", () => {
    const result = describeAttendance({
      ...base,
      attendedArtistNames: ["A", "B", "C", "D", "E"],
      lineupSize: 40,
    });

    expect(result.title).toBe("A, B, C and 2 more");
  });

  it("handles an attendance with no acts ticked", () => {
    const result = describeAttendance({ ...base, attendedArtistNames: [], lineupSize: 3 });

    expect(result.title).toBe("The Fillmore");
    expect(result.isMultiAct).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/domain/describe-attendance.test.ts`
Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Implement**

Create `src/domain/describe-attendance.ts`:

```ts
export type AttendanceSummary = {
  eventName: string | null;
  festivalName: string | null;
  venueName: string;
  city: string;
  date: Date;
  /** Artists the user ticked, in the order they should be shown. */
  attendedArtistNames: string[];
  /** How many acts the night has in total, attended or not. */
  lineupSize: number;
};

export type AttendanceDescription = {
  title: string;
  subtitle: string;
  isMultiAct: boolean;
};

const MAX_LISTED = 3;

function listArtists(names: string[]): string {
  if (names.length <= MAX_LISTED) return names.join(", ");
  const shown = names.slice(0, MAX_LISTED).join(", ");
  return `${shown} and ${names.length - MAX_LISTED} more`;
}

/**
 * Decides how one logged night is labeled. Spec 3.4: a plain gig must not read
 * like paperwork, so a single attended act renders as just the artist, and the
 * event scaffolding only appears when the user actually saw several acts.
 */
export function describeAttendance(s: AttendanceSummary): AttendanceDescription {
  const place = `${s.venueName}, ${s.city}`;
  const attended = s.attendedArtistNames;
  const isMultiAct = attended.length > 1;

  if (attended.length === 0) {
    return { title: s.venueName, subtitle: s.city, isMultiAct: false };
  }

  if (!isMultiAct) {
    return { title: attended[0], subtitle: place, isMultiAct: false };
  }

  const actCount = `${attended.length} act${attended.length === 1 ? "" : "s"}`;

  if (s.eventName) {
    return {
      title: s.eventName,
      subtitle: `${actCount} at ${place}`,
      isMultiAct: true,
    };
  }

  return { title: listArtists(attended), subtitle: place, isMultiAct: true };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test tests/domain/describe-attendance.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add describeAttendance display rule for single and multi act nights"
```

---

### Task 6: Handle validation

**Files:**
- Create: `src/lib/handle.ts`
- Test: `tests/lib/handle.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `handleSchema` (a Zod schema), `RESERVED_HANDLES: ReadonlySet<string>`

Handles sit at the URL root as `/u/<handle>`, and a handle that collides with a route name would shadow a real page, so reserved names are checked here rather than discovered in production.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/handle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { handleSchema } from "@/lib/handle";

describe("handleSchema", () => {
  it.each(["dylan", "dyl_an", "a1b2c3", "abc"])("accepts %s", (h) => {
    expect(handleSchema.parse(h)).toBe(h);
  });

  it("lowercases input so /u/Dylan and /u/dylan cannot be different people", () => {
    expect(handleSchema.parse("Dylan")).toBe("dylan");
  });

  it("trims surrounding whitespace", () => {
    expect(handleSchema.parse("  dylan  ")).toBe("dylan");
  });

  it.each([
    ["ab", "too short"],
    ["a".repeat(31), "too long"],
    ["has space", "space"],
    ["has-hyphen", "hyphen"],
    ["emoji🎸", "emoji"],
    ["", "empty"],
  ])("rejects %s (%s)", (input) => {
    expect(() => handleSchema.parse(input)).toThrow();
  });

  it.each(["add", "events", "settings", "admin", "api", "u", "login"])(
    "rejects the reserved handle %s",
    (h) => {
      expect(() => handleSchema.parse(h)).toThrow(/reserved/i);
    },
  );

  it("rejects a reserved handle regardless of case", () => {
    expect(() => handleSchema.parse("Admin")).toThrow(/reserved/i);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/lib/handle.test.ts`
Expected: FAIL, cannot resolve `@/lib/handle`.

- [ ] **Step 3: Implement**

Create `src/lib/handle.ts`:

```ts
import { z } from "zod";

/**
 * Names that would shadow a real route if someone claimed them as a handle,
 * plus the obvious impersonation risks.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "add", "admin", "api", "auth", "about", "artists", "events", "help",
  "login", "logout", "onboarding", "privacy", "search", "settings",
  "signin", "signout", "signup", "shows", "support", "terms", "u", "venues",
  "concert-tracker", "root", "system",
]);

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Handle must be at least 3 characters")
  .max(30, "Handle must be at most 30 characters")
  .regex(/^[a-z0-9_]+$/, "Handle may contain only letters, numbers and underscores")
  .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved");
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test tests/lib/handle.test.ts`
Expected: PASS.

If the reserved-name assertions fail with a message about length or pattern instead of "reserved", that is Zod short-circuiting. It is fine as long as the reserved cases still throw; adjust the `.toThrow(/reserved/i)` matcher only for inputs that also violate another rule (none of the listed reserved names do).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add handle validation with reserved route names"
```

---

### Task 7: Auth.js wiring and authorization helpers

**Files:**
- Create: `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/authz.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `tests/lib/authz.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2)
- Produces: `auth()`, `signIn()`, `signOut()`, `handlers` from `@/auth`; `requireUser()`, `requireOwner(attendanceId)` from `@/lib/authz`

- [ ] **Step 1: Configure Auth.js**

Create `src/auth.ts`:

```ts
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import { prisma } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Google,
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM,
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      session.user.handle = (user as { handle: string | null }).handle;
      return session;
    },
  },
});
```

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
export { GET, POST } from "@/auth";
```

Note: `handlers` is an object with `GET` and `POST`. If the re-export above does not type-check in this Auth.js beta, use the explicit form instead:

```ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

Create `src/types/next-auth.d.ts`:

```ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string; handle: string | null } & DefaultSession["user"];
  }
}
```

- [ ] **Step 2: Add auth env vars**

Append to `.env` and `.env.example`:

```
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
EMAIL_SERVER="smtp://localhost:1025"
EMAIL_FROM="noreply@localhost"
```

For local development, run a throwaway SMTP catcher so magic links are visible: `docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`, then read mail at `http://localhost:8025`.

- [ ] **Step 3: Write the failing authorization test**

Create `tests/lib/authz.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow } from "@/domain/log-show";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

const { requireUser, requireOwner } = await import("@/lib/authz");

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const show = {
  venueName: "The Fillmore",
  city: "San Francisco",
  country: "US",
  date: "2026-06-13",
  artistName: "Wednesday",
};

describe("requireUser", () => {
  it("returns the session user when signed in", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", handle: "dylan" } });
    await expect(requireUser()).resolves.toMatchObject({ id: "u1" });
  });

  it("throws when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow(/not signed in/i);
  });

  it("throws when the session exists but carries no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(requireUser()).rejects.toThrow(/not signed in/i);
  });
});

describe("requireOwner", () => {
  it("returns the attendance when the caller owns it", async () => {
    const owner = await createTestUser("owner");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: owner.id, handle: "owner" } });

    await expect(requireOwner(logged.attendanceId)).resolves.toMatchObject({
      id: logged.attendanceId,
    });
  });

  it("refuses when a different signed-in user owns it", async () => {
    const owner = await createTestUser("owner");
    const attacker = await createTestUser("attacker");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: attacker.id, handle: "attacker" } });

    await expect(requireOwner(logged.attendanceId)).rejects.toThrow(/not allowed/i);
  });

  it("refuses for an attendance that does not exist", async () => {
    const user = await createTestUser("dylan");
    mockAuth.mockResolvedValue({ user: { id: user.id, handle: "dylan" } });

    await expect(requireOwner("does-not-exist")).rejects.toThrow(/not allowed/i);
  });

  it("does not reveal whether a stranger's attendance exists", async () => {
    const owner = await createTestUser("owner");
    const attacker = await createTestUser("attacker");
    const logged = await logShow({ ...show, userId: owner.id });
    mockAuth.mockResolvedValue({ user: { id: attacker.id, handle: "attacker" } });

    const real = await requireOwner(logged.attendanceId).catch((e: Error) => e.message);
    const fake = await requireOwner("does-not-exist").catch((e: Error) => e.message);

    expect(real).toBe(fake);
  });
});
```

- [ ] **Step 4: Run and confirm it fails**

Run: `npm test tests/lib/authz.test.ts`
Expected: FAIL, cannot resolve `@/lib/authz`.

- [ ] **Step 5: Implement**

Create `src/lib/authz.ts`:

```ts
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

export class NotAllowedError extends Error {
  constructor() {
    // Deliberately identical whether the row is missing or owned by someone
    // else. A distinct "not found" message would let anyone probe which
    // attendance ids exist.
    super("Not allowed");
    this.name = "NotAllowedError";
  }
}

export async function requireUser(): Promise<{ id: string; handle: string | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new NotSignedInError();
  return { id: session.user.id, handle: session.user.handle ?? null };
}

/**
 * Resolves an attendance and proves the caller owns it. Every mutation on a
 * user's own content goes through here (spec 6.2), so ownership is enforced in
 * exactly one auditable place.
 */
export async function requireOwner(attendanceId: string) {
  const user = await requireUser();

  const attendance = await prisma.attendance.findUnique({
    where: { id: attendanceId },
  });

  if (!attendance || attendance.userId !== user.id) throw new NotAllowedError();

  return attendance;
}
```

- [ ] **Step 6: Run and confirm it passes**

Run: `npm test tests/lib/authz.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add Auth.js configuration and ownership helpers"
```

---

### Task 8: Handle onboarding

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`
- Create: `src/app/login/page.tsx`
- Test: `tests/app/onboarding.test.ts`

**Interfaces:**
- Consumes: `handleSchema` (Task 6), `requireUser` (Task 7), `prisma` (Task 2)
- Produces: `claimHandle(formData: FormData): Promise<{ error: string } | never>`

A new user has `handle: null` until they choose one. Until then they have no profile URL, so they are redirected here.

- [ ] **Step 1: Write the failing test**

Create `tests/app/onboarding.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));

const { claimHandleFor } = await import("@/app/onboarding/actions");

beforeEach(async () => {
  await resetDb();
  mockAuth.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function newUser(email: string) {
  return prisma.user.create({ data: { email, handle: null } });
}

describe("claimHandleFor", () => {
  it("sets the handle on the user", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "dylan");

    expect(result).toEqual({ ok: true, handle: "dylan" });
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.handle).toBe("dylan");
  });

  it("normalizes case so the stored handle is lowercase", async () => {
    const user = await newUser("a@example.test");
    await claimHandleFor(user.id, "Dylan");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.handle).toBe("dylan");
  });

  it("rejects an invalid handle with a readable message", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "no");

    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/at least 3/i);
  });

  it("rejects a reserved handle", async () => {
    const user = await newUser("a@example.test");

    const result = await claimHandleFor(user.id, "settings");

    expect((result as { error: string }).error).toMatch(/reserved/i);
  });

  it("rejects a handle already taken, without leaving the user handleless", async () => {
    const taken = await newUser("a@example.test");
    await claimHandleFor(taken.id, "dylan");
    const second = await newUser("b@example.test");

    const result = await claimHandleFor(second.id, "dylan");

    expect((result as { error: string }).error).toMatch(/taken/i);
    const stillNull = await prisma.user.findUniqueOrThrow({ where: { id: second.id } });
    expect(stillNull.handle).toBeNull();
  });

  it("treats a differently-cased duplicate as taken", async () => {
    const first = await newUser("a@example.test");
    await claimHandleFor(first.id, "dylan");
    const second = await newUser("b@example.test");

    const result = await claimHandleFor(second.id, "DYLAN");

    expect((result as { error: string }).error).toMatch(/taken/i);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/app/onboarding.test.ts`
Expected: FAIL, cannot resolve the actions module.

- [ ] **Step 3: Implement the action**

Create `src/app/onboarding/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { handleSchema } from "@/lib/handle";
import { requireUser } from "@/lib/authz";

export type ClaimResult = { ok: true; handle: string } | { ok: false; error: string };

/**
 * Testable core. Separated from the form action so tests do not have to
 * simulate a FormData round trip.
 */
export async function claimHandleFor(userId: string, raw: string): Promise<ClaimResult> {
  const parsed = handleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const handle = parsed.data;

  const existing = await prisma.user.findUnique({ where: { handle } });
  if (existing && existing.id !== userId) {
    return { ok: false, error: "That handle is already taken" };
  }

  try {
    await prisma.user.update({ where: { id: userId }, data: { handle } });
  } catch (error) {
    // Lost a race against a concurrent claim of the same handle.
    if ((error as { code?: string }).code === "P2002") {
      return { ok: false, error: "That handle is already taken" };
    }
    throw error;
  }

  return { ok: true, handle };
}

export async function claimHandle(
  _prev: ClaimResult | null,
  formData: FormData,
): Promise<ClaimResult> {
  const user = await requireUser();
  const result = await claimHandleFor(user.id, String(formData.get("handle") ?? ""));

  if (result.ok) redirect(`/u/${result.handle}`);
  return result;
}
```

- [ ] **Step 4: Implement the pages**

Create `src/app/onboarding/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { claimHandle, type ClaimResult } from "./actions";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState<ClaimResult | null, FormData>(
    claimHandle,
    null,
  );

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Pick your handle</h1>
      <p>This is your profile address, for example concerttracker.app/u/dylan.</p>

      <form action={action}>
        <label htmlFor="handle">Handle</label>
        <input id="handle" name="handle" required autoComplete="off" />
        <button type="submit" disabled={pending}>
          {pending ? "Saving" : "Continue"}
        </button>
      </form>

      {state && !state.ok && <p role="alert">{state.error}</p>}
    </main>
  );
}
```

Create `src/app/login/page.tsx`:

```tsx
import { signIn } from "@/auth";

export default function LoginPage() {
  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Sign in</h1>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/onboarding" });
        }}
      >
        <button type="submit">Continue with Google</button>
      </form>

      <form
        action={async (formData: FormData) => {
          "use server";
          await signIn("nodemailer", {
            email: String(formData.get("email") ?? ""),
            redirectTo: "/onboarding",
          });
        }}
      >
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <button type="submit">Email me a link</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npm test tests/app/onboarding.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add sign in and handle onboarding"
```

---

### Task 9: Manual show entry

**Files:**
- Create: `src/app/add/page.tsx`, `src/app/add/actions.ts`
- Test: `tests/app/add-show.test.ts`

**Interfaces:**
- Consumes: `logShow` (Task 4), `requireUser` (Task 7)
- Produces: `addShowSchema`, `submitShow(input: unknown, userId: string)`

- [ ] **Step 1: Write the failing test**

Create `tests/app/add-show.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { submitShow, addShowSchema } = await import("@/app/add/actions");

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const valid = {
  artistName: "Wednesday",
  venueName: "The Fillmore",
  city: "San Francisco",
  state: "CA",
  country: "US",
  date: "2026-06-13",
  notes: "",
  attendedWith: "",
  setlist: "",
};

describe("addShowSchema", () => {
  it("accepts a complete valid entry", () => {
    expect(addShowSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["artistName", ""],
    ["venueName", ""],
    ["city", ""],
    ["country", ""],
    ["date", "13-06-2026"],
    ["date", "not-a-date"],
  ])("rejects %s = %s", (field, value) => {
    const result = addShowSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
  });

  it("rejects a rating outside 1 to 5", () => {
    expect(addShowSchema.safeParse({ ...valid, rating: 9 }).success).toBe(false);
  });

  it("rejects a date in the future, since you cannot have attended it yet", () => {
    const result = addShowSchema.safeParse({ ...valid, date: "2099-01-01" });
    expect(result.success).toBe(false);
  });
});

describe("submitShow", () => {
  it("logs the show and returns the new attendance", async () => {
    const user = await createTestUser("dylan");

    const result = await submitShow(valid, user.id);

    expect(result.ok).toBe(true);
    expect(await prisma.attendance.count({ where: { userId: user.id } })).toBe(1);
  });

  it("splits a pasted setlist on newlines", async () => {
    const user = await createTestUser("dylan");

    await submitShow(
      { ...valid, setlist: "Bull Believer\nChosen to Deserve\n\nBath County" },
      user.id,
    );

    expect(await prisma.setlistSong.count()).toBe(3);
  });

  it("returns a field error rather than throwing on invalid input", async () => {
    const user = await createTestUser("dylan");

    const result = await submitShow({ ...valid, artistName: "" }, user.id);

    expect(result.ok).toBe(false);
    expect(await prisma.attendance.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/app/add-show.test.ts`
Expected: FAIL, cannot resolve the actions module.

- [ ] **Step 3: Implement the action**

Create `src/app/add/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { logShow } from "@/domain/log-show";
import { requireUser } from "@/lib/authz";

const today = () => new Date().toISOString().slice(0, 10);

export const addShowSchema = z.object({
  artistName: z.string().trim().min(1, "Artist is required").max(200),
  venueName: z.string().trim().min(1, "Venue is required").max(200),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.string().trim().max(120).optional().or(z.literal("")),
  country: z.string().trim().min(1, "Country is required").max(120),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker, format yyyy-MM-dd")
    .refine((d) => d <= today(), "You cannot log a show that has not happened yet"),
  eventName: z.string().trim().max(200).optional().or(z.literal("")),
  festivalName: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(5000).optional().or(z.literal("")),
  attendedWith: z.string().trim().max(500).optional().or(z.literal("")),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  setlist: z.string().max(20000).optional().or(z.literal("")),
});

export type AddShowResult =
  | { ok: true; attendanceId: string }
  | { ok: false; error: string };

/**
 * Testable core: takes plain input and an explicit user id.
 */
export async function submitShow(input: unknown, userId: string): Promise<AddShowResult> {
  const parsed = addShowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const v = parsed.data;

  const result = await logShow({
    userId,
    artistName: v.artistName,
    venueName: v.venueName,
    city: v.city,
    state: v.state || null,
    country: v.country,
    date: v.date,
    eventName: v.eventName || null,
    festivalName: v.festivalName || null,
    notes: v.notes || null,
    rating: v.rating ?? null,
    attendedWith: v.attendedWith || null,
    songs: (v.setlist ?? "").split("\n"),
  });

  return { ok: true, attendanceId: result.attendanceId };
}

export async function addShow(
  _prev: AddShowResult | null,
  formData: FormData,
): Promise<AddShowResult> {
  const user = await requireUser();

  const result = await submitShow(Object.fromEntries(formData), user.id);

  if (result.ok) {
    revalidatePath(`/u/${user.handle}`);
    redirect(`/u/${user.handle}/shows/${result.attendanceId}`);
  }

  return result;
}
```

- [ ] **Step 4: Implement the form**

Create `src/app/add/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { addShow, type AddShowResult } from "./actions";

export default function AddShowPage() {
  const [state, action, pending] = useActionState<AddShowResult | null, FormData>(
    addShow,
    null,
  );

  return (
    <main style={{ maxWidth: 560, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Log a show</h1>

      <form action={action}>
        <label htmlFor="artistName">Artist</label>
        <input id="artistName" name="artistName" required />

        <label htmlFor="venueName">Venue</label>
        <input id="venueName" name="venueName" required />

        <label htmlFor="city">City</label>
        <input id="city" name="city" required />

        <label htmlFor="state">State or region</label>
        <input id="state" name="state" />

        <label htmlFor="country">Country</label>
        <input id="country" name="country" required defaultValue="US" />

        <label htmlFor="date">Date</label>
        <input id="date" name="date" type="date" required />

        <label htmlFor="eventName">Event name (festivals only)</label>
        <input id="eventName" name="eventName" placeholder="Bonnaroo 2026, Day 2" />

        <label htmlFor="attendedWith">Who you went with</label>
        <input id="attendedWith" name="attendedWith" />

        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={4} />

        <label htmlFor="setlist">Setlist, one song per line (optional)</label>
        <textarea id="setlist" name="setlist" rows={8} />

        <button type="submit" disabled={pending}>
          {pending ? "Saving" : "Log this show"}
        </button>
      </form>

      {state && !state.ok && <p role="alert">{state.error}</p>}
    </main>
  );
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npm test tests/app/add-show.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add manual show entry form and validated server action"
```

---

### Task 10: Public profile, attendance, and event pages

**Files:**
- Create: `src/app/u/[handle]/page.tsx`
- Create: `src/app/u/[handle]/shows/[id]/page.tsx`
- Create: `src/app/events/[id]/page.tsx`
- Create: `src/app/events/[id]/actions.ts`
- Create: `src/queries/profile.ts`
- Test: `tests/queries/profile.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `describeAttendance` (Task 5), `attendPerformance` (Task 4)
- Produces: `getProfile(handle: string)`, `getAttendance(id: string)`, `getEvent(id: string)`

- [ ] **Step 1: Write the failing query test**

Create `tests/queries/profile.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, createTestUser } from "../helpers/db";
import { logShow } from "@/domain/log-show";
import { getProfile, getEvent } from "@/queries/profile";

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

const base = {
  venueName: "The Fillmore",
  city: "San Francisco",
  country: "US",
  date: "2026-06-13",
};

describe("getProfile", () => {
  it("returns null for an unknown handle", async () => {
    expect(await getProfile("nobody")).toBeNull();
    });

  it("lists the user's shows with the acts they attended", async () => {
    const user = await createTestUser("dylan");
    await logShow({ ...base, userId: user.id, artistName: "Wednesday" });

    const profile = await getProfile("dylan");

    expect(profile).not.toBeNull();
    expect(profile!.shows).toHaveLength(1);
    expect(profile!.shows[0].attendedArtistNames).toEqual(["Wednesday"]);
    expect(profile!.shows[0].lineupSize).toBe(1);
  });

  it("reports the full lineup size while listing only the acts the user caught", async () => {
    const dylan = await createTestUser("dylan");
    const other = await createTestUser("other");

    await logShow({ ...base, userId: dylan.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: other.id, artistName: "MJ Lenderman" });

    const profile = await getProfile("dylan");

    expect(profile!.shows[0].attendedArtistNames).toEqual(["Wednesday"]);
    expect(profile!.shows[0].lineupSize).toBe(2);
  });

  it("orders shows most recent first", async () => {
    const user = await createTestUser("dylan");
    await logShow({ ...base, userId: user.id, artistName: "Older", date: "2025-01-01" });
    await logShow({ ...base, userId: user.id, artistName: "Newer", date: "2026-01-01" });

    const profile = await getProfile("dylan");

    expect(profile!.shows.map((s) => s.date.toISOString().slice(0, 10))).toEqual([
      "2026-01-01",
      "2025-01-01",
    ]);
  });

  it("does not leak another user's shows onto this profile", async () => {
    const dylan = await createTestUser("dylan");
    const other = await createTestUser("other");
    await logShow({ ...base, userId: other.id, artistName: "Wednesday" });

    const profile = await getProfile("dylan");
    expect(profile!.shows).toHaveLength(0);
  });
});

describe("getEvent", () => {
  it("returns the full lineup and every attendee", async () => {
    const a = await createTestUser("a");
    const b = await createTestUser("b");

    const first = await logShow({ ...base, userId: a.id, artistName: "Wednesday" });
    await logShow({ ...base, userId: b.id, artistName: "MJ Lenderman" });

    const event = await getEvent(first.eventId);

    expect(event!.performances.map((p) => p.artistName).sort()).toEqual([
      "MJ Lenderman",
      "Wednesday",
    ]);
    expect(event!.attendees.map((u) => u.handle).sort()).toEqual(["a", "b"]);
  });

  it("returns null for an unknown event", async () => {
    expect(await getEvent("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npm test tests/queries/profile.test.ts`
Expected: FAIL, cannot resolve `@/queries/profile`.

- [ ] **Step 3: Implement the queries**

Create `src/queries/profile.ts`:

```ts
import { prisma } from "@/lib/db";

export async function getProfile(handle: string) {
  const user = await prisma.user.findUnique({
    where: { handle },
    select: { id: true, handle: true, name: true, image: true, bio: true, createdAt: true },
  });

  if (!user) return null;

  const attendances = await prisma.attendance.findMany({
    where: { userId: user.id },
    orderBy: [{ event: { date: "desc" } }, { createdAt: "desc" }],
    select: {
      id: true,
      notes: true,
      rating: true,
      event: {
        select: {
          id: true,
          date: true,
          name: true,
          festivalName: true,
          venue: { select: { name: true, city: true } },
          _count: { select: { performances: true } },
        },
      },
      attended: {
        select: {
          performance: {
            select: { id: true, setOrder: true, artist: { select: { name: true } } },
          },
        },
      },
    },
  });

  const shows = attendances.map((a) => ({
    attendanceId: a.id,
    eventId: a.event.id,
    date: a.event.date,
    eventName: a.event.name,
    festivalName: a.event.festivalName,
    venueName: a.event.venue.name,
    city: a.event.venue.city,
    rating: a.rating,
    lineupSize: a.event._count.performances,
    attendedArtistNames: a.attended
      .slice()
      .sort((x, y) => (x.performance.setOrder ?? 0) - (y.performance.setOrder ?? 0))
      .map((ap) => ap.performance.artist.name),
  }));

  return { user, shows };
}

export async function getAttendance(id: string) {
  const attendance = await prisma.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      notes: true,
      rating: true,
      attendedWith: true,
      user: { select: { handle: true, name: true } },
      event: {
        select: {
          id: true,
          date: true,
          name: true,
          festivalName: true,
          venue: { select: { name: true, city: true, state: true, country: true } },
          _count: { select: { performances: true } },
        },
      },
      attended: {
        select: {
          performance: {
            select: {
              id: true,
              artist: { select: { name: true } },
              songs: { orderBy: { position: "asc" }, select: { name: true, encore: true } },
            },
          },
        },
      },
    },
  });

  return attendance;
}

export async function getEvent(id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      date: true,
      name: true,
      festivalName: true,
      venue: { select: { name: true, city: true, state: true, country: true } },
      performances: {
        orderBy: [{ setOrder: "asc" }],
        select: {
          id: true,
          billing: true,
          artist: { select: { id: true, name: true } },
          _count: { select: { songs: true } },
        },
      },
      attendances: {
        select: { user: { select: { handle: true, name: true, image: true } } },
      },
    },
  });

  if (!event) return null;

  return {
    ...event,
    performances: event.performances.map((p) => ({
      id: p.id,
      billing: p.billing,
      artistId: p.artist.id,
      artistName: p.artist.name,
      songCount: p._count.songs,
    })),
    attendees: event.attendances.map((a) => a.user),
  };
}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npm test tests/queries/profile.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Implement the profile page**

Create `src/app/u/[handle]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/queries/profile";
import { describeAttendance } from "@/domain/describe-attendance";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const profile = await getProfile(handle);

  if (!profile) notFound();

  return (
    <main style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>{profile.user.name ?? profile.user.handle}</h1>
      <p>@{profile.user.handle}</p>
      {profile.user.bio && <p>{profile.user.bio}</p>}

      <h2>
        {profile.shows.length} {profile.shows.length === 1 ? "show" : "shows"}
      </h2>

      {profile.shows.length === 0 && <p>No shows logged yet.</p>}

      <ul>
        {profile.shows.map((show) => {
          const described = describeAttendance(show);
          return (
            <li key={show.attendanceId}>
              <Link href={`/u/${profile.user.handle}/shows/${show.attendanceId}`}>
                {described.title}
              </Link>
              <div>{described.subtitle}</div>
              <time dateTime={show.date.toISOString()}>
                {show.date.toISOString().slice(0, 10)}
              </time>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Implement the attendance page**

Create `src/app/u/[handle]/shows/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttendance } from "@/queries/profile";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const attendance = await getAttendance(id);

  // The handle is part of the URL, so a mismatched pair must 404 rather than
  // render someone else's night under this user's address.
  if (!attendance || attendance.user.handle !== handle) notFound();

  const { event } = attendance;

  return (
    <main style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
      <p>
        <Link href={`/u/${handle}`}>@{handle}</Link>
      </p>

      <h1>{event.name ?? event.venue.name}</h1>
      <p>
        {event.venue.name}, {event.venue.city}
        {event.venue.state ? `, ${event.venue.state}` : ""}
      </p>
      <time dateTime={event.date.toISOString()}>{event.date.toISOString().slice(0, 10)}</time>

      <p>
        <Link href={`/events/${event.id}`}>
          See the full lineup and everyone who was there
        </Link>
      </p>

      {attendance.notes && (
        <section>
          <h2>Notes</h2>
          <p>{attendance.notes}</p>
        </section>
      )}

      {attendance.attendedWith && <p>Went with {attendance.attendedWith}</p>}
      {attendance.rating !== null && <p>Rated {attendance.rating} out of 5</p>}

      <h2>Acts seen</h2>
      {attendance.attended.map(({ performance }) => (
        <section key={performance.id}>
          <h3>{performance.artist.name}</h3>
          {performance.songs.length === 0 ? (
            <p>No setlist yet.</p>
          ) : (
            <ol>
              {performance.songs.map((song, i) => (
                <li key={i}>{song.name}</li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 7: Implement the event page and its lineup action**

Create `src/app/events/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { attendPerformance } from "@/domain/log-show";
import { requireUser } from "@/lib/authz";

const schema = z.object({ performanceId: z.string().min(1), eventId: z.string().min(1) });

export async function markAttended(formData: FormData) {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;

  await attendPerformance(user.id, parsed.data.performanceId);
  revalidatePath(`/events/${parsed.data.eventId}`);
  if (user.handle) revalidatePath(`/u/${user.handle}`);
}
```

Create `src/app/events/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getEvent } from "@/queries/profile";
import { markAttended } from "./actions";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [event, session] = await Promise.all([getEvent(id), auth()]);

  if (!event) notFound();

  return (
    <main style={{ maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>{event.name ?? event.venue.name}</h1>
      <p>
        {event.venue.name}, {event.venue.city}
      </p>
      <time dateTime={event.date.toISOString()}>{event.date.toISOString().slice(0, 10)}</time>

      <h2>Lineup</h2>
      <ul>
        {event.performances.map((p) => (
          <li key={p.id}>
            {p.artistName}
            {p.songCount > 0 && ` (${p.songCount} songs)`}
            {session?.user?.id && (
              <form action={markAttended}>
                <input type="hidden" name="performanceId" value={p.id} />
                <input type="hidden" name="eventId" value={event.id} />
                <button type="submit">I saw this set</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <h2>
        {event.attendees.length} {event.attendees.length === 1 ? "person was" : "people were"} here
      </h2>
      <ul>
        {event.attendees.map((u) => (
          <li key={u.handle}>
            <Link href={`/u/${u.handle}`}>@{u.handle}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, all tests.

Also run `npm run build` and confirm it compiles with no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add public profile, attendance and event pages"
```

---

### Task 11: End-to-end coverage of the festival path

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/festival.spec.ts`
- Create: `e2e/helpers/auth.ts`
- Modify: `package.json` (add `test:e2e` script)

**Interfaces:**
- Consumes: the running app
- Produces: `npm run test:e2e`

This covers spec section 9's third end-to-end flow, the one with the most ways to fail silently.

- [ ] **Step 1: Install the browser**

```bash
npx playwright install chromium
```

- [ ] **Step 2: Add the config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

Add to `package.json` scripts: `"test:e2e": "playwright test"`.

- [ ] **Step 3: Add a session helper**

Real OAuth cannot run in CI, so the helper seeds a user and a session row directly and sets the session cookie, which exercises the same database session strategy the app uses.

Create `e2e/helpers/auth.ts`:

```ts
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { Page } from "@playwright/test";

const prisma = new PrismaClient();

export async function signInAs(page: Page, handle: string) {
  const user = await prisma.user.upsert({
    where: { email: `${handle}@example.test` },
    create: { email: `${handle}@example.test`, handle, name: handle },
    update: {},
  });

  const sessionToken = randomUUID();
  await prisma.session.create({
    data: {
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: sessionToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  return user;
}

export { prisma };
```

If the cookie name differs in this Auth.js beta, read it from a real signed-in browser session and update the constant.

- [ ] **Step 4: Write the end-to-end test**

Create `e2e/festival.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { signInAs, prisma } from "./helpers/auth";

test.beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AttendedPerformance", "Attendance", "SetlistSong",
      "Performance", "Event", "Venue", "Artist",
      "Session", "Account", "VerificationToken", "User"
    RESTART IDENTITY CASCADE;
  `);
});

async function logShowViaUi(page: import("@playwright/test").Page, artist: string) {
  await page.goto("/add");
  await page.getByLabel("Artist").fill(artist);
  await page.getByLabel("Venue").fill("The Fillmore");
  await page.getByLabel("City").fill("San Francisco");
  await page.getByLabel("Country").fill("US");
  await page.getByLabel("Date").fill("2026-06-13");
  await page.getByRole("button", { name: "Log this show" }).click();
  await page.waitForURL(/\/u\/.+\/shows\/.+/);
}

test("two users logging different acts share one event, and stats count only ticked sets", async ({
  browser,
}) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await signInAs(pageA, "alpha");
  await logShowViaUi(pageA, "Wednesday");

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signInAs(pageB, "beta");
  await logShowViaUi(pageB, "MJ Lenderman");

  // Exactly one event exists for that venue and date.
  expect(await prisma.event.count()).toBe(1);
  expect(await prisma.performance.count()).toBe(2);

  // The event page shows both acts and both attendees.
  const eventId = (await prisma.event.findFirstOrThrow()).id;
  await pageB.goto(`/events/${eventId}`);
  await expect(pageB.getByText("Wednesday")).toBeVisible();
  await expect(pageB.getByText("MJ Lenderman")).toBeVisible();
  await expect(pageB.getByText("@alpha")).toBeVisible();

  // Beta ticks the act they did not log, and now has two attended sets.
  const wednesdayPerformance = await prisma.performance.findFirstOrThrow({
    where: { artist: { nameKey: "wednesday" } },
  });
  await pageB
    .locator(`form:has(input[value="${wednesdayPerformance.id}"]) button`)
    .click();

  const beta = await prisma.user.findUniqueOrThrow({ where: { handle: "beta" } });
  const betaAttendance = await prisma.attendance.findFirstOrThrow({
    where: { userId: beta.id },
    include: { attended: true },
  });
  expect(betaAttendance.attended).toHaveLength(2);

  // Alpha still has only the one set they actually marked.
  const alpha = await prisma.user.findUniqueOrThrow({ where: { handle: "alpha" } });
  const alphaAttendance = await prisma.attendance.findFirstOrThrow({
    where: { userId: alpha.id },
    include: { attended: true },
  });
  expect(alphaAttendance.attended).toHaveLength(1);

  await contextA.close();
  await contextB.close();
});

test("a signed-out visitor can read a public profile", async ({ page, browser }) => {
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await signInAs(ownerPage, "alpha");
  await logShowViaUi(ownerPage, "Wednesday");
  await owner.close();

  await page.goto("/u/alpha");
  await expect(page.getByRole("heading", { name: "alpha" })).toBeVisible();
  await expect(page.getByText("Wednesday")).toBeVisible();
});
```

- [ ] **Step 5: Run the end-to-end tests**

Run: `npm run test:e2e`
Expected: PASS, 2 tests.

These run against the development database. Stop and re-seed if the dev data matters to you; the truncate in `beforeEach` deletes it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add end-to-end coverage for the festival and public profile flows"
```

---

## Phase 1 Done Criteria

- [ ] `npm test` passes with no skipped tests
- [ ] `npm run test:e2e` passes
- [ ] `npm run build` compiles with no type errors
- [ ] A user can sign in, claim a handle, log a show, and see it at `/u/<handle>`
- [ ] Two users logging different acts on the same night at the same venue produce exactly one Event with two Performances
- [ ] A signed-out visitor can read any profile and event page

## Notes For The Executor

- **Auth.js v5 is a beta.** Its exports and cookie names have moved between beta releases. If `signIn`, `handlers`, or the session cookie name behave differently from what is written here, check the version's own docs and adapt. The rest of the plan does not depend on those details.
- **Do not weaken a database constraint to make a test pass.** The four unique constraints in Task 2 are the model. If a test fails against them, the calling code is wrong.
- `logShow` is called by Phase 2's importer. Changing its signature means changing that plan too, so prefer adding optional fields over reshaping it.
