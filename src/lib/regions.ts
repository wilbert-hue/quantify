/** Known geography labels used to split OCR lines and validate geo rows. */
export const KNOWN_GEO_NAMES = [
  "Global",
  "North America",
  "U.S.",
  "Canada",
  "Europe",
  "U.K.",
  "Germany",
  "Italy",
  "France",
  "Spain",
  "Russia",
  "Netherlands",
  "Ireland",
  "Sweden",
  "Poland",
  "Hungary",
  "Slovakia",
  "Turkey",
  "Rest of Europe",
  "Asia Pacific",
  "China",
  "Japan",
  "India",
  "South Korea",
  "ASEAN",
  "Singapore",
  "Malaysia",
  "Thailand",
  "Indonesia",
  "Rest of ASEAN",
  "Australia",
  "Rest of Asia Pacific",
  "Latin America",
  "Brazil",
  "Argentina",
  "Mexico",
  "Rest of Latin America",
  "Middle East & Africa",
  "GCC",
  "South Africa",
  "Rest of Middle East & Africa",
  "Central Africa",
  "Central America",
  "Caribbean",
  "Africa",
  "Middle East",
] as const;

const SORTED_BY_LENGTH = [...KNOWN_GEO_NAMES].sort((a, b) => b.length - a.length);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count how many known geography names appear in a string. */
export function countKnownGeoNames(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const name of KNOWN_GEO_NAMES) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
    if (re.test(lower)) count++;
  }
  return count;
}

/** Extract individual geography names from OCR text (longest match first). */
export function extractGeoNamesFromText(text: string): string[] {
  const found: string[] = [];
  let remaining = text;
  const used = new Set<string>();

  for (const name of SORTED_BY_LENGTH) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "gi");
    if (!re.test(remaining)) continue;
    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    found.push(name);
    remaining = remaining.replace(re, " ");
  }

  return found;
}

export function isSingleGeoName(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 50) return false;
  if (countKnownGeoNames(trimmed) >= 2) return false;
  if (KNOWN_GEO_NAMES.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return true;
  return countKnownGeoNames(trimmed) === 0 && trimmed.length <= 40 && !/\bby\s+/i.test(trimmed);
}

export function isValidGeoDefinition(def: {
  segment: string;
  subSegment: string;
}): boolean {
  if (def.segment !== "By Region" && def.segment !== "By Country") return true;
  return isSingleGeoName(def.subSegment);
}
