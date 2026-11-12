import test from 'node:test';
import assert from 'node:assert/strict';
import { isExternalChange, OWN_WRITE_WINDOW_MS } from '../src/changes.ts';

test('a change right after the module called a command is its own', () => {
  assert.equal(isExternalChange(10_000, 10_500), false);
  assert.equal(isExternalChange(10_000, 10_000 + OWN_WRITE_WINDOW_MS), false);
});

test('a change after the module has been quiet is another program\'s', () => {
  assert.equal(isExternalChange(10_000, 10_000 + OWN_WRITE_WINDOW_MS + 1), true);
  assert.equal(isExternalChange(undefined, 5), true);
});
