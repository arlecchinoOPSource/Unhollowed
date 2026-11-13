import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptable, spdxParts } from '../scripts/third-party-notices.mjs';

test('permissive licences and permissive alternatives are acceptable', () => {
  for (const ok of ['MIT', 'Apache-2.0', 'MIT OR Apache-2.0', 'MIT/Apache-2.0', 'Zlib OR Apache-2.0 OR MIT', '(MIT OR Apache-2.0) AND Unicode-3.0', 'OFL-1.1', 'BSD-3-Clause AND MIT', 'MPL-2.0', 'Unlicense OR MIT']) assert.equal(acceptable(ok), true, ok);
});

test('strong copyleft, unknown and missing licences need a decision', () => {
  for (const bad of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'GPL-2.0 OR GPL-3.0', 'SEE LICENSE IN LICENSE', '', undefined, 'Proprietary', 'MIT AND GPL-3.0']) assert.equal(acceptable(bad), false, String(bad));
});

test('an OR lets us pick a permissive alternative, an AND needs every part to be acceptable', () => {
  assert.equal(acceptable('GPL-3.0 OR MIT'), true);
  assert.equal(acceptable('MIT AND GPL-3.0'), false);
  assert.deepEqual(spdxParts('(MIT OR Apache-2.0) AND Unicode-3.0'), ['MIT', 'Apache-2.0', 'Unicode-3.0']);
});
