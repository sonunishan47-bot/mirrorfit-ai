import { clipStartSeconds, type LucyVramProfile } from './lucy-clip-config';

/**
 * ComfyUI API prompt for examples/basic-lucy-edit-dev.json.
 * Local weights only. This does not call platform.decart.ai.
 */

export interface LucyWorkflowInput {
  readonly videoName: string;
  readonly prompt: string;
  readonly profile: LucyVramProfile;
  readonly durationMs: number;
  readonly unetName: string;
}

export function buildLucyEditPrompt(input: LucyWorkflowInput): Record<string, unknown> | null {
  const start = clipStartSeconds(input.durationMs);
  if (start === null) return null;
  const seed = Math.floor(Math.random() * 1_000_000_000);
  return {
    '37': {
      class_type: 'UNETLoader',
      inputs: { unet_name: input.unetName, weight_dtype: 'default' },
    },
    '38': {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
        type: 'wan',
        device: 'default',
      },
    },
    '39': {
      class_type: 'VAELoader',
      inputs: { vae_name: 'wan2.2_vae.safetensors' },
    },
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.prompt, clip: ['38', 0] },
    },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '', clip: ['38', 0] },
    },
    '80': { class_type: 'PrimitiveInt', inputs: { value: input.profile.frames } },
    '77': { class_type: 'PrimitiveFloat', inputs: { value: input.profile.fps } },
    '82': {
      class_type: 'VHS_LoadVideoFFmpeg',
      inputs: {
        video: input.videoName,
        force_rate: ['77', 0],
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: ['80', 0],
        start_time: start,
        format: 'Wan',
      },
    },
    '72': {
      class_type: 'ImageResizeKJv2',
      inputs: {
        image: ['82', 0],
        width: input.profile.width,
        height: input.profile.height,
        upscale_method: 'nearest-exact',
        keep_proportion: 'stretch',
        pad_color: '0, 0, 0',
        crop_position: 'center',
        divisible_by: 32,
        device: 'cpu',
      },
    },
    '73': {
      class_type: 'VAEEncode',
      inputs: { pixels: ['72', 0], vae: ['39', 0] },
    },
    '69': {
      class_type: 'LucyConditionConcatNode',
      inputs: { model: ['37', 0], concat_latent: ['73', 0] },
    },
    '48': {
      class_type: 'ModelSamplingSD3',
      inputs: { model: ['69', 0], shift: 5 },
    },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['48', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['69', 1],
        seed,
        steps: input.profile.steps,
        cfg: 5,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
      },
    },
    '8': {
      class_type: 'VAEDecode',
      inputs: { samples: ['3', 0], vae: ['39', 0] },
    },
    '57': {
      class_type: 'CreateVideo',
      inputs: { images: ['8', 0], fps: ['77', 0] },
    },
    '58': {
      class_type: 'SaveVideo',
      inputs: {
        video: ['57', 0],
        filename_prefix: 'mirrorfit/lucy',
        format: 'auto',
        codec: 'auto',
      },
    },
  };
}

export interface ComfyVideoFile {
  readonly filename: string;
  readonly subfolder: string;
  readonly type: string;
}

export function findComfyVideo(history: unknown, promptId: string): ComfyVideoFile | null {
  if (!history || typeof history !== 'object') return null;
  const entry = (history as Record<string, unknown>)[promptId];
  if (!entry || typeof entry !== 'object') return null;
  const outputs = (entry as Record<string, unknown>)['outputs'];
  if (!outputs || typeof outputs !== 'object') return null;
  for (const node of Object.values(outputs as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    for (const key of ['videos', 'gifs', 'images'] as const) {
      const list = record[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const file = item as Record<string, unknown>;
        if (typeof file['filename'] !== 'string' || file['filename'].length === 0) continue;
        return {
          filename: file['filename'],
          subfolder: typeof file['subfolder'] === 'string' ? file['subfolder'] : '',
          type: typeof file['type'] === 'string' ? file['type'] : 'output',
        };
      }
    }
  }
  return null;
}

let tail: Promise<void> = Promise.resolve();
let waiting = 0;

export function resetLucyQueue(): void {
  tail = Promise.resolve();
  waiting = 0;
}

/** One ComfyUI job at a time. A third waiting tap is refused. */
export function enqueueLucyJob<T>(task: () => Promise<T>): Promise<T> {
  if (waiting >= 2) return Promise.reject(new Error('QUEUE_FULL'));
  waiting += 1;
  const run = tail.then(task, task);
  tail = run.then(
    () => {
      waiting -= 1;
    },
    () => {
      waiting -= 1;
    },
  );
  return run;
}

export async function runLocalLucyEdit(
  input: {
    readonly baseUrl: string;
    readonly clip: Blob;
    readonly filename: string;
    readonly workflow: Record<string, unknown>;
  },
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array | null> {
  const base = input.baseUrl.replace(/\/$/, '');
  const form = new FormData();
  form.set('image', input.clip, input.filename);
  form.set('overwrite', 'true');
  form.set('type', 'input');
  const uploaded = await fetchFn(`${base}/upload/image`, { method: 'POST', body: form });
  if (!uploaded.ok) return null;
  const uploadedBody = (await uploaded.json()) as { name?: string };
  if (!uploadedBody.name) return null;
  const workflow = stampUploadedVideo(input.workflow, uploadedBody.name);
  const queued = await fetchFn(`${base}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!queued.ok) return null;
  const queuedBody = (await queued.json()) as { prompt_id?: string };
  const promptId = queuedBody.prompt_id;
  if (!promptId) return null;
  const deadline = Date.now() + 120_000;
  let file: ComfyVideoFile | null = null;
  while (Date.now() < deadline && !file) {
    await delay(2_000);
    const history = await fetchFn(`${base}/history/${promptId}`);
    if (!history.ok) continue;
    file = findComfyVideo(await history.json(), promptId);
  }
  if (!file) return null;
  const view = new URL(`${base}/view`);
  view.searchParams.set('filename', file.filename);
  view.searchParams.set('subfolder', file.subfolder);
  view.searchParams.set('type', file.type);
  const result = await fetchFn(view);
  if (!result.ok) return null;
  const bytes = new Uint8Array(await result.arrayBuffer());
  if (bytes.byteLength < 1024) return null;
  return bytes;
}

function stampUploadedVideo(workflow: Record<string, unknown>, name: string): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  const node = copy['82'];
  if (node && typeof node === 'object') {
    const inputs = (node as { inputs?: { video?: string } }).inputs;
    if (inputs) inputs.video = name;
  }
  return copy;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
