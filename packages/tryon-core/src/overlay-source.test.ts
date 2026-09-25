import { describe, expect, it } from 'vitest';

import { overlaySourceForSelection } from './overlay-source';

describe('overlay source selection', () => {
  it('draws only the labelled TEST FIXTURE for TOP selections', () => {
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: 'TOP',
      }),
    ).toBe('test_fixture');
  });

  it('does not invent a commercial product overlay', () => {
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: false,
        fitCategory: 'TOP',
      }),
    ).toBe('none');
  });

  it('does not draw when no garment is selected or category is unsupported', () => {
    expect(
      overlaySourceForSelection({
        selected: false,
        isTestFixture: true,
        fitCategory: 'TOP',
      }),
    ).toBe('none');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: 'LOWER_BODY',
      }),
    ).toBe('none');
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: null,
      }),
    ).toBe('none');
  });
});
