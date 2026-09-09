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
