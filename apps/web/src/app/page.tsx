import { PROTOCOL_VERSION, MESSAGE_TYPES } from '@mirrorfit/protocol';
import { PERFORMANCE_TARGETS } from '@mirrorfit/tryon-core';

/**
 * Foundation status page.
 *
 * Intentionally not a mock of the mirror or the phone UI. Those are built in
 * later phases; showing a convincing preview of software that does not exist
 * would misrepresent where the project stands.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35em] text-accent">Foundation</p>
        <h1 className="text-5xl font-light tracking-tight text-primary">MirrorFit AI</h1>
        <p className="max-w-xl text-balance text-secondary">
          Monorepo, type system and Supabase foundation are in place. The mirror kiosk, pairing flow
          and fitting pipeline are not yet implemented.
        </p>
      </header>

      <section className="glass rounded-lg p-6">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-muted">Wired up</h2>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-secondary">Protocol version</dt>
            <dd className="tabular-nums text-primary">{PROTOCOL_VERSION}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary">Message types</dt>
            <dd className="tabular-nums text-primary">{MESSAGE_TYPES.length}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary">Minimum frame rate</dt>
            <dd className="tabular-nums text-primary">{PERFORMANCE_TARGETS.minimumFps} FPS</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary">Garment swap p95</dt>
            <dd className="tabular-nums text-primary">{PERFORMANCE_TARGETS.garmentSwapP95Ms} ms</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted">Next</h2>
        <p className="text-secondary">
          Phase 2 — database schema, migrations and row level security.
        </p>
      </section>
    </main>
  );
}
