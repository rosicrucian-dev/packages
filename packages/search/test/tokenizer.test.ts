// Tests for the shared search engine's tokenizer.
//
//   npm test
//
// ⚠ KEEP BYTE-IDENTICAL with the sibling project (botatoolbox ⇄ agelesswisdom);
//   `npm run check:shared` verifies the whole test/search-engine/ directory.
//
// The tokenizer is used by BOTH the generator and the query side, so a change
// to what counts as a word changes what is findable at all. Pinned here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveTokenizer } from '../src/index.ts'

const en = resolveTokenizer({ locale: 'en' })

test('lowercases, drops stopwords, folds possessives', () => {
  assert.deepEqual(en.tokenize("The Life-Power's light"), [
    'life',
    'power',
    'light',
  ])
})

test('a curly apostrophe is part of a word, like a straight one', () => {
  assert.deepEqual(en.tokenize('Case’s don’t'), ['case', 'don’t'])
})

test('keeps lone non-Latin letters and lone digits, culls lone Latin ones', () => {
  // A Hebrew or Greek letter is a word in its own right; a lone "a"/"s" left
  // over from folding is noise; a lone digit is a number (Key 0).
  assert.deepEqual(en.tokenize('א ב a s 0'), ['א', 'ב', '0'])
})

test('numbers are tokens by default', () => {
  assert.deepEqual(en.tokenize('Key 21, Lesson 12, in 1909'), [
    'key',
    '21',
    'lesson',
    '12',
    '1909',
  ])
})

test('numbers: false restores letters-only words', () => {
  const t = resolveTokenizer({ locale: 'en', numbers: false })
  assert.deepEqual(t.tokenize('Key 21 in 1909'), ['key'])
})

test('folds accents and combining marks so café and cafe agree', () => {
  assert.deepEqual(en.tokenize('café cafe café'), ['cafe', 'cafe', 'cafe'])
})

test('fold: false keeps accents distinct', () => {
  const t = resolveTokenizer({ locale: 'en', fold: false })
  assert.deepEqual(t.tokenize('café cafe'), ['café', 'cafe'])
})

test('folds Hebrew final forms and ignores nikkud', () => {
  assert.deepEqual(en.tokenize('מלך מלכ'), ['מלכ', 'מלכ'])
  // שָׁלוֹם with points: the word is not split at the marks, the marks go,
  // and its final mem folds like any other final.
  assert.deepEqual(en.tokenize('שָׁלוֹם'), ['שלומ'])
  const keepFinals = resolveTokenizer({ locale: 'en', hebrewFinals: false })
  assert.deepEqual(keepFinals.tokenize('שָׁלוֹם'), ['שלום'])
})

test('hebrewFinals: false keeps the final forms', () => {
  const t = resolveTokenizer({ locale: 'en', hebrewFinals: false })
  assert.deepEqual(t.tokenize('מלך מלכ'), ['מלך', 'מלכ'])
})

test('applies the locale stopword list, not a universal one', () => {
  const de = resolveTokenizer({ locale: 'de' })
  assert.deepEqual(de.tokenize('Der Baum des Lebens'), ['baum', 'lebens'])
  assert.deepEqual(en.tokenize('Der Baum des Lebens'), [
    'der',
    'baum',
    'des',
    'lebens',
  ])
})

test('German stopwords with umlauts still drop after folding', () => {
  const de = resolveTokenizer({ locale: 'de' })
  assert.deepEqual(de.tokenize('über den Baum für uns'), ['baum', 'uns'])
})

test('falls back to English stopwords for an unknown locale', () => {
  assert.deepEqual(resolveTokenizer({ locale: 'xx' }).tokenize('the tree'), [
    'tree',
  ])
})

test("stopwords: 'none' keeps every word; a custom list replaces the default", () => {
  assert.deepEqual(
    resolveTokenizer({ locale: 'en', stopwords: 'none' }).tokenize('the tree'),
    ['the', 'tree'],
  )
  assert.deepEqual(
    resolveTokenizer({ locale: 'en', stopwords: ['tree'] }).tokenize(
      'the tree',
    ),
    ['the'],
  )
})

test('spans carry the offsets of the ORIGINAL text, before folding', () => {
  const text = "The Café's door"
  const spans = en.spans(text)
  assert.deepEqual(
    spans.map((s) => [s.token, text.slice(s.start, s.end)]),
    [
      ['cafe', 'Café'],
      ['door', 'door'],
    ],
  )
})

test('the resolved config records every default', () => {
  assert.deepEqual(en.config, {
    locale: 'en',
    stopwords: 'default',
    numbers: true,
    fold: true,
    hebrewFinals: true,
  })
})
