import test from 'node:test';
import assert from 'node:assert/strict';
import { agree, STATUS, versions } from '../scripts/package.mjs';

const files = (pkg, tauri, cargo) => file => ({
  'package.json': JSON.stringify({ version: pkg }),
  'src-tauri/tauri.conf.json': JSON.stringify({ version: tauri }),
  'Cargo.toml': `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${cargo}"\nedition = "2024"\n\n[workspace.dependencies]\nfoo = { version = "9.9.9" }\n`,
})[file];

test('the version is read from package.json, tauri.conf.json and the workspace package, not from a dependency', () => {
  assert.deepEqual(versions(files('1.2.3', '1.2.3', '1.2.3')), { pkg: '1.2.3', tauri: '1.2.3', cargo: '1.2.3' });
});

test('a bundle is refused when the three versions disagree', () => {
  assert.equal(agree(versions(files('1.0.0', '1.0.0', '1.0.0'))), true);
  assert.equal(agree(versions(files('1.0.0', '1.0.1', '1.0.0'))), false);
  assert.equal(agree(versions(files('1.0.0', '1.0.0', '0.9.0'))), false);
});

test('the real repository agrees with itself', () => { assert.equal(agree(versions()), true); });

test('the status wording says unsigned, not notarized, and no updater, and never claims signing or auto-updates', () => {
  for (const text of Object.values(STATUS)) {
    assert.match(text, /no automatic updater/i);
    assert.doesNotMatch(text, /\bis signed\b|automatically updates|auto-?updat(es|ing) (is|are) (on|enabled)/i);
  }
  assert.match(STATUS.darwin, /ad-hoc/i); assert.match(STATUS.darwin, /not notarized/i);
  assert.match(STATUS.win32, /not code-signed/i);
});
