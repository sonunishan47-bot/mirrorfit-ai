import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { authenticateDevice } from '@/lib/device/authenticate';
import { buildLucyEditPrompt, enqueueLucyJob, runLocalLucyEdit } from '@/lib/tryon/comfy-lucy';
import { readLucyVramProfile } from '@/lib/tryon/lucy-clip-config';
import { lucyOutfitPrompt, parseLucyDescription } from '@/lib/tryon/lucy-prompt';
import { readSelectedGarment } from '@/lib/session/session-garment';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * Enrolled mirror submits one webcam segment for local Lucy Edit Dev.
 * The phone cannot call this. No video is invented if ComfyUI does not answer.
 * Lucy Edit Dev weights are non-commercial. LUCY_EDIT_DEV=1 is the local switch.
 */

const MAX_CLIP_BYTES = 12_000_000;

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env['LUCY_EDIT_DEV'] !== '1') {
    return NextResponse.json({ error: 'LUCY_NOT_ENABLED' }, { status: 503 });
  }
  const device = await authenticateDevice(request);
  if (!device) return clientError('UNAUTHORIZED');

  const form = await request.formData().catch(() => null);
  if (!form) return clientError('INVALID_REQUEST');
  const sessionId = stringField(form.get('session_id'));
  const garmentId = stringField(form.get('garment_id'));
  const variantId = stringField(form.get('variant_id'));
  const durationMs = Number(stringField(form.get('duration_ms')));
  const clip = form.get('clip');
  if (!sessionId || !garmentId || !variantId || !(clip instanceof Blob)) {
    return clientError('INVALID_REQUEST');
  }
  if (clip.size < 1024 || clip.size > MAX_CLIP_BYTES) return clientError('INVALID_REQUEST');

  const admin = createSupabaseAdminClient();
  const session = await admin
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .eq('display_id', device.displayId)
    .maybeSingle();
  if (session.error || !session.data || session.data.status !== 'ACTIVE') {
    return clientError('INVALID_REQUEST');
  }
  const selected = await readSelectedGarment(sessionId);
  if (!selected || selected.garment_id !== garmentId || selected.variant_id !== variantId) {
    return clientError('INVALID_REQUEST');
  }
  const garment = await admin
    .from('garments')
    .select('name, category, description')
    .eq('id', garmentId)
    .maybeSingle();
  if (garment.error || !garment.data) return clientError('INVALID_REQUEST');

  const notes = parseLucyDescription(garment.data.description);
  const prompt = lucyOutfitPrompt({
    color: selected.color_name ?? 'selected',
    garment: garment.data.category || garment.data.name,
    fabricAndDetails: notes.fabricAndDetails,
    fit: notes.fit,
    extraPrompt: notes.extraPrompt,
  });
  const profile = readLucyVramProfile({
    LUCY_VRAM_PROFILE: process.env['LUCY_VRAM_PROFILE'],
  });
  const workflow = buildLucyEditPrompt({
    videoName: 'mirrorfit-clip.webm',
    prompt,
    profile,
    durationMs,
    unetName: process.env['LUCY_UNET_NAME']?.trim() || 'lucy-edit-1.1-dev-cui-fp16.safetensors',
  });
  if (!workflow) return clientError('INVALID_REQUEST');

  const baseUrl = process.env['COMFYUI_URL']?.trim() || 'http://127.0.0.1:8188';
  if (!comfyUrlAllowed(baseUrl)) {
    return NextResponse.json({ error: 'LUCY_NOT_CONNECTED' }, { status: 502 });
  }
  let bytes: Uint8Array | null = null;
  try {
    bytes = await enqueueLucyJob(() =>
      runLocalLucyEdit({
        baseUrl,
        clip,
        filename: 'mirrorfit-clip.webm',
        workflow,
      }),
    );
  } catch (error) {
    const full = error instanceof Error && error.message === 'QUEUE_FULL';
    if (full) return NextResponse.json({ error: 'LUCY_BUSY' }, { status: 429 });
    return NextResponse.json({ error: 'LUCY_NOT_CONNECTED' }, { status: 502 });
  }
  if (!bytes) return NextResponse.json({ error: 'LUCY_NOT_CONNECTED' }, { status: 502 });
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'content-type': 'video/mp4',
      'cache-control': 'no-store',
    },
  });
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function comfyUrlAllowed(value: string): boolean {
  if (/decart\.ai/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
