import { z } from "zod";
import { logShow } from "@/domain/log-show";

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
 * Testable core: takes plain input and an explicit user id, which is why it
 * lives here rather than in the server action module.
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
