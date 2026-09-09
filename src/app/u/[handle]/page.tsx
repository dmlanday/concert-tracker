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
