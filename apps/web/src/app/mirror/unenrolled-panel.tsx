'use client';

/**
 * Safe unenrolled kiosk. No credential is invented; staff must supply
 * a real enrollment code. Submit is a button click, not a native GET,
 * so a failed hydrate cannot put the code in the URL.
 */
export function UnenrolledPanel({
  error,
  onEnroll,
}: {
  error: string | null;
  onEnroll: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="glass w-full max-w-md space-y-6 rounded-lg p-8 text-left">
      <div className="space-y-2">
        <h1 className="text-3xl font-light tracking-tight">This mirror is not enrolled</h1>
        <p className="text-sm text-secondary">
          Enter the enrollment code from the staff Displays screen. A code is not invented here.
        </p>
      </div>
      <form
        className="space-y-4"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void onEnroll(new FormData(event.currentTarget));
        }}
      >
        <label className="block space-y-1.5 text-sm text-secondary">
          Enrollment code
          <input
            name="code"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-white/10 bg-base px-3 py-2 text-primary"
          />
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (form) void onEnroll(new FormData(form));
          }}
          className="rounded-md bg-accent px-4 py-2 text-sm text-accent-contrast"
        >
          Enroll this mirror
        </button>
      </form>
    </div>
  );
}
