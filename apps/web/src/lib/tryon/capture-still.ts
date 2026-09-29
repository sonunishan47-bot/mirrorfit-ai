import { STILL_JPEG_QUALITY, scaledStillSize, validateStillJpeg } from '@mirrorfit/tryon-core';

/**
 * One JPEG still, separate from MediaPipe's video element path.
 * Does not call the pose provider and does not upload by itself.
 */

export interface StillFrame {
  readonly width: number;
  readonly height: number;
  readonly source: CanvasImageSource;
}

export interface StillEncoder {
  draw(source: CanvasImageSource, width: number, height: number): void;
  encodeJpeg(quality: number): Promise<Uint8Array | null>;
}

export async function captureStillJpeg(
  frame: StillFrame | null,
  signal?: AbortSignal,
  encoder?: StillEncoder,
): Promise<Uint8Array | null> {
  if (!frame || signal?.aborted) return null;
  const size = scaledStillSize(frame.width, frame.height);
  if (!size) return null;
  const sink = encoder ?? browserEncoder(size.width, size.height);
  if (!sink) return null;
  sink.draw(frame.source, size.width, size.height);
  const bytes = await sink.encodeJpeg(STILL_JPEG_QUALITY);
  if (!bytes || signal?.aborted) return null;
  return validateStillJpeg(bytes).ok ? bytes : null;
}

function browserEncoder(width: number, height: number): StillEncoder | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  return {
    draw(source, nextWidth, nextHeight) {
      context.drawImage(source, 0, 0, nextWidth, nextHeight);
    },
    encodeJpeg(quality) {
      return new Promise((resolve) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(null);
              return;
            }
            void blob.arrayBuffer().then((buffer) => {
              resolve(new Uint8Array(buffer));
            });
          },
          'image/jpeg',
          quality,
        );
      });
    },
  };
}
