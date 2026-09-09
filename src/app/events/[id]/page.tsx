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
