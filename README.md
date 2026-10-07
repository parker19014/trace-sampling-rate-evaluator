# Trace Sampling Rate Evaluator

Deterministic probabilistic trace sampling. Given a sampling rate `r` in [0, 1]
and a 64-bit trace id, decide whether to keep the trace by comparing the id
against a lower-bound threshold: keep when `traceID >= floor(r * 2^64)`.

## Usage

```js
import { TraceSampler } from 'trace-sampling-rate-evaluator';

const sampler = new TraceSampler(0.5); // keep ~50% of traces

const { sampled, traceId, threshold } = sampler.decide('8000000000000000');
// sampled: true, traceId: '8000000000000000', threshold: '8000000000000000'
```

Exports:
- `TraceSampler` — class; constructor takes `rate` (`number` in [0, 1]);
  method `decide(traceIdHex: string)` returns
  `{ sampled: boolean, traceId: string, threshold: string, rate: number }`.
- `computeThresholdHex(rate)` — returns the 16-char (or 17-char at rate 1)
  lowercase hex threshold.
- `normalizeTraceIdHex(hex)` — normalizes a hex trace id to 16 lowercase chars,
  validating length and character set.

## Why this exists

Distributed tracing systems need to sample traces consistently across services:
if service A keeps a trace and service B drops it, the trace is useless.
Random per-service sampling causes exactly that. A deterministic lower-bound
rule on the trace id guarantees every service makes the same keep/drop decision
for the same trace, with no coordination.

The trade-off: the sampling rate must be fixed and known by all participants
ahead of time. Changing the rate changes which traces are kept, so dynamic rate
adjustment requires re-emitting prior decisions or accepting a discontinuity.

## Edge cases

- **rate = 1** keeps nothing. `floor(1 * 2^64) = 2^64`, which is one past the
  largest 64-bit id, so every id compares below the threshold and is dropped.
  This is deliberate: a rate of 1 in this library means "sample nothing", which
  is the mirror of rate 0 meaning "keep everything". If you need "keep
  everything", use rate 0.
- Trace ids are accepted as hex strings, not numbers, because JavaScript `Number`
  cannot represent 64-bit integers exactly past 2^53. Comparison is done
  lexicographically on equal-length, zero-padded lowercase hex, which is
  numerically exact for equal-length strings.
- The threshold computation uses `Math.floor(rate * 2^64)` converted through
  `BigInt`. For rates very close to 1 this loses precision in the low bits due to
  double-precision floating point; the threshold is therefore accurate to roughly
  15 significant digits, which is far below the granularity that matters for
  sampling.
