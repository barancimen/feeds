import assert from 'node:assert/strict';
import test from 'node:test';
import { ftsQuery } from '../worker/src/fts.js';

test('builds quoted, AND-ed terms with a prefix on the last one', () => {
  assert.equal(ftsQuery('tom jer'), '"tom" "jer"*');
  assert.equal(ftsQuery('  @alice   #news '), '"@alice" "#news"*');
});

test('neutralises FTS5 operators and junk', () => {
  assert.equal(ftsQuery('a" OR body:"b'), '"a" "OR" "body:b"*');
  assert.equal(ftsQuery('NEAR(x y) -z ^w'), '"NEAR(x" "y)" "-z" "^w"*');
  assert.equal(ftsQuery('"*:( !!! ---'), null);
  assert.equal(ftsQuery(''), null);
  assert.equal(ftsQuery(null), null);
  assert.equal(ftsQuery('1 2 3 4 5 6 7 8 9 10').split(' ').length, 8);
});
