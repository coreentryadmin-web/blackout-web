import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthFailureStatus, isTransientOriginError } from './auth-status.mjs';

test('isAuthFailureStatus flags 401 and 403', () => {
  assert.equal(isAuthFailureStatus(401), true);
  assert.equal(isAuthFailureStatus(403), true);
});

test('isAuthFailureStatus does not flag success or unrelated error codes', () => {
  assert.equal(isAuthFailureStatus(200), false);
  assert.equal(isAuthFailureStatus(404), false);
  assert.equal(isAuthFailureStatus(429), false);
  assert.equal(isAuthFailureStatus(500), false);
});

test('isTransientOriginError flags edge/origin overload codes', () => {
  assert.equal(isTransientOriginError(502), true);
  assert.equal(isTransientOriginError(503), true);
  assert.equal(isTransientOriginError(504), true);
  assert.equal(isTransientOriginError(524), true);
  assert.equal(isTransientOriginError(200), false);
  assert.equal(isTransientOriginError(401), false);
});
