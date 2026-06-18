import {
  MAIN_SEGMENT_TYPES,
  extractSegmentHeaders,
  isValidMainSegment,
  stripSegmentPrefix,
  toSegmentDefinition,
  type SegmentDefinition,
} from "./ivlCatalog";
import {
  countKnownGeoNames,
  extractGeoNamesFromText,
  isSingleGeoName,
  isValidGeoDefinition,
} from "./regions";
import { sanitizeDisplayText } from "./textSanitizer";
import { emptyYearValues } from "./types";
import type { ExtractedRow, UploadCategory } from "./types";
import type { OcrLine } from "./ocr";

function cleanLine(text: string): string {
  return sanitizeDisplayText(text);
}

function isTitle(line: string): boolean {
  return /\bMARKET\b/i.test(line) && line.length > 12;
}

function isSegmentHeader(line: string): boolean {
  return extractSegmentHeaders(cleanLine(line)).length > 0;
}

function isNonGeoSegmentHeader(segment: string): boolean {
  return segment !== "By Region" && segment !== "By Country";
}

function isLikelyChild(child: string, parent: string): boolean {
  if (isSegmentHeader(child) || isTitle(child)) return false;
  if (/^(public|private)$/i.test(child) && /hospital/i.test(parent)) return true;
  if (
    /calcified|severely|coronary|peripheral|selected|underexpanded|iliac|femoral|infrapopliteal|renal|left main|stent/i.test(
      child
    )
  ) {
    return true;
  }
  if (/^(offline|online)$/i.test(child) && /^b2c$/i.test(parent.trim())) return true;
  if (
    /buildings|facilities|complexes|infrastructure|institutions|stores|websites|utilities|transit|healthcare|education|hospitality|recreation|civic|sanitary|e-?commerce|owned websites|third party/i.test(
      child
    )
  ) {
    return true;
  }
  if (/users|residential|channel|^b2b$|^b2c$/i.test(parent) && child.length >= 4 && child.length < 80) {
    return true;
  }
  return parent.length > child.length + 4 && child.length >= 4 && child.length < 80;
}

function makeDefinition(
  segment: string,
  subSegment: string,
  subSegment1: string,
  subSegment2: string
): SegmentDefinition {
  return { segment, subSegment, subSegment1, subSegment2 };
}

function cleanHierarchyLabel(text: string, segment: string): string {
  return stripSegmentPrefix(cleanLine(text), segment);
}

function flatRow(segment: string, label: string): SegmentDefinition {
  const cleaned = cleanHierarchyLabel(label, segment);
  if (!cleaned || extractSegmentHeaders(cleaned).length > 0) {
    return makeDefinition(segment, "", "", "");
  }
  return makeDefinition(segment, cleaned, cleaned, cleaned);
}

function parentChildRow(segment: string, parent: string, child: string): SegmentDefinition {
  const cleanedParent = cleanHierarchyLabel(parent, segment);
  const cleanedChild = cleanHierarchyLabel(child, segment);
  return makeDefinition(segment, cleanedParent, cleanedChild, cleanedChild);
}

function threeLevelRow(
  segment: string,
  level1: string,
  level2: string,
  level3: string
): SegmentDefinition {
  return makeDefinition(
    segment,
    cleanHierarchyLabel(level1, segment),
    cleanHierarchyLabel(level2, segment),
    cleanHierarchyLabel(level3, segment)
  );
}

interface SectionHeader {
  segment: string;
  y: number;
}

function findVerticalSectionHeaders(lines: OcrLine[]): SectionHeader[] {
  const headers: SectionHeader[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const text = cleanLine(line.text);
    if (!text || isTitle(text)) continue;

    for (const seg of extractSegmentHeaders(text)) {
      if (!isNonGeoSegmentHeader(seg)) continue;
      if (!MAIN_SEGMENT_TYPES.includes(seg as (typeof MAIN_SEGMENT_TYPES)[number])) continue;
      const key = seg.toLowerCase();
      if (seen.has(key)) continue;

      const isHeaderLine =
        text.toLowerCase() === seg.toLowerCase() ||
        text.length <= seg.length + 20 ||
        /^by\s+/i.test(text);

      if (isHeaderLine) {
        seen.add(key);
        headers.push({ segment: seg, y: line.y0 });
      }
    }
  }

  return headers.sort((a, b) => a.y - b.y);
}

