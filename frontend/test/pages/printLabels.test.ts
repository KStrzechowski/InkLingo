import { describe, expect, it } from 'vitest'
import { printLabels, printLanguageNamer } from '../../src/pages/printLabels'
import { SUPPORTED_LANGUAGES } from '../../src/languages'

// The printed sheet's furniture — column headings and language names — is in
// the collection's native language, because it is a study aid for someone
// reading *into* the target languages. LABELS is a hand-maintained mirror of
// SUPPORTED_LANGUAGES with nothing linking the two, so a newly supported
// language silently prints English headings on a native-language sheet.

const ENGLISH = printLabels('en')

describe('printLabels covers every supported language', () => {
  for (const { code, label } of SUPPORTED_LANGUAGES) {
    it(`has its own column headings for ${label} (${code})`, () => {
      const labels = printLabels(code)

      for (const [field, value] of Object.entries(labels)) {
        expect(value, `printLabels('${code}').${field} is empty`).not.toBe('')
      }

      if (code !== 'en') {
        expect(
          labels,
          `'${code}' is in SUPPORTED_LANGUAGES but has no entry in printLabels' LABELS table, ` +
          'so a native-language sheet would be headed in English. Add one.'
        ).not.toEqual(ENGLISH)
      }
    })
  }
})

describe('printLabels', () => {
  it('resolves a legacy uppercase native code to its native headings', () => {
    // One dev collection still carries an uppercase 'PL' from before
    // write-time normalization.
    expect(printLabels('PL')).toEqual(printLabels('pl'))
    expect(printLabels('PL').word).toBe('Słowo')
  })

  it('falls back to English for an unsupported code', () => {
    expect(printLabels('ja')).toEqual(ENGLISH)
  })

  it('falls back to English for a malformed code rather than throwing', () => {
    expect(printLabels('not a tag!!')).toEqual(ENGLISH)
  })
})

describe('printLanguageNamer', () => {
  it('names target languages in the native language', () => {
    const inPolish = printLanguageNamer('pl')

    expect(inPolish('en')).toBe('angielski')
    expect(inPolish('de')).toBe('niemiecki')
  })

  it('keeps each language its own orthography', () => {
    // Polish lower-cases language names by rule; German capitalises them.
    // Hand-writing a 64-entry table is what Intl.DisplayNames avoids.
    expect(printLanguageNamer('pl')('en')).toBe('angielski')
    expect(printLanguageNamer('de')('en')).toBe('Englisch')
  })

  it('resolves a legacy uppercase native code, since Intl canonicalises case', () => {
    expect(printLanguageNamer('PL')('en')).toBe(printLanguageNamer('pl')('en'))
  })

  it('resolves a legacy uppercase target code', () => {
    expect(printLanguageNamer('pl')('EN')).toBe('angielski')
  })

  it('falls back to the English label when the native code is malformed', () => {
    // The constructor throws on a malformed native tag — the same input
    // printLabels falls back to English for, so the two stay consistent.
    expect(printLanguageNamer('not a tag!!')('en')).toBe('English')
  })

  it('falls back to the English label when the target code is malformed', () => {
    // `.of()` throws on a malformed primary subtag; languageLabel uppercases
    // anything it does not know rather than rendering blank.
    expect(printLanguageNamer('pl')('not a tag!!')).toBe('NOT A TAG!!')
  })

  it('names every supported target language for every supported native language', () => {
    // All 8 x 8 combinations resolve to something non-empty — the set the
    // Language column is sized for.
    for (const native of SUPPORTED_LANGUAGES) {
      const namer = printLanguageNamer(native.code)
      for (const target of SUPPORTED_LANGUAGES) {
        const name = namer(target.code)
        expect(name, `${native.code} -> ${target.code}`).toBeTruthy()
      }
    }
  })
})
