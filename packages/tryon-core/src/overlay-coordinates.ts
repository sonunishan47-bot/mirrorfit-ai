/**
 * Kiosk preview convention.
 *
 * The live `<video>` and the overlay `<canvas>` are both CSS-mirrored
 * (`scaleX(-1)`). MediaPipe `detectForVideo` reads the unmirrored video
 * bitmap. Overlay drawing therefore uses MediaPipe x/y unchanged so the
 * second CSS mirror keeps the garment on the same body as the preview.
 *
 * Do not also invert x in software. That would double-flip the overlay
 * relative to the mirrored camera.
 */
export const KIOSK_PREVIEW_CSS_MIRRORED = true;

export function overlayPointFromLandmark(
  point: { readonly x: number; readonly y: number },
  cssMirroredPreview = KIOSK_PREVIEW_CSS_MIRRORED,
): { readonly x: number; readonly y: number } {
  if (!cssMirroredPreview) {
    return { x: 1 - point.x, y: point.y };
  }
  return { x: point.x, y: point.y };
}
