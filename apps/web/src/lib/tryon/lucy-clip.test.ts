import { describe, expect, it } from 'vitest';

import { buildLucyEditPrompt, enqueueLucyJob, findComfyVideo, resetLucyQueue } from './comfy-lucy';
import { clipStartSeconds, LUCY_VRAM_PROFILES, readLucyVramProfile } from './lucy-clip-config';
import { lucyDescription, lucyOutfitPrompt, parseLucyDescription } from './lucy-prompt';

describe('Lucy Edit Dev clip', () => {
  it('uses the clothing template and does not ask to preserve a face', () => {
    const prompt = lucyOutfitPrompt({
      color: 'navy',
      garment: 'shirt',
      fabricAndDetails: 'cotton poplin',
      fit: 'relaxed',
      extraPrompt: 'white buttons',
    });
    expect(prompt).toBe(
      'Change the outfit to a navy shirt, cotton poplin, relaxed, natural folds and drape, realistic studio lighting, full-body mid-shot. white buttons',
    );
    expect(prompt.toLowerCase()).not.toContain('preserve');
    expect(prompt.toLowerCase()).not.toContain('identity');
  });

  it('round-trips staff fields through the garment description', () => {
    const stored = lucyDescription({
      fabricAndDetails: 'linen',
      fit: 'straight',
      extraPrompt: 'side slits',
    });
    expect(parseLucyDescription(stored)).toEqual({
      fabricAndDetails: 'linen',
      fit: 'straight',
      extraPrompt: 'side slits',
    });
  });

  it('trims a 12s segment to the last 6s and refuses a short one', () => {
    expect(clipStartSeconds(12_000)).toBe(6);
    expect(clipStartSeconds(4_000)).toBeNull();
    expect(readLucyVramProfile({}).frames).toBe(LUCY_VRAM_PROFILES.gpu_12gb.frames);
    expect(readLucyVramProfile({ LUCY_VRAM_PROFILE: 'gpu_8gb' }).frames).toBe(17);
    expect(LUCY_VRAM_PROFILES.gpu_12gb.height % 32).toBe(0);
    expect(LUCY_VRAM_PROFILES.gpu_16gb_plus.height % 32).toBe(0);
  });

  it('builds a local ComfyUI prompt for the fp16 dev weights', () => {
    const prompt = buildLucyEditPrompt({
      videoName: 'clip.webm',
      prompt: lucyOutfitPrompt({
        color: 'blue',
        garment: 'kurta',
        fabricAndDetails: 'cotton',
        fit: 'regular',
      }),
      profile: LUCY_VRAM_PROFILES.gpu_12gb,
      durationMs: 12_000,
      unetName: 'lucy-edit-1.1-dev-cui-fp16.safetensors',
    });
    expect(prompt).not.toBeNull();
    const encoded = JSON.stringify(prompt);
    expect(encoded).toContain('lucy-edit-1.1-dev-cui-fp16.safetensors');
    expect(encoded).toContain('wan2.2_vae.safetensors');
    expect(encoded).toContain('umt5_xxl_fp8_e4m3fn_scaled.safetensors');
    expect(encoded).not.toContain('platform.decart.ai');
    expect(encoded.toLowerCase()).not.toContain('preserve face');
    const load = prompt?.['82'] as { inputs: { start_time: number; video: string } };
    expect(load.inputs.start_time).toBe(6);
    expect(load.inputs.video).toBe('clip.webm');
  });

  it('reads the saved video out of ComfyUI history', () => {
    expect(
      findComfyVideo(
        {
          job: {
            outputs: {
              '58': { videos: [{ filename: 'a.mp4', subfolder: 'video', type: 'output' }] },
            },
          },
        },
        'job',
      ),
    ).toEqual({ filename: 'a.mp4', subfolder: 'video', type: 'output' });
    expect(findComfyVideo({}, 'missing')).toBeNull();
  });

  it('runs one Lucy job at a time and refuses a third waiter', async () => {
    resetLucyQueue();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueLucyJob(async () => {
      await gate;
      order.push('first');
    });
    const second = enqueueLucyJob(() => {
      order.push('second');
      return Promise.resolve();
    });
    const third = enqueueLucyJob(() => {
      order.push('third');
      return Promise.resolve();
    });
    await expect(third).rejects.toThrow('QUEUE_FULL');
    release();
    await first;
    await second;
    expect(order).toEqual(['first', 'second']);
  });
});
