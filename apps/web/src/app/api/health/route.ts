import { PROTOCOL_VERSION } from '@mirrorfit/protocol';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness probe.
 *
 * Deliberately reports nothing about configuration or dependencies: an
 * unauthenticated endpoint that confirms which environment variables are set
 * is a reconnaissance aid. Dependency health belongs behind staff auth in the
 * Phase 13 dashboard.
 */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    protocol_version: PROTOCOL_VERSION,
  });
}
