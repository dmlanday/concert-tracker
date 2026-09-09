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
