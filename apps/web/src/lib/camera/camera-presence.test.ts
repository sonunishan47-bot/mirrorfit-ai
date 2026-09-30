import { describe, expect, it } from 'vitest';

import { HAVE_CURRENT_DATA, resolveCameraPresence, videoHasLiveFeed } from './camera-presence';

describe('videoHasLiveFeed', () => {
  it('is false without a stream or dimensions', () => {
    expect(videoHasLiveFeed(null)).toBe(false);
    expect(
      videoHasLiveFeed({
        srcObject: null,
        videoWidth: 1280,
        videoHeight: 720,
        readyState: HAVE_CURRENT_DATA,
      }),
    ).toBe(false);
    expect(
      videoHasLiveFeed({
        srcObject: {} as MediaProvider,
        videoWidth: 0,
        videoHeight: 0,
        readyState: HAVE_CURRENT_DATA,
      }),
    ).toBe(false);
  });

  it('is true when srcObject is set and the element has a frame size', () => {
    expect(
      videoHasLiveFeed({
        srcObject: {} as MediaProvider,
        videoWidth: 1280,
        videoHeight: 720,
        readyState: HAVE_CURRENT_DATA,
      }),
    ).toBe(true);
  });
});

describe('resolveCameraPresence', () => {
  it('does not stay unavailable when the video is already painting a live feed', () => {
    expect(
      resolveCameraPresence({
        flag: 'unavailable',
        video: {
          srcObject: {} as MediaProvider,
          videoWidth: 1280,
          videoHeight: 720,
          readyState: HAVE_CURRENT_DATA,
        },
      }),
    ).toBe('live');
  });

  it('keeps unavailable when the element has no feed', () => {
    expect(
      resolveCameraPresence({
        flag: 'unavailable',
        video: {
          srcObject: null,
          videoWidth: 0,
          videoHeight: 0,
          readyState: 0,
        },
      }),
    ).toBe('unavailable');
  });

  it('keeps starting when the feed is not ready yet', () => {
    expect(
      resolveCameraPresence({
        flag: 'starting',
        video: {
          srcObject: {} as MediaProvider,
          videoWidth: 0,
          videoHeight: 0,
          readyState: 0,
        },
      }),
    ).toBe('starting');
  });
});
