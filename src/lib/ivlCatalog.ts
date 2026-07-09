/**
 * Segment parsing utilities — all output is driven by uploaded file content.
 */
import { sanitizeDisplayText } from "./textSanitizer";
import { countKnownGeoNames, isValidGeoDefinition } from "./regions";

export interface SegmentDefinition {
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
}

export const MAIN_SEGMENT_TYPES = [
  "By Product Type",
  "By Application",
  "By Technology",
  "By Age Group",
  "By End User",
  "By End-Use Industry",
  "By End Use Industry",
  "By End Use",
  "By Region",
  "By Country",
  "By Installation Type",
  "By Installation",
  "By Price Range",
  "By Component",
  "By Distribution Channel",
  "By Material Type",
  "By Service Type",
  "By Revenue Model",
  "By Power Source",
  "By Working Height",
  "By Platform Capacity",
  "By Well Type",
  "By Well Location",
] as const;

export type MainSegmentType = (typeof MAIN_SEGMENT_TYPES)[number];

const SEGMENT_HEADER_RE = /\bBy\s+(?:[A-Z][A-Za-z-]*(?:\s+[A-Z][A-Za-z-]*){0,4})/g;

export function extractSegmentHeaders(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const candidates: { seg: string; index: number }[] = [];

  for (const seg of MAIN_SEGMENT_TYPES) {
    const index = normalized.toLowerCase().indexOf(seg.toLowerCase());
    if (index >= 0) candidates.push({ seg, index });
  }

  SEGMENT_HEADER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEGMENT_HEADER_RE.exec(normalized)) !== null) {
    const seg = match[0].replace(/\s+/g, " ").trim();
    if (!candidates.some((c) => c.seg.toLowerCase() === seg.toLowerCase())) {
      candidates.push({ seg, index: match.index });
    }
  }

  candidates.sort((a, b) => a.index - b.index);

  const found: string[] = [];
  const seen = new Set<string>();
  for (const { seg } of candidates) {
    const key = seg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(seg);
  }

  return found;
}

export function isValidMainSegment(segment: string): boolean {
  const trimmed = segment.trim();
  return /^By\s+[A-Za-z]/i.test(trimmed) && trimmed.length > 4;
}

export function normalizeSegmentKey(segment: string): string {
  const trimmed = segment.replace(/\s+/g, " ").trim();
  const headers = extractSegmentHeaders(trimmed);
  if (headers.length >= 1) return headers[0];

  if (isValidMainSegment(trimmed)) return trimmed;

  const match = trimmed.match(/^By\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,4}$/i);
  return match ? match[0].trim() : trimmed;
}

function cleanLabel(text: string): string {
  return sanitizeDisplayText(text);
}

function dedupeRepeatedPhrase(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^(.+?)\s+\1$/i);
  return match ? match[1].trim() : trimmed;
}

export function stripSegmentPrefix(text: string, segment?: string): string {
  let cleaned = cleanLabel(text);
  for (const seg of extractSegmentHeaders(cleaned)) {
    cleaned = cleaned.replace(new RegExp(`^${escapeRegex(seg)}\\s*`, "i"), "");
  }
  if (segment) {
    cleaned = cleaned.replace(new RegExp(`^${escapeRegex(segment)}\\s*`, "i"), "");
  }
  return dedupeRepeatedPhrase(cleaned.trim());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripForeignSegmentContent(label: string, segment: string): string {
  let cleaned = stripSegmentPrefix(label, segment);
  for (const seg of extractSegmentHeaders(cleaned)) {
    if (seg.toLowerCase() === segment.toLowerCase()) continue;
    cleaned = cleaned.replace(new RegExp(escapeRegex(seg), "gi"), " ");
  }
  return cleanLabel(cleaned);
}

/** Resolve the segment column from OCR text — uses uploaded headers only. */
export function resolveSegmentForRow(
  segment: string,
  subSegment: string,
  subSegment1: string,
  subSegment2: string
): string | null {
  const headers = extractSegmentHeaders(segment);
  if (headers.length === 1) return headers[0];

  const normalized = normalizeSegmentKey(segment);
  if (isValidMainSegment(normalized) && headers.length <= 1) {
    return normalized;
  }

  if (headers.length > 1) return headers[0];

  if (isValidMainSegment(segment.trim())) return segment.trim();

  return null;
}

function resolveSegmentDefinition(def: SegmentDefinition): SegmentDefinition | null {
  const segment = resolveSegmentForRow(
    def.segment,
    def.subSegment,
    def.subSegment1,
    def.subSegment2
  );
  if (!segment) return null;

  const subSegment = stripForeignSegmentContent(def.subSegment ?? "", segment);
  const subSegment1 = stripForeignSegmentContent(def.subSegment1 ?? "", segment);
  const subSegment2 = stripForeignSegmentContent(def.subSegment2 ?? "", segment);

  if (!subSegment || !subSegment1 || !subSegment2) return null;
  if (subSegment.startsWith("By ") || subSegment.includes("#NAME")) return null;
  if (extractSegmentHeaders(subSegment).length > 0) return null;
  if (
    /^(north america|europe|asia pacific|u\.s\.|canada)$/i.test(subSegment) &&
    segment !== "By Region" &&
    segment !== "By Country"
  ) {
    return null;
  }
  if (
    segment !== "By Region" &&
    segment !== "By Country" &&
    countKnownGeoNames(subSegment) >= 2
  ) {
    return null;
  }

  const resolved = {
    segment,
    subSegment: cleanLabel(subSegment),
    subSegment1: cleanLabel(subSegment1),
    subSegment2: cleanLabel(subSegment2),
  };

  if (!isValidGeoDefinition(resolved)) return null;

  return resolved;
}

export function toSegmentDefinition(row: {
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
}): SegmentDefinition | null {
  return resolveSegmentDefinition({
    segment: row.segment,
    subSegment: row.subSegment,
    subSegment1: row.subSegment1,
    subSegment2: row.subSegment2,
  });
}

/** Build segment list from uploads only — never injects a default catalog. */
export function mergeSegmentCatalogs(parsed: SegmentDefinition[]): SegmentDefinition[] {
  const resolved: SegmentDefinition[] = [];
  const seen = new Set<string>();

  for (const def of parsed) {
    const row = resolveSegmentDefinition(def);
    if (!row) continue;
    const key = catalogKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(row);
  }

  return resolved;
}

function catalogKey(def: SegmentDefinition): string {
  return [def.segment, def.subSegment, def.subSegment1, def.subSegment2].join("|");
}
