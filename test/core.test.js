import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceSampler, computeThresholdHex, normalizeTraceIdHex } from '../src/index.js';

test('normalizeTraceIdHex zero-pads short ids to 16 chars', () => {
  assert.equal(normalizeTraceIdHex('1'), '0000000000000001');
  assert.equal(normalizeTraceIdHex('ff'), '00000000000000ff');
});

test('normalizeTraceIdHex accepts mixed case and lowercases', () => {
  assert.equal(normalizeTraceIdHex('AbCdEf0123456789'), 'abcdef0123456789');
});

test('normalizeTraceIdHex rejects non-hex characters', () => {
  assert.throws(() => normalizeTraceIdHex('xyz'), /hex digits/);
  assert.throws(() => normalizeTraceIdHex('123g'), /hex digits/);
});

test('normalizeTraceIdHex rejects ids longer than 16 hex chars', () => {
  assert.throws(() => normalizeTraceIdHex('10000000000000000'), /64 bits/);
});

test('normalizeTraceIdHex rejects empty and non-string inputs', () => {
  assert.throws(() => normalizeTraceIdHex(''), /empty/);
  assert.throws(() => normalizeTraceIdHex(42), /string/);
  assert.throws(() => normalizeTraceIdHex(null), /string/);
});

test('computeThresholdHex for rate 0 is all zeros', () => {
  assert.equal(computeThresholdHex(0), '0000000000000000');
});

test('computeThresholdHex for rate 1 is the out-of-range sentinel', () => {
  // 2^64 cannot be represented in 16 hex chars; the sampler uses a 17-char
  // sentinel that sorts above every real 64-bit id.
  assert.equal(computeThresholdHex(1), '10000000000000000');
});

test('computeThresholdHex for rate 0.5 is 2^63', () => {
  assert.equal(computeThresholdHex(0.5), '8000000000000000');
});

test('computeThresholdHex rejects out-of-range and non-finite rates', () => {
  assert.throws(() => computeThresholdHex(-0.1), /\[0, 1\]/);
  assert.throws(() => computeThresholdHex(1.1), /\[0, 1\]/);
  assert.throws(() => computeThresholdHex(NaN), /finite/);
  assert.throws(() => computeThresholdHex(Infinity), /finite/);
  assert.throws(() => computeThresholdHex('0.5'), /finite/);
});

test('rate 0 keeps every id', () => {
  const s = new TraceSampler(0);
  assert.equal(s.decide('0000000000000000').sampled, true);
  assert.equal(s.decide('ffffffffffffffff').sampled, true);
});

test('rate 1 keeps nothing', () => {
  const s = new TraceSampler(1);
  assert.equal(s.decide('0000000000000000').sampled, false);
  assert.equal(s.decide('ffffffffffffffff').sampled, false);
});

test('rate 0.5 splits the space at 2^63', () => {
  const s = new TraceSampler(0.5);
  assert.equal(s.decide('7fffffffffffffff').sampled, false);
  assert.equal(s.decide('8000000000000000').sampled, true);
  assert.equal(s.decide('ffffffffffffffff').sampled, true);
});

test('decision is deterministic for the same trace id', () => {
  const s = new TraceSampler(0.3);
  const a = s.decide('1234567890abcdef');
  const b = s.decide('1234567890abcdef');
  assert.deepEqual(a, b);
});

test('decision result contains normalized fields', () => {
  const s = new TraceSampler(0.5);
  const d = s.decide('1');
  assert.equal(d.traceId, '0000000000000001');
  assert.equal(d.threshold, '8000000000000000');
  assert.equal(d.rate, 0.5);
  assert.equal(typeof d.sampled, 'boolean');
});

test('decide throws on invalid trace id', () => {
  const s = new TraceSampler(0.5);
  assert.throws(() => s.decide('zz'), /hex digits/);
});
