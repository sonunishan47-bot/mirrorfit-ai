/** Local mirror selection for a physical camera check. Not a database id. */
export interface TrialOverlaySelection {
  readonly garmentId: string;
  readonly variantId: string;
  readonly category: string;
  readonly isTestFixture: true;
  readonly colorName: string;
  readonly sizeLabel: 'M';
}

export const TRIAL_SHIRT_OVERLAY: TrialOverlaySelection = {
  garmentId: 'trial-shirt',
  variantId: 'trial-shirt-navy',
  category: 'Tops',
  isTestFixture: true,
  colorName: 'Navy',
  sizeLabel: 'M',
};

export const TRIAL_PANTS_OVERLAY: TrialOverlaySelection = {
  garmentId: 'trial-pants',
  variantId: 'trial-pants-charcoal',
  category: 'Pants',
  isTestFixture: true,
  colorName: 'Charcoal',
  sizeLabel: 'M',
};
