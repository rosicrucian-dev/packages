// The tokenizer: the one definition of "a word" for the whole engine.
//
// The index generator and the query side, the result excerpts and the marks on
// an arrived-at page all tokenize with the SAME resolved configuration, which
// the index records in its header. That is what guarantees the words shown as
// matched are the words the index matched on — there is no second definition.
//
// The configuration is plain data on purpose: it has to round-trip through the
// index JSON. There are no function slots (a stemmer would be one); if one is
// ever needed it goes in as a named option here, not as a callback.

export interface TokenizerConfig {
  /** Picks the default stopword list ('en', 'de'; anything else falls back to
   *  English). Recorded in the index so the query side can never disagree. */
  locale: string
  /** 'default' = the locale's list; 'none' = keep every word; or your own. */
  stopwords?: 'default' | 'none' | string[]
  /** Treat digits as word characters, so "21" and "1909" are searchable.
   *  Default true. */
  numbers?: boolean
  /** Unicode-fold: NFKD, strip combining marks, lowercase — café matches cafe,
   *  Hebrew nikkud are ignored. Default true. */
  fold?: boolean
  /** Fold the five Hebrew final forms onto their base letters (ך→כ …), so a
   *  word is found however it was spelled. Default true. */
  hebrewFinals?: boolean
}

/** Every option decided. This is what the index header carries. */
export interface ResolvedTokenizerConfig {
  locale: string
  stopwords: 'default' | 'none' | string[]
  numbers: boolean
  fold: boolean
  hebrewFinals: boolean
}

/** A token with the character range of the ORIGINAL text it came from, so a
 *  caller can mark that text without re-deriving where the word was. */
export interface Span {
  token: string
  start: number
  end: number
}

export interface Tokenizer {
  config: ResolvedTokenizerConfig
  /** The normalized, stopword-free token stream of `text`. */
  tokenize(text: string): string[]
  /** The same tokens with their offsets into `text`. */
  spans(text: string): Span[]
}

// High-frequency words that would match nearly everything. Per-locale; doctrinal
// vocabulary (life, power, light…) stays searchable on purpose.
const STOPWORDS: Record<string, readonly string[]> = {
  en: (
    'the of is a and to in it that this as by which for with are be not was ' +
    'or its from an but have has we you your they their them he his him she ' +
    'her on at when what who whom whose there these those than then so if ' +
    'into upon our us out all will shall may can do does did been being were ' +
    'would should could also more most other some such no nor only very am ' +
    'i me my mine had how because while where after before between during'
  ).split(' '),
  de: (
    'der die das den dem des ein eine einen einem eines einer und oder aber ' +
    'ist sind war waren sein seine seiner ihr ihre ihrer es sie er wir ich ' +
    'du ihr man nicht kein keine auch nur noch schon so wie als wenn dann ' +
    'denn dass weil mit von zu zur zum auf in im am an bei nach vor über ' +
    'unter durch für gegen ohne um aus hat haben hatte hatten wird werden ' +
    'wurde wurden kann können muss müssen soll sollen darf dürfen mehr sehr ' +
    'alle allem allen aller alles dies diese diesem diesen dieser dieses'
  ).split(' '),
}

// Straight and curly apostrophes both count as part of a word ("Case's",
// "don’t" — phones and macOS type the curly one). Combining marks (\p{M}) are
// word characters too, or a word with nikkud or a decomposed accent would be
// split at every mark before folding ever got to remove it.
const APOSTROPHES = "'’"
const WORD_WITH_NUMBERS = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu
const WORD_LETTERS_ONLY = /[\p{L}][\p{L}\p{M}'’]*/gu

const HEBREW_FINALS: Record<string, string> = {
  ך: 'כ',
  ם: 'מ',
  ן: 'נ',
  ף: 'פ',
  ץ: 'צ',
}

export function resolveTokenizer(config: TokenizerConfig): Tokenizer {
  const resolved: ResolvedTokenizerConfig = {
    locale: config.locale,
    stopwords: config.stopwords ?? 'default',
    numbers: config.numbers ?? true,
    fold: config.fold ?? true,
    hebrewFinals: config.hebrewFinals ?? true,
  }

  const normalize = (raw: string): string => {
    let w = raw
    if (resolved.fold) w = w.normalize('NFKD').replace(/\p{M}+/gu, '')
    w = w.toLowerCase()
    if (resolved.hebrewFinals)
      w = w.replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c])
    return w
  }

  // The stopword list goes through the same normalization as the text, or a
  // folded "uber" would sail past an unfolded "über" in the list.
  const stopList =
    resolved.stopwords === 'none'
      ? []
      : Array.isArray(resolved.stopwords)
        ? resolved.stopwords
        : (STOPWORDS[resolved.locale] ?? STOPWORDS.en)
  const stopwords = new Set(stopList.map(normalize))

  const word = resolved.numbers ? WORD_WITH_NUMBERS : WORD_LETTERS_ONLY

  function spans(text: string): Span[] {
    const out: Span[] = []
    for (const m of text.matchAll(word)) {
      const start = m.index
      let end = start + m[0].length
      // Trim apostrophes off the ends (a leading one can't occur — the first
      // character class excludes it — but a trailing one can).
      while (end > start && APOSTROPHES.includes(text[end - 1])) end--
      // Fold a possessive onto its noun: "Case's" → "case".
      if (
        end - start > 2 &&
        APOSTROPHES.includes(text[end - 2]) &&
        (text[end - 1] === 's' || text[end - 1] === 'S')
      ) {
        end -= 2
      }
      if (end <= start) continue
      const token = normalize(text.slice(start, end))
      if (!token) continue
      // A lone Latin letter is noise ("a", a stray "s"); a lone letter of any
      // other script is a word in its own right (a Hebrew letter, a Greek
      // symbol) and a lone digit is a number. Only the first is dropped.
      if (token.length === 1 && /\p{Script=Latin}/u.test(token)) continue
      if (stopwords.has(token)) continue
      out.push({ token, start, end })
    }
    return out
  }

  return {
    config: resolved,
    spans,
    tokenize: (text) => spans(text).map((s) => s.token),
  }
}
