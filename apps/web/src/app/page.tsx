import Link from 'next/link';

import { PROTOCOL_VERSION } from '@mirrorfit/protocol';

/**
 * Staff entry. The mirror itself is /mirror. This page does not pretend the
 * kiosk is still unbuilt.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
        <h1 className="text-5xl font-light tracking-tight text-primary">MirrorFit AI</h1>
        <p className="max-w-xl text-balance text-secondary">
          The shop mirror pairs by QR. Shirts and pants track on the camera. Dress, abaya, kurta,
          churidar, and thobe use a pose silhouette. A photorealistic still is sent only after
          consent, and only if a GPU worker is connected. No image is invented.
        </p>
      </header>

      <nav className="flex flex-wrap gap-4 text-sm">
        <Link href="/mirror" className="text-accent underline-offset-2 hover:underline">
          Mirror
        </Link>
        <Link href="/login" className="text-accent underline-offset-2 hover:underline">
          Staff sign in
        </Link>
        <Link href="/catalog" className="text-accent underline-offset-2 hover:underline">
          Catalog
        </Link>
        <Link href="/displays" className="text-accent underline-offset-2 hover:underline">
          Displays
        </Link>
        <Link href="/ops" className="text-accent underline-offset-2 hover:underline">
          Operations
        </Link>
      </nav>

      <p className="text-xs text-muted">Protocol version {PROTOCOL_VERSION}.</p>
    </main>
  );
}