function lineDepth(line: OcrLine, baseX: number): number {
  const rel = line.x0 - baseX;
  if (rel < 28) return 0;
  if (rel < 75) return 1;
  return 2;
}

function parseSectionHierarchy(lines: OcrLine[], segment: string): SegmentDefinition[] {
  const content = lines
    .filter((l) => {
      const text = cleanLine(l.text);
      return text.length > 1 && !isTitle(text) && !isSegmentHeader(text);
    })
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  if (content.length === 0) return [];

  const baseX = Math.min(...content.map((l) => l.x0));
  const defs: SegmentDefinition[] = [];
  let depth0: string | null = null;
  let depth1: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const line = content[i];
    const text = cleanHierarchyLabel(line.text, segment);
    if (!text) continue;

    const depth = lineDepth(line, baseX);
    const nextDepth =
      i + 1 < content.length ? lineDepth(content[i + 1], baseX) : -1;

    if (depth === 0) {
      depth0 = text;
      depth1 = null;
      if (nextDepth !== 1 && nextDepth !== 2) {
        defs.push(flatRow(segment, text));
        depth0 = null;
      }
      continue;
    }

    if (depth === 1) {
      depth1 = text;
      if (depth0 && nextDepth !== 2) {
        defs.push(parentChildRow(segment, depth0, text));
        depth1 = null;
      } else if (!depth0) {
        defs.push(flatRow(segment, text));
        depth1 = null;
      }
      continue;
    }

    if (depth === 2) {
      if (depth0 && depth1) {
        defs.push(threeLevelRow(segment, depth0, depth1, text));
      } else if (depth1) {
        defs.push(parentChildRow(segment, depth1, text));
      } else if (depth0) {
        defs.push(parentChildRow(segment, depth0, text));
      } else {
        defs.push(flatRow(segment, text));
      }
      depth1 = null;
    }
  }

  return defs;
}

function parseByVerticalSections(lines: OcrLine[]): SegmentDefinition[] {
  const headers = findVerticalSectionHeaders(lines);
  if (headers.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a.y0 - b.y0);
  const defs: SegmentDefinition[] = [];

  for (let i = 0; i < headers.length; i++) {
    const { segment, y } = headers[i];
    const nextY = headers[i + 1]?.y ?? Number.POSITIVE_INFINITY;
    const sectionLines = sorted.filter((l) => l.y0 > y + 2 && l.y0 < nextY - 2);
    defs.push(...parseSectionHierarchy(sectionLines, segment));
  }

  return defs;
}

interface ColumnAnchor {
  segment: string;
  x: number;
}

function findHeaderAnchors(lines: OcrLine[]): ColumnAnchor[] {
  let best: ColumnAnchor[] = [];

  for (const line of lines) {
    const text = cleanLine(line.text);
    const headers = extractSegmentHeaders(text).filter(isNonGeoSegmentHeader);
    if (headers.length < 2) continue;

    const anchors: ColumnAnchor[] = [];
    for (const seg of headers) {
      const idx = text.toLowerCase().indexOf(seg.toLowerCase());
      if (idx < 0) continue;
      const ratio = idx / Math.max(text.length, 1);
      const x = line.x0 + (line.x1 - line.x0) * ratio + seg.length * 2;
      anchors.push({ segment: seg, x });
    }

    if (anchors.length > best.length) {
      best = anchors.sort((a, b) => a.x - b.x);
    }
  }

  if (best.length >= 2) return best;

  const headerLines = lines.filter((l) => isSegmentHeader(l.text));
  if (headerLines.length >= 2) {
    return headerLines
      .map((line) => {
        const text = cleanLine(line.text);
        const headers = extractSegmentHeaders(text).filter(isNonGeoSegmentHeader);
        return {
          segment: headers[0] ?? text,
          x: (line.x0 + line.x1) / 2,
        };
      })
      .filter((a) => isValidMainSegment(a.segment))
      .sort((a, b) => a.x - b.x);
  }

  return best;
}

