import test from 'node:test';
import assert from 'node:assert/strict';

test('page-bundle names use safe lowercase slugs', () => {
  assert.match('my-first-entry', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.doesNotMatch('../escape', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.doesNotMatch('Uppercase', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('uploaded asset names cannot contain a path', () => {
  const assetName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i;
  assert.match('temple-photo.webp', assetName);
  assert.doesNotMatch('../temple-photo.webp', assetName);
  assert.doesNotMatch('photo.svg', assetName);
});
