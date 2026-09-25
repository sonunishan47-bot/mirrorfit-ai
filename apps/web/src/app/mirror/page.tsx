import { KioskShell } from './kiosk-shell';

export const metadata = {
  title: 'Mirror — MirrorFit AI',
};

export const dynamic = 'force-dynamic';

/**
 * In-store kiosk surface.
 *
 * Public on purpose: the mirror is not a staff user. Device credentials and
 * session tokens, when they are wired to this screen, are how it authenticates
 * — not a login cookie. See `PUBLIC_PATHS`.
 */
export default function MirrorPage() {
  return <KioskShell />;
}
