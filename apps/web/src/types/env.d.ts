/**
 * Declares the environment variables this app reads.
 *
 * Without this, `process.env` is only an index signature, and the strict
 * `noPropertyAccessFromIndexSignature` setting rejects dot access. Bracket
 * access is not an option: Next inlines public variables by matching the
 * literal text `process.env.NEXT_PUBLIC_*`, so `process.env['...']` would
 * silently evaluate to `undefined` in the browser bundle.
 *
 * Declaring the keys here keeps dot access valid and gives autocomplete.
 * Values stay `string | undefined`; the Zod schemas in `src/env` remain the
 * only place that decides whether a variable is actually usable.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_SUPABASE_URL?: string;
    readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    readonly SUPABASE_SECRET_KEY?: string;
  }
}
