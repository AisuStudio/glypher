export type CharacterSet = {
  id: string;
  label: string;
  chars: string[];
};

const LATIN_BASIC: string[] = [
  ..."abcdefghijklmnopqrstuvwxyz".split(""),
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
];

// Common accented Latin letters used across Central European languages —
// Polish, Czech, Slovak, Hungarian, German, Croatian, Romanian. Not a strict
// ISO-8859-2/Latin-2 reproduction, just the diacritics that actually show up
// across those languages' alphabets.
const CENTRAL_EUROPEAN_EXTRA: string[] = [
  // Polish
  "ą", "Ą", "ć", "Ć", "ę", "Ę", "ł", "Ł", "ń", "Ń", "ó", "Ó", "ś", "Ś", "ź", "Ź", "ż", "Ż",
  // Czech / Slovak
  "č", "Č", "ď", "Ď", "ě", "Ě", "ň", "Ň", "ř", "Ř", "š", "Š", "ť", "Ť", "ů", "Ů", "ž", "Ž",
  "ĺ", "Ĺ", "ŕ", "Ŕ",
  // Hungarian
  "ő", "Ő", "ű", "Ű",
  // German
  "ä", "Ä", "ö", "Ö", "ü", "Ü", "ß",
  // Acutes shared across several Central European languages
  "á", "Á", "é", "É", "í", "Í", "ú", "Ú", "ý", "Ý",
  // Croatian / Romanian
  "đ", "Đ", "â", "Â", "ă", "Ă", "î", "Î", "ş", "Ş", "ţ", "Ţ",
];

// Accented Latin letters for French, Spanish, Portuguese, and Scandinavian —
// like CENTRAL_EUROPEAN_EXTRA, not a strict codepage reproduction. Excludes
// anything already covered above: á/é/í/ó/ú/ý (+ uppercase), ä/ö/ü/ß, and
// â/î (+ uppercase) all come from CENTRAL_EUROPEAN_EXTRA already.
const WESTERN_EUROPEAN_EXTRA: string[] = [
  // French
  "à", "À", "è", "È", "ê", "Ê", "ë", "Ë", "ï", "Ï", "ô", "Ô", "û", "Û", "ù", "Ù", "ÿ", "Ÿ", "ç", "Ç",
  // Spanish
  "ñ", "Ñ",
  // Portuguese
  "ã", "Ã", "õ", "Õ",
  // Scandinavian
  "å", "Å", "ø", "Ø", "æ", "Æ",
];

const NUMBERS: string[] = "0123456789".split("");

// Common punctuation actually needed for handwritten text — not an
// exhaustive symbol set, just what shows up in ordinary sentences. Brackets
// and ellipsis added alongside Symbols below, since both round out
// "ordinary sentence" coverage the same way.
const PUNCTUATION: string[] = [
  ".", ",", "!", "?", ":", ";",
  "'", "‘", "’", "\"", "“", "”",
  "-", "–", "—", "…",
  "(", ")", "[", "]", "{", "}", "/", "&", "@",
];

// Currency and basic math — the highest-frequency symbols outside of
// letters/figures/punctuation proper. Not an exhaustive symbol catalogue
// (no Glyphs-style Oldstyle/Tabular/Fullwidth variants — those mean drawing
// a whole second alphabet in a different style, out of scope for beta).
const SYMBOLS: string[] = [
  // Currency
  "€", "£", "$", "¥", "¢",
  // Math
  "+", "−", "×", "÷", "=", "<", ">", "%", "‰", "°",
];

// Add more sets here (e.g. Cyrillic) as their own entry — the grid UI picks
// up any set added to this list automatically.
export const CHARACTER_SETS: CharacterSet[] = [
  { id: "latin-basic", label: "Latin Basic", chars: LATIN_BASIC },
  { id: "central-european", label: "Central European", chars: CENTRAL_EUROPEAN_EXTRA },
  { id: "western-european", label: "Western European", chars: WESTERN_EUROPEAN_EXTRA },
  { id: "numbers", label: "Numbers", chars: NUMBERS },
  { id: "punctuation", label: "Punctuation", chars: PUNCTUATION },
  { id: "symbols", label: "Symbols", chars: SYMBOLS },
];

export const DEFAULT_CHARACTER_SET_IDS = ["latin-basic", "central-european", "numbers", "punctuation"];
