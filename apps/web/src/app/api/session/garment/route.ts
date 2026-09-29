import { NextResponse } from 'next/server';

import { parseJsonBody, selectedGarmentSchema } from '@mirrorfit/validation';
import { z } from 'zod';

import { clientError } from '@/lib/api/errors';
import { parsePairingBearer, resolveClaimedSession } from '@/lib/session/pairing-auth';
import {
  readSelectedGarment,
  resolveShopGarment,
  sessionCanMutateGarment,
  writeSelectedGarment,
} from '@/lib/session/session-garment';

export const dynamic = 'force-dynamic';

const clearOrSelectSchema = z.union([
  selectedGarmentSchema,
  z.object({ garment_id: z.null(), variant_id: z.null() }),
]);

export async function GET(request: Request): Promise<NextResponse> {
  const token = parsePairingBearer(request);
  if (!token) {
    return clientError('INVALID_TOKEN');
  }
  const session = await resolveClaimedSession(token);
  if (!session) {
    return clientError('INVALID_TOKEN');
  }
  const selected = await readSelectedGarment(session.sessionId);
  return NextResponse.json({ selected }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const token = parsePairingBearer(request);
  if (!token) {
    return clientError('INVALID_TOKEN');
  }
  const session = await resolveClaimedSession(token);
  if (!session || !sessionCanMutateGarment(session.status)) {
    return clientError('INVALID_TOKEN');
  }

  const parsed = await parseJsonBody(clearOrSelectSchema, request);
  if (!parsed.ok) {
    return clientError('INVALID_REQUEST');
  }

  const selection =
    parsed.data.garment_id === null
      ? null
      : {
          garment_id: parsed.data.garment_id,
          variant_id: parsed.data.variant_id,
          ...('category' in parsed.data && parsed.data.category
            ? { category: parsed.data.category }
            : {}),
          ...('size_label' in parsed.data && parsed.data.size_label
            ? { size_label: parsed.data.size_label }
            : {}),
        };

  let persisted = selection;
  if (selection) {
    const resolved = await resolveShopGarment(session, selection);
    if (!resolved) {
      return clientError('INVALID_REQUEST');
    }
    persisted = resolved;
  }

  const written = await writeSelectedGarment(session, persisted);
  if (!written) {
    return clientError('INTERNAL');
  }

  return NextResponse.json({ selected: persisted }, { headers: { 'Cache-Control': 'no-store' } });
}
