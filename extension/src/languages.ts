// Display labels only — the backend owns which codes are actually supported
// (backend/src/languages.ts). Mirrors frontend/src/languages.ts rather than
// sharing it: this repo has no shared package between its apps, the same
// reason types.ts duplicates the response shapes.
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  pl: 'Polish',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  uk: 'Ukrainian'
}

// Falls back to the uppercased code so a collection configured with a code
// this map doesn't know still renders something readable.
export function languageLabel (code: string): string {
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code.toUpperCase()
}