function partitionByAnchors(
  lines: OcrLine[],
  anchors: ColumnAnchor[]
): { segment: string; lines: OcrLine[] }[] {
  const sorted = [...anchors].sort((a, b) => a.x - b.x);
  const thresholds: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    thresholds.push((sorted[i].x + sorted[i + 1].x) / 2);
  }

  const buckets: OcrLine[][] = Array.from({ length: sorted.length }, () => []);
  for (const line of lines) {
    const cx = (line.x0 + line.x1) / 2;
    let col = 0;
    while (col < thresholds.length && cx > thresholds[col]) col++;
    buckets[col].push(line);
  }

  return sorted.map((anchor, i) => ({
    segment: anchor.segment,
    lines: buckets[i].sort((a, b) => a.y0 - b.y0),
  }));
}

function parseColumnLines(lines: string[], fixedSegment?: string): SegmentDefinition[] {
  const defs: SegmentDefinition[] = [];
  let segment = fixedSegment ?? "";

  for (let i = 0; i < lines.length; i++) {
    const line = cleanLine(lines[i]);
    if (!line || isTitle(line)) continue;

    const headers = extractSegmentHeaders(line).filter(isNonGeoSegmentHeader);
    if (headers.length === 1) {
      segment = headers[0];
      continue;
    }
    if (headers.length > 1) continue;

    if (isSegmentHeader(line)) continue;
    if (!segment || segment === "By Region" || segment === "By Country") continue;

    const next = cleanLine(lines[i + 1] ?? "");
    if (next && isLikelyChild(next, line)) {
      const parent = cleanHierarchyLabel(line, segment);
      if (!parent) continue;
      i++;
      while (i < lines.length) {
        const child = cleanHierarchyLabel(lines[i], segment);
        if (!child || isSegmentHeader(lines[i]) || isTitle(lines[i])) break;
        if (!isLikelyChild(child, parent)) break;
        defs.push(parentChildRow(segment, parent, child));
        i++;
      }
      i--;
      continue;
    }

    const label = cleanHierarchyLabel(line, segment);
    if (label && extractSegmentHeaders(label).length === 0) {
      defs.push(flatRow(segment, label));
    }
  }

  return defs;
}

function clusterLinesByColumn(lines: OcrLine[]): OcrLine[][] {
  if (lines.length === 0) return [];

  const withCenter = lines.map((l) => ({ ...l, cx: (l.x0 + l.x1) / 2 }));
  withCenter.sort((a, b) => a.cx - b.cx);

  const span = withCenter[withCenter.length - 1].cx - withCenter[0].cx;
  if (span < 80) return [withCenter.sort((a, b) => a.y0 - b.y0)];

  const gaps: { gap: number; after: number }[] = [];
  for (let i = 0; i < withCenter.length - 1; i++) {
    gaps.push({ gap: withCenter[i + 1].cx - withCenter[i].cx, after: i });
  }
  gaps.sort((a, b) => b.gap - a.gap);

  const splitCount = Math.min(2, gaps.filter((g) => g.gap > span * 0.12).length);
  const splitIndices = gaps.slice(0, splitCount).map((g) => g.after).sort((a, b) => a - b);

  const columns: OcrLine[][] = [];
  let start = 0;
  for (const idx of splitIndices) {
    columns.push(withCenter.slice(start, idx + 1));
    start = idx + 1;
  }
  columns.push(withCenter.slice(start));

  return columns.map((col) => col.sort((a, b) => a.y0 - b.y0));
}

function parseGeographyLines(lines: string[]): SegmentDefinition[] {
  const defs: SegmentDefinition[] = [];
  let segment: "By Region" | "By Country" | null = null;

  for (const raw of lines) {
    const line = cleanLine(raw);
    if (!line || isTitle(line)) continue;

    if (/^By\s+Region/i.test(line)) {
      segment = "By Region";
      const rest = stripSegmentPrefix(line, "By Region");
      if (rest && !/^By\s+/i.test(rest) && isSingleGeoName(rest)) {
        defs.push(flatRow(segment, rest));
      }
      continue;
    }
    if (/^By\s+Country/i.test(line)) {
      segment = "By Country";
      const rest = stripSegmentPrefix(line, "By Country");
      if (rest && !/^By\s+/i.test(rest) && isSingleGeoName(rest)) {
        defs.push(flatRow(segment, rest));
      }
      continue;
    }

    if (!segment) continue;

    const geoSegment = segment;
    const extracted = extractGeoNamesFromText(line);
    if (extracted.length > 0) {
      for (const name of extracted) {
        defs.push(flatRow(geoSegment, name));
      }
      continue;
    }

    const parts = line
      .split(/[•\u2022]|(?:\s+-\s+)|(?:\s{2,})/)
      .map((part) => cleanHierarchyLabel(part, geoSegment))
      .filter((p) => p.length > 1 && extractSegmentHeaders(p).length === 0);

    for (const part of parts) {
      if (isSingleGeoName(part)) {
        defs.push(flatRow(geoSegment, part));
      }
    }
  }

  return defs.filter((d) => d.subSegment.length > 0 && isValidGeoDefinition(d));
}

