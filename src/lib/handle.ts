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
