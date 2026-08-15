import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAsanaHtml, unescapeLiteralNewlines } from '../lib/html.js';

test('sanitizeAsanaHtml maps non-whitelisted tags and wraps in <body>', () => {
  assert.equal(sanitizeAsanaHtml('<h2>T</h2><p>a <b>b</b> <i>c</i></p>'),
    '<body><strong>T</strong>\n\na <strong>b</strong> <em>c</em>\n\n</body>');
  assert.equal(sanitizeAsanaHtml('<div>x</div><br>y'), '<body>x\ny</body>');
});

test('sanitizeAsanaHtml passes whitelisted HTML through (adds only the body root)', () => {
  assert.equal(sanitizeAsanaHtml('<strong>ok</strong> <em>fine</em>'), '<body><strong>ok</strong> <em>fine</em></body>');
  const wrapped = '<body><strong>done</strong></body>';
  assert.equal(sanitizeAsanaHtml(wrapped), wrapped, 'already-wrapped input unchanged');
});

test('sanitizeAsanaHtml non-strings pass through', () => {
  assert.equal(sanitizeAsanaHtml(undefined), undefined);
  assert.equal(sanitizeAsanaHtml(null), null);
});

test('unescapeLiteralNewlines converts two-char sequences, leaves real text alone', () => {
  assert.equal(unescapeLiteralNewlines('a\\nb\\tc'), 'a\nb\tc');
  assert.equal(unescapeLiteralNewlines('plain'), 'plain');
  assert.equal(unescapeLiteralNewlines(42), 42);
});
