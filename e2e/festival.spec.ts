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
  await expect
    .poll(async () => {
      const betaAttendance = await prisma.attendance.findFirstOrThrow({
        where: { userId: beta.id },
        include: { attended: true },
      });
      return betaAttendance.attended.length;
    })
    .toBe(2);

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
