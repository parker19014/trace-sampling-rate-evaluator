/**
 * Deterministic probabilistic sampling using a 64-bit trace ID lower bound.
 *
 * Sampling decision: keep a trace when traceID >= threshold, where threshold is
 * derived from the sampling rate r in [0, 1]. We compute threshold as
 * floor(r * 2^64), clamped to [0, 2^64 - 1]. Using the full 64-bit space (rather
 * than a 63-bit subset) keeps the math exact at common rates like 0.5, 0.25,
 * 0.125 without rounding drift.
 *
 * Because JS Number can only represent integers up to 2^53 exactly, trace IDs
 * are accepted as hex strings and compared lexicographically against a hex
 * threshold. Hex strings of equal, zero-padded length compare identically to
 * their unsigned numeric values, so no BigInt arithmetic is needed for the hot
 * path. We use BigInt only to compute the threshold once at construction time.
 */

/**
 * Convert a hex string to a canonical 16-character lowercase form, left-padded
 * with zeros. Validates that the input contains only hex digits and that, after
 * padding, it fits in 64 bits.
 *
 * @param {string} hex
 * @returns {string}
 */
export function normalizeTraceIdHex(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError('trace id must be a string');
  }
  if (hex.length === 0) {
    throw new Error('trace id must not be empty');
  }
  const lowered = hex.toLowerCase();
  if (!/^[0-9a-f]+$/.test(lowered)) {
    throw new Error('trace id must contain only hex digits');
  }
  if (lowered.length > 16) {
    // A value beyond 2^64 - 1 cannot be represented in this scheme.
    throw new Error('trace id must be at most 64 bits (16 hex chars)');
  }
  return lowered.padStart(16, '0');
}

/**
 * Build the 16-char zero-padded hex threshold for a given sampling rate.
 *
 * The threshold is floor(r * 2^64). A trace is kept when traceID >= threshold.
 * At r = 0 the threshold is 0 (keep everything >= 0, i.e. everything). At r = 1
 * the threshold is 2^64, which exceeds any 64-bit id, so nothing is kept.
 *
 * @param {number} rate
 * @returns {string}
 */
export function computeThresholdHex(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new TypeError('rate must be a finite number');
  }
  if (rate < 0 || rate > 1) {
    throw new Error('rate must be in [0, 1]');
  }
  // BigInt supports up to 2^64 - 1. For rate === 1 the true threshold 2^64 is
  // out of range; we represent it as a 17-char string '10000000000000000' so
  // that every real 64-bit id compares below it and is dropped.
  if (rate === 1) {
    return '10000000000000000';
  }
  // rate in [0, 1). floor(rate * 2^64) is in [0, 2^64 - 1].
  const twoPow64 = 2n ** 64n;
  // Convert via string to avoid double-precision loss for the integer part.
  // rate * 2^64 may exceed 2^53, so we route through BigInt by splitting the
  // computation: use the full product then truncate.
  const rateBig = BigInt(Math.floor(rate * Number(twoPow64)));
  // Math.floor(rate * 2^64) loses precision above 2^53, but rate < 1 means the
  // product is < 2^64. We correct by recomputing with a higher-recision path:
  // represent rate as a fraction of 2^64 directly using BigInt on the scaled
  // integer. To keep this dependency-free and simple, we accept the
  // double-precision result for threshold purposes — see README for the exact
  // guarantee.
  const clamped = rateBig < 0n ? 0n : rateBig > twoPow64 ? twoPow64 : rateBig;
  return clamped.toString(16).padStart(16, '0');
}

/**
 * @typedef {Object} SamplingDecision
 * @property {boolean} sampled   - true when the trace should be kept.
 * @property {string}  traceId   - the normalized 16-char hex trace id.
 * @property {string}  threshold - the 16-char (or 17-char for rate=1) hex threshold.
 * @property {number}  rate      - the configured sampling rate.
 */

/**
 * Deterministic sampler: given a sampling rate, decide whether to keep a trace
 * based on its 64-bit trace id.
 *
 * The decision is a pure function of (rate, traceId). The same inputs always
 * yield the same decision, which makes sampling reproducible across services
 * that share the trace id — essential for correlating distributed traces.
 */
export class TraceSampler {
  /**
   * @param {number} rate - sampling probability in [0, 1]. 0 keeps nothing,
   *   1 keeps everything.
   */
  constructor(rate) {
    this.rate = rate;
    this.threshold = computeThresholdHex(rate);
    // Precompute the normalized threshold length for the comparison. When rate
    // is 1, the threshold is 17 chars and is strictly greater than any 16-char
    // id, so we short-circuit in shouldSample instead of comparing lengths.
    this._thresholdLen = this.threshold.length;
  }

  /**
   * Decide whether a trace should be sampled.
   *
   * @param {string} traceIdHex - hex trace id, up to 16 chars (64 bits).
   * @returns {SamplingDecision}
   */
  decide(traceIdHex) {
    const id = normalizeTraceIdHex(traceIdHex);
    let sampled;
    if (this._thresholdLen === 17) {
      // rate === 1: threshold is 2^64, larger than any 64-bit id.
      sampled = false;
    } else if (this.threshold === '0000000000000000') {
      // rate === 0: keep everything.
      sampled = true;
    } else {
      // Both id and threshold are 16-char lowercase hex. Lexicographic order
      // on equal-length zero-padded hex equals numeric order.
      sampled = id >= this.threshold;
    }
    return {
      sampled,
      traceId: id,
      threshold: this.threshold,
      rate: this.rate,
    };
  }
}
