/**
 * Branded screensaver overlay for kiosk power-save mode.
 * Does not invent a session or pairing token — callers pass the QR SVG when available.
 */
export function KioskScreensaver({
  qrSvg,
  showQr,
  onWake,
  activeSession,
}: {
  qrSvg: string | null;
  showQr: boolean;
  onWake: () => void;
  activeSession: boolean;
}) {
  return (
    <button
      type="button"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-base/95 px-10 text-center"
      data-testid="kiosk-screensaver"
      aria-label="Kiosk idle. Tap to wake."
      onClick={onWake}
    >
      <p className="text-xs uppercase tracking-[0.4em] text-accent">MirrorFit AI</p>
      <h2 className="text-5xl font-light tracking-[0.2em] text-primary sm:text-6xl">
        {activeSession ? 'Still here' : 'Scan QR to Try On'}
      </h2>
      <p className="max-w-md text-lg font-light text-secondary">
        {activeSession
          ? 'Tap to resume the camera try-on. Your phone session is still open.'
          : 'Scan the code with your phone to start. Pose processing is paused to save power.'}
      </p>

      {showQr ? (
        qrSvg ? (
          <div
            className="size-52 overflow-hidden rounded-lg bg-white p-3"
            data-testid="screensaver-qr"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <div className="glass flex size-52 flex-col items-center justify-center rounded-lg px-4">
            <span className="text-sm text-secondary">Waiting for a pairing QR…</span>
          </div>
        )
      ) : null}

      <p className="text-xs uppercase tracking-[0.3em] text-muted">Tap anywhere to wake</p>
    </button>
  );
}
