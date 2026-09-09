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
