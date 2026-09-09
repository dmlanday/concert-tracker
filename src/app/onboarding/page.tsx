"use client";

import { useActionState } from "react";
import { claimHandle } from "./actions";
import type { ClaimResult } from "@/domain/claim-handle";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState<ClaimResult | null, FormData>(
    claimHandle,
    null,
  );

  return (
    <main style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1rem" }}>
      <h1>Pick your handle</h1>
      <p>This is your profile address, for example concerttracker.app/u/dylan.</p>

      <form action={action}>
        <label htmlFor="handle">Handle</label>
        <input id="handle" name="handle" required autoComplete="off" />
        <button type="submit" disabled={pending}>
          {pending ? "Saving" : "Continue"}
        </button>
      </form>

      {state && !state.ok && <p role="alert">{state.error}</p>}
    </main>
  );
}
