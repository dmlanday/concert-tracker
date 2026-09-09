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