function hasNonGeoSegmentContent(text: string): boolean {
  return extractSegmentHeaders(text).some(isNonGeoSegmentHeader);
}

function filterValidDefinitions(defs: SegmentDefinition[]): SegmentDefinition[] {
  return defs
    .map((d) => toSegmentDefinition(d))
    .filter((d): d is SegmentDefinition => d != null)
    .filter((d) => {
      if (d.segment === "By Region" || d.segment === "By Country") {
        return isValidGeoDefinition(d);
      }
      return countKnownGeoNames(d.subSegment) <= 1;
    });
}

function definitionsToRows(defs: SegmentDefinition[], source: string): ExtractedRow[] {
  return defs.map((def, order) => ({
    region: "Global",
    segment: def.segment,
    subSegment: def.subSegment,
    subSegment1: def.subSegment1,
    subSegment2: def.subSegment2,
    values: emptyYearValues(),
    source,
    order,
    dataset: "value" as const,
  }));
}

function parseSegmentHierarchy(ocrText: string, usableLines: OcrLine[]): SegmentDefinition[] {
  const allDefs: SegmentDefinition[] = [];

  const sectionDefs = parseByVerticalSections(usableLines);
  if (sectionDefs.length > 0) {
    allDefs.push(...sectionDefs);
  }

  if (allDefs.length === 0) {
    const anchors = findHeaderAnchors(usableLines);

    if (anchors.length >= 2) {
      for (const { segment, lines } of partitionByAnchors(usableLines, anchors)) {
        allDefs.push(...parseSectionHierarchy(lines, segment));
        allDefs.push(...parseColumnLines(lines.map((l) => l.text), segment));
      }
    } else {
      const columns = clusterLinesByColumn(usableLines);
      for (const column of columns) {
        allDefs.push(...parseColumnLines(column.map((l) => l.text)));
      }
    }
  }

  if (allDefs.length === 0) {
    const discovered = extractSegmentHeaders(ocrText).filter(isNonGeoSegmentHeader);
    const segmentsToTry =
      discovered.length > 0
        ? discovered
        : MAIN_SEGMENT_TYPES.filter(isNonGeoSegmentHeader);

    for (const seg of segmentsToTry) {
      const pattern = new RegExp(`(?=${seg.replace(/\s+/g, "\\s+")})`, "i");
      const blocks = ocrText.split(pattern);
      for (const block of blocks) {
        if (!block.toLowerCase().includes(seg.toLowerCase())) continue;
        allDefs.push(...parseColumnLines(block.split(/\r?\n/), seg));
      }
    }
  }

  return allDefs;
}

export function parseHierarchyFromOcr(
  ocrText: string,
  ocrLines: OcrLine[],
  category: UploadCategory,
  sourceName: string
): ExtractedRow[] {
  const usableLines = ocrLines.filter((l) => cleanLine(l.text).length > 1);
  let allDefs: SegmentDefinition[] = [];

  const looksLikeSegmentSlide = hasNonGeoSegmentContent(ocrText);

  if (category === "geographies" && looksLikeSegmentSlide) {
    allDefs = parseSegmentHierarchy(ocrText, usableLines);
  } else if (category === "geographies") {
    allDefs = parseGeographyLines(usableLines.map((l) => l.text));
  } else {
    allDefs = parseSegmentHierarchy(ocrText, usableLines);
  }

  const valid = filterValidDefinitions(allDefs);
  return definitionsToRows(valid, sourceName);
}

export function hasNumericTableData(text: string): boolean {
  const yearHits = (text.match(/\b20(?:2[1-9]|3[0-3])\b/g) ?? []).length;
  return yearHits >= 4;
}
