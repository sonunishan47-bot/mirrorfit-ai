import { describe, expect, it } from 'vitest';

import { isPublicPath, PUBLIC_PATHS } from './public-paths';

describe('kiosk and device paths stay off the login redirect', () => {
  it('treats /mirror as public', () => {
    expect(PUBLIC_PATHS).toContain('/mirror');
    expect(isPublicPath('/mirror')).toBe(true);
    expect(isPublicPath('/mirror/')).toBe(true);
  });

  it('does not treat staff pages as public', () => {
    expect(isPublicPath('/displays')).toBe(false);
    expect(isPublicPath('/login')).toBe(true);
  });

  it('keeps the device and session APIs public', () => {
    expect(isPublicPath('/api/device/enroll')).toBe(true);
    expect(isPublicPath('/api/session/create')).toBe(true);
  });
});
