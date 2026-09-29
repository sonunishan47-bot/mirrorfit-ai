import {
  generateStill,
  probeVtonHealth,
  safeTryOnLog,
  type VtonEnv,
  type VtonFitCategory,
} from './vton-provider';

/**
 * Process loop for the GPU machine. The mirror does not import this.
 * One claim, one still inference (retried once on VTON_UPSTREAM), one completion.
 * No pixels are invented here.
 */

export interface WorkerLoopOptions {
  readonly env?: VtonEnv;
  readonly fetchFn?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (line: string) => void;
  readonly shouldStop?: () => boolean;
  /** Tests pass 1. The production script omits it and loops until stopped. */
  readonly maxLoops?: number;
}

interface ClaimedJob {
  readonly job_id: string;
  readonly input_url: string;
  readonly garment_reference_url: string | null;
  readonly garment_category: string | null;
  readonly fit_category: VtonFitCategory | null;
}

export async function runVtonWorker(options: WorkerLoopOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const fetchFn = options.fetchFn ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((line: string) => console.error(safeTryOnLog(line)));
  const shouldStop = options.shouldStop ?? (() => false);
  const origin = (env['MIRRORFIT_APP_ORIGIN'] ?? '').replace(/\/$/, '');
  const secret = env['WORKER_SECRET']?.trim() ?? '';
  if (!origin || secret.length < 16) {
    log('MIRRORFIT_APP_ORIGIN and WORKER_SECRET (16+ chars) are required.');
    return;
  }

  const health = await probeVtonHealth(env, fetchFn);
  log(health.ok ? 'vton health ok' : `vton health ${health.reason}`);

  let loops = 0;
  while (!shouldStop()) {
    if (options.maxLoops !== undefined && loops >= options.maxLoops) return;
    loops += 1;
    try {
      const claimed = await claim(origin, secret, fetchFn);
      if (!claimed) {
        await sleep(2_000);
        continue;
      }
      const result = await generateWithRetry(claimed, env, fetchFn, sleep);
      if (!result.ok) {
        await complete(origin, secret, fetchFn, claimed.job_id, 'FAILED', result.error, null);
        continue;
      }
      await complete(origin, secret, fetchFn, claimed.job_id, 'SUCCEEDED', null, result.jpeg);
    } catch (error) {
      log(error instanceof Error ? error.message : 'worker loop failed');
      await sleep(2_000);
    }
  }
}

async function claim(
  origin: string,
  secret: string,
  fetchFn: typeof fetch,
): Promise<ClaimedJob | null> {
  const response = await fetchFn(`${origin}/api/worker/tryon-jobs/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { job?: Partial<ClaimedJob> | null };
  const job = body.job;
  if (!job?.job_id || !job.input_url) return null;
  return {
    job_id: job.job_id,
    input_url: job.input_url,
    garment_reference_url: job.garment_reference_url ?? null,
    garment_category: job.garment_category ?? null,
    fit_category: asFit(job.fit_category),
  };
}

async function generateWithRetry(
  claimed: ClaimedJob,
  env: VtonEnv,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<Awaited<ReturnType<typeof generateStill>>> {
  const job = {
    jobId: claimed.job_id,
    personUrl: claimed.input_url,
    garmentUrl: claimed.garment_reference_url,
    garmentCategory: claimed.garment_category,
    fitCategory: claimed.fit_category,
  };
  const first = await generateStill(job, env, fetchFn);
  if (first.ok || first.error !== 'VTON_UPSTREAM') return first;
  await sleep(400);
  return generateStill(job, env, fetchFn);
}

function asFit(value: unknown): VtonFitCategory | null {
  if (value === 'TOP' || value === 'LOWER_BODY' || value === 'FULL_BODY') return value;
  return null;
}

async function complete(
  origin: string,
  secret: string,
  fetchFn: typeof fetch,
  jobId: string,
  status: 'SUCCEEDED' | 'FAILED',
  errorCode: string | null,
  jpeg: Uint8Array | null,
): Promise<void> {
  const form = new FormData();
  form.set('job_id', jobId);
  form.set('status', status);
  if (errorCode) form.set('error_code', errorCode);
  if (jpeg) {
    const copy = new ArrayBuffer(jpeg.byteLength);
    new Uint8Array(copy).set(jpeg);
    form.set('image', new Blob([copy], { type: 'image/jpeg' }), 'out.jpg');
  }
  const response = await fetchFn(`${origin}/api/worker/tryon-jobs/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    body: form,
  });
  if (!response.ok) {
    console.error(`complete ${status} rejected`);
  }
}
