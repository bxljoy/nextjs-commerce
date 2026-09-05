"use client";

import clsx from "clsx";
import { useActionState } from "react";

type Result = { ok: boolean; message: string } | null;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Deliberately stores nothing, and says so.
 *
 * Validation and the response are real — what is missing is a destination for
 * the address. A form that silently drops input, or claims a subscription that
 * did not happen, would be worse than not having one.
 *
 * Kept as an async action taking FormData so that pointing it at a real
 * Server Action later is a one-line change.
 */
async function subscribe(
  _previous: Result,
  formData: FormData,
): Promise<Result> {
  // Honeypot: a field no human sees. Bots fill everything, so a value here
  // means a bot — accepted quietly rather than rejected, to avoid teaching it.
  if (String(formData.get("company") ?? "")) {
    return { ok: true, message: "Thanks for subscribing." };
  }

  const email = String(formData.get("email") ?? "").trim();

  if (!email) return { ok: false, message: "Enter an email address." };
  if (!EMAIL.test(email))
    return { ok: false, message: "That does not look like an email address." };

  return {
    ok: true,
    message: "Thanks — this is a demo storefront, so nothing was stored.",
  };
}

export default function NewsletterForm() {
  const [result, formAction, pending] = useActionState(subscribe, null);

  return (
    <div>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-black dark:text-white">
        Stay in touch
      </h3>
      <p className="mb-3 text-sm">New arrivals and occasional writing.</p>

      {/* noValidate: `type="email"` would otherwise block submission before
          the action runs, leaving the previous status message on screen and
          making the checks below unreachable. One validation path, not two.
          The type is kept for the mobile keyboard. */}
      <form action={formAction} noValidate className="flex flex-col gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-black placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-black dark:text-white"
        />

        {/* Honeypot — hidden from people, irresistible to bots. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Subscribing…" : "Subscribe"}
        </button>
      </form>

      <p
        aria-live="polite"
        role="status"
        className={clsx("mt-2 min-h-[2.5rem] text-xs", {
          "text-neutral-500 dark:text-neutral-400": result?.ok !== false,
          "text-red-600 dark:text-red-400": result?.ok === false,
        })}
      >
        {result?.message}
      </p>
    </div>
  );
}
