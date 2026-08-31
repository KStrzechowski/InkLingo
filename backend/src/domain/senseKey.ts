// The system's identity rule for a meaning.
//
// This replaces `sameMeaning` (`extension/src/popup/App.tsx:36-38`) as the
// authority: the popup keeps a copy, per this repo's no-shared-package
// convention, but the comparison is defined here.
//
// Deliberately the same weak `trim().toLowerCase()` comparison the popup
// already used — chosen for continuity, not because it is right. Under it
// "budowla obronna" and "budowla" are two different meanings, and nothing
// notices. That is a known limit
// (`02-invariant-aggregate-refactor.md` § 5.9), and it is the **named seam**
// IL-24 plugs into: the English-hub pivot keys concepts on an Interlingual
// Index, and `entry_senses` is the per-entry projection of what becomes a
// global `concepts` row.
//
// Phase 3's migration carries a **frozen inline copy** of this function rather
// than importing it. A migration must keep producing what it produced the day
// it ran, and IL-24 will redefine what a sense key is; an import would silently
// rewrite history the next time the definition moves.

export function senseKey (glossText: string): string {
  return glossText.trim().toLowerCase()
}
