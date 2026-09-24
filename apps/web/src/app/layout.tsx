import type { Metadata, Viewport } from 'next';
import '@mirrorfit/ui/tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'MirrorFit AI',
  description: 'Retail smart-mirror virtual fitting platform.',
  // The kiosk and the customer phone UI are both private surfaces.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#08080a',
  // The phone UI is touch-first; zooming would break the fitting controls.
  width: 'device-width',
  initialScale: 1,
};

/**
 * TODO (Phase 8): `lang` and `dir` become per-request values once locale
 * routing lands, so Arabic renders RTL. Hardcoded until then rather than
 * faking a locale system that does not exist.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
