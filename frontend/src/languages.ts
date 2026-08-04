export interface Language {
  code: string
  label: string
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', label: 'English' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'uk', label: 'Ukrainian' }
]

// Matched case-insensitively, and falls back to the uppercased code, so the
// pre-normalization uppercase codes still in the database ('PL', 'EN') render
// something readable instead of blank. Mirrors extension/src/languages.ts
// rather than sharing it: this repo has no shared package between its apps
// (see CLAUDE.md's Architecture section).
export function languageLabel (code: string): string {
  const match = SUPPORTED_LANGUAGES.find((language) => language.code === code.toLowerCase())
  return match?.label ?? code.toUpperCase()
}
