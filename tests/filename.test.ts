import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanFilename,
  detectIssues,
  makeUniqueName,
  sanitizeManualFilename,
  splitFilename,
  transliterate,
} from '../src/filename.js';

test('splits ordinary and compound extensions', () => {
  assert.deepEqual(splitFilename('brief.final.pdf'), { stem: 'brief.final', extension: '.pdf' });
  assert.deepEqual(splitFilename('archive.tar.gz'), { stem: 'archive', extension: '.tar.gz' });
  assert.deepEqual(splitFilename('.gitignore'), { stem: '.gitignore', extension: '' });
});

test('turns a noisy filename into a readable handoff name', () => {
  assert.equal(
    cleanFilename('proposal_FINAL_final_v7 (2).PDF'),
    'Proposal Final V7.pdf',
  );
  assert.equal(cleanFilename('Copy of logo__NEW.png'), 'Logo New.png');
  assert.equal(cleanFilename('ЛОГО__НОВЕ___копія.png'), 'Лого Нове.png');
});

test('creates web-safe names and transliterates Cyrillic', () => {
  assert.equal(transliterate('Привіт світ'), 'Pryvit svit');
  assert.equal(cleanFilename('Презентація клієнта (3).PDF', 'web'), 'prezentatsiia-kliienta.pdf');
});

test('minimal mode preserves the author’s casing and separators', () => {
  assert.equal(cleanFilename('Brand_Guide_FINAL (2).PDF', 'minimal'), 'Brand_Guide_FINAL.pdf');
});

test('detects common handoff issues', () => {
  const codes = detectIssues('proposal__FINAL_final (2).pdf').map((issue) => issue.code);
  assert.deepEqual(codes, ['copy', 'separators', 'versions']);
  assert.equal(detectIssues('9E4E67FD0AB94669A0BFB1C67D14C90F.pdf')[0]?.code, 'opaque');
});

test('makes colliding suggestions unique', () => {
  const used = new Set<string>();
  assert.equal(makeUniqueName('Brief.pdf', used), 'Brief.pdf');
  assert.equal(makeUniqueName('Brief.pdf', used), 'Brief 2.pdf');
  assert.equal(makeUniqueName('brief.pdf', used), 'brief 3.pdf');
});

test('sanitizes names edited by the user', () => {
  assert.equal(sanitizeManualFilename('  Client: Brief?.pdf  '), 'Client Brief .pdf');
  assert.equal(sanitizeManualFilename('...'), 'file');
});
