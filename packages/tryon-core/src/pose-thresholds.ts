/**
 * Landmark / fit / overlay thresholds for live try-on.
 *
 * Tuned slightly lenient for lower-quality laptop cameras so TOP overlays
 * stay up when MediaPipe visibility dips, without accepting garbage joints.
 * Old values are noted in comments for regression review.
 */

/** Min joint visibility/presence for geometry + readiness. Was 0.35. */
export const LANDMARK_JOINT_MIN_CONFIDENCE = 0.22;

/** Min of required fitting-joint confidences before producing a fit. Was 0.2. */
export const MIN_POSE_CONFIDENCE = 0.15;

/** Min FittingResult.confidence required to draw the garment. Was 0.2. */
export const OVERLAY_MIN_DRAW_CONFIDENCE = 0.1;

/** Min poseConfidence for the pose-occlusion opacity path. Was 0.2. */
export const OCCLUSION_MIN_POSE_CONFIDENCE = 0.1;

/**
 * After a good fit, keep showing the last transform for this many missed
 * frames when pose briefly drops (hysteresis / anti-flicker).
 */
export const FIT_HOLD_MAX_FRAMES = 8;

/** Per-miss confidence multiplier while holding the last good fit. */
export const FIT_HOLD_CONFIDENCE_DECAY = 0.85;
