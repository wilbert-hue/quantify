/**
 * Cleans OCR / encoding artifacts from labels before storage or CSV export.
 * Fixes mojibake like "Â©" (misread bullets) and bullet-as-"o" patterns.
 */
const BULLET_AND_SYMBOL =
  /[\u2022\u2023\u2043\u2219\u25AA\u25AB\u25CF\u25E6\u25CB\u25A0\u00B7\u2027\u2013\u2014\u2192\u2794\uFEFF\u00AE\u00A9\u00BB\u00AB\u2028\u2029]/g;

const MOJIBAKE_PATTERNS: [RegExp, string][] = [
  [/Â©/g, ""],
  [/Â®/g, ""],
  [/Â°/g, ""],
  [/Â\*/g, ""],
  [/Â·/g, ""],
  [/â€¢/g, ""],
  [/â„¢/g, ""],
  [/â€"/g, "-"],
  [/â€"/g, "-"],
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€œ/g, '"'],
  [/â€\u009d/g, '"'],
  [/Ã©/g, "e"],
  [/Ã¯/g, "i"],
  [/Ã¼/g, "u"],
  [/Ã¶/g, "o"],
  [/Ã¤/g, "a"],
  [/Ã±/g, "n"],
  [/Ã /g, " "],
  [/Ã./g, ""],
];

/** OCR often reads "• Online" as "o Online" or "Â© Online". */
const OCR_BULLET_O = /(?:^|\s)o\s+(?=[A-Z(])/g;

export function sanitizeDisplayText(text: string): string {
  if (!text) return "";

  let cleaned = text.normalize("NFC");

  for (const [pattern, replacement] of MOJIBAKE_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }

  cleaned = cleaned.replace(BULLET_AND_SYMBOL, "");
  cleaned = cleaned.replace(OCR_BULLET_O, " ");
  cleaned = cleaned.replace(/^[•\-\*\u2022\u2013\u2014→>\s=]+/, "");
  cleaned = cleaned.replace(/\u00A0/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned;
}

export function sanitizeHierarchyFields(fields: {
  region?: string;
  segment?: string;
  subSegment?: string;
  subSegment1?: string;
  subSegment2?: string;
}): {
  region: string;
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
} {
  return {
    region: sanitizeDisplayText(fields.region ?? ""),
    segment: sanitizeDisplayText(fields.segment ?? ""),
    subSegment: sanitizeDisplayText(fields.subSegment ?? ""),
    subSegment1: sanitizeDisplayText(fields.subSegment1 ?? ""),
    subSegment2: sanitizeDisplayText(fields.subSegment2 ?? ""),
  };
}
