/**
 * Derive kiosk camera UI state from the real local `<video>` + MediaStream.
 *
 * The React `camera` flag can go stale when `start()` hangs after `srcObject`
 * is assigned, or when a timeout fires while the element is already playing.
 * Pose and the footer must follow the actual device feed, not that flag alone.
 */

export type CameraPresence = 'live' | 'starting' | 'unavailable';

export interface CameraVideoPresenceSnapshot {
  readonly srcObject: MediaProvider | null;
  readonly videoWidth: number;
  readonly videoHeight: number;
  readonly readyState: number;
  readonly paused?: boolean;
}

/** HTMLMediaElement.HAVE_CURRENT_DATA — enough to paint a frame. */
export const HAVE_CURRENT_DATA = 2;

/**
 * True when the local video element has an attached stream and at least one
 * decoded frame size. Does not invent a feed from an empty element.
 */
export function videoHasLiveFeed(video: CameraVideoPresenceSnapshot | null | undefined): boolean {
  if (!video || !video.srcObject) return false;
  if (!Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight)) return false;
  if (video.videoWidth <= 0 || video.videoHeight <= 0) return false;
  if (typeof video.readyState === 'number' && video.readyState < HAVE_CURRENT_DATA) {
    // Dimensions can appear briefly before HAVE_CURRENT_DATA; still treat
    // positive size + srcObject as a live feed for UI purposes.
    return video.videoWidth > 0 && video.videoHeight > 0;
  }
  return true;
}

/**
 * Prefer the real video element over a sticky React "unavailable" flag when
 * the stream is visibly attached and sized.
 */
export function resolveCameraPresence(input: {
  readonly flag: CameraPresence;
  readonly video: CameraVideoPresenceSnapshot | null | undefined;
}): CameraPresence {
  if (videoHasLiveFeed(input.video)) return 'live';
  return input.flag;
}
