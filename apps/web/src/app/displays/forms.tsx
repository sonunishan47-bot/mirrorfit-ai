'use client';

import { useActionState } from 'react';

import { createDisplay, issueEnrollmentCode, revokeCredential, type ActionResult } from './actions';

const IDLE: ActionResult = { ok: true };

const inputClass =
  'w-full rounded-sm border border-white/15 bg-black/30 px-3 py-2 text-sm text-primary outline-none focus:border-accent';

interface Shop {
  readonly id: string;
  readonly name: string;
}

export function CreateDisplayForm({ shops }: { shops: readonly Shop[] }) {
  const [state, action, pending] = useActionState(createDisplay, IDLE);

  if (shops.length === 0) {
    return (
      <p className="text-sm text-muted">
        No shops exist yet. A display belongs to a shop, so one has to be created first.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <label className="space-y-1.5 text-sm sm:col-span-1">
        <span className="block text-secondary">Shop</span>
        <select name="shop_id" required className={inputClass} defaultValue={shops[0]?.id}>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Name</span>
        <input
          name="name"
          required
          maxLength={200}
          placeholder="Front window mirror"
          className={inputClass}
        />
      </label>

      <label className="space-y-1.5 text-sm">
        <span className="block text-secondary">Slug</span>
        <input
          name="slug"
          required
          maxLength={64}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="front-window"
          className={inputClass}
        />
      </label>

      <div className="space-y-1.5">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-sm bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-strong disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Add display'}
        </button>
      </div>

      {state.message ? (
        <p
          role="status"
          className={`sm:col-span-4 text-sm ${state.ok ? 'text-success' : 'text-danger'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Issues a code and shows it once.
 *
 * The code lives in this component's state and nowhere else. There is no
 * route that can return it again, so the operator either uses it now or
 * issues another — which is the behaviour a single-use credential should
 * have.
 */
export function IssueCodeForm({ displayId }: { displayId: string }) {
  const [state, action, pending] = useActionState(issueEnrollmentCode, IDLE);

  return (
    <div className="space-y-2">
      <form action={action}>
        <input type="hidden" name="display_id" value={displayId} />
        <button
          type="submit"
          disabled={pending}
          className="rounded-sm border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
        >
          {pending ? 'Issuing…' : 'Issue enrollment code'}
        </button>
      </form>

      {state.enrollmentCode ? (
        <div className="rounded-sm border border-accent/40 bg-accent/5 p-3">
          <p className="text-xs uppercase tracking-widest text-muted">Enter this on the mirror</p>
          <p className="mt-1 font-mono text-2xl tracking-[0.2em] text-primary">
            {state.enrollmentCode}
          </p>
          <p className="mt-1 text-xs text-muted">
            Shown once. Expires{' '}
            {state.expiresAt ? new Date(state.expiresAt).toLocaleString() : 'shortly'}.
          </p>
        </div>
      ) : null}

      {state.message && !state.ok ? (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function RevokeCredentialForm({ credentialId }: { credentialId: string }) {
  const [state, action, pending] = useActionState(revokeCredential, IDLE);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="credential_id" value={credentialId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-danger underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {state.message && !state.ok ? (
        <span role="alert" className="ml-2 text-xs text-danger">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
