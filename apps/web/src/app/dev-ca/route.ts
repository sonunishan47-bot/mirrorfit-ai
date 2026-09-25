import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Serves the public local-dev CA only. The private key never leaves `.certs/`.
 *
 * Production returns 404. This exists so an iPhone can install the CA from
 * the same LAN HTTPS origin used for `/s`, without guessing a Windows path.
 */
export async function GET(): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const cert = await readFile(join(process.cwd(), '.certs', 'dev-ca.crt'));
    return new NextResponse(cert, {
      headers: {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'inline; filename="mirrorfit-dev-ca.crt"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
