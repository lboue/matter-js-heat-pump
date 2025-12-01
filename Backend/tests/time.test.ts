import assert from 'node:assert/strict';
import test from 'node:test';
import { toMatterEpochSeconds } from '../utils/time.js';

// Unix timestamp for 2000-01-01T00:00:00Z
const UNIX_2000 = 946_684_800;

await test('toMatterEpochSeconds returns 0 at Matter epoch', () => {
  assert.equal(toMatterEpochSeconds(UNIX_2000), 0);
});

await test('toMatterEpochSeconds offsets correctly by minutes', () => {
  assert.equal(toMatterEpochSeconds(UNIX_2000 + 60), 60);
});

await test('toMatterEpochSeconds without arg returns reasonable value', () => {
  const val = toMatterEpochSeconds();
  // Should be roughly now minus offset; just check it is a finite integer and within plausible range
  assert.ok(Number.isFinite(val));
  assert.ok(Math.abs(val) < 2 ** 31); // within 32-bit signed range for sanity
});

await test('toMatterEpochSeconds for 2025-01-01T00:00:00Z', () => {
  const UNIX_2025 = Math.floor(Date.parse('2025-01-01T00:00:00Z') / 1000);
  const MATTER_EPOCH_OFFSET = 946_684_800;
  assert.equal(toMatterEpochSeconds(UNIX_2025), UNIX_2025 - MATTER_EPOCH_OFFSET);
});
