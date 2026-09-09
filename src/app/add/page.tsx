"use client";

import { useActionState } from "react";
import { addShow } from "./actions";
import type { AddShowResult } from "@/domain/submit-show";

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
