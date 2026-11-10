import test from 'node:test';
import assert from 'node:assert/strict';
import { checkManifests, versionOf } from '../scripts/build-modules.mjs';

const pin = { version: '2.0.1', manifests: ['package.json', 'src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'] };
const files = (pkg, tauri, cargo) => ({ 'package.json': JSON.stringify({ version: pkg }), 'src-tauri/tauri.conf.json': JSON.stringify({ version: tauri }), 'src-tauri/Cargo.toml': `[package]\nname = "x"\nversion = "${cargo}"\n` });

test('reads versions from JSON and TOML manifests', () => {
  assert.equal(versionOf('a.json', '{"version":"1.2.3"}'), '1.2.3');
  assert.equal(versionOf('Cargo.toml', '[package]\nname="x"\nversion = "4.5.6"\n[dependencies]\nversion = "9"'), '4.5.6');
});

test('accepts a pin whose manifests all agree with the pinned version', () => {
  const f = files('2.0.1', '2.0.1', '2.0.1');
  assert.deepEqual(Object.values(checkManifests('swish', pin, file => f[file])), ['2.0.1', '2.0.1', '2.0.1']);
});

test('rejects a pin when any manifest disagrees (Swish v2.0.1 tag, Ember v2.0.2 tag)', () => {
  const f = files('1.0.1', '1.0.1', '0.1.0');
  assert.throws(() => checkManifests('swish', pin, file => f[file]), /disagree/);
  const g = files('2.0.1', '2.0.1', '0.1.0');
  assert.throws(() => checkManifests('swish', pin, file => g[file]), /disagree/);
});
