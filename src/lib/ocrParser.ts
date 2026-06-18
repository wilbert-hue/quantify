import { resolveSegmentForRow } from "./ivlCatalog";
import { sanitizeHierarchyFields } from "./textSanitizer";
import {
  extractYearNumbersFromLine,
  looksLikeYearHeader,
  parseNumericToken,
} from "./formatters";
import { hasNumericTableData, parseHierarchyFromOcr } from "./hierarchyParser";
import type { OcrLine } from "./ocr";
import { assignNumbersToYears } from "./spreadsheetParser";
import { YEARS, emptyYearValues, type ExtractedRow, type UploadCategory } from "./types";

const KNOWN_REGIONS = [
  "Global", "North America", "U.S.", "Canada", "Europe", "U.K.", "Germany",
  "Italy", "France", "Spain", "Russia", "Netherlands", "Ireland", "Sweden",
  "Poland", "Hungary", "Slovakia", "Turkey", "Rest of Europe", "Asia Pacific",
  "China", "Japan", "India", "South Korea", "ASEAN", "Singapore", "Malaysia",
  "Thailand", "Indonesia", "Rest of ASEAN", "Australia", "Rest of Asia Pacific",
  "Latin America", "Brazil", "Argentina", "Mexico", "Rest of Latin America",
  "Middle East & Africa", "GCC", "South Africa", "Rest of Middle East & Africa",
] as const;

function detectRegion(text: string): string | null {
  const trimmed = text.trim();
  for (const region of KNOWN_REGIONS) {
    if (trimmed === region || trimmed.startsWith(`${region} `)) return region;
  }
  return null;
}

function splitColumns(text: string): string[] {
  if (text.includes("\t")) {
    return text.split("\t").map((s) => s.trim()).filter(Boolean);
  }
  return text.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
}

function splitTextAndNumbers(line: string): { textCols: string[]; numbers: number[] } {
  const regex = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g;
  const numbers: number[] = [];
  let firstNumIndex = -1;

  for (const match of line.matchAll(regex)) {
    const num = parseNumericToken(match[0]);
    if (num != null) {
      if (firstNumIndex === -1) firstNumIndex = match.index ?? -1;
      numbers.push(num);
    }
  }

  const textPart = firstNumIndex > 0 ? line.slice(0, firstNumIndex).trim() : line.trim();
  const textCols = splitColumns(textPart.replace(/\|/g, " "));

  return { textCols, numbers };
}

function buildRowFromParts(
  textCols: string[],
  numbers: number[],
  currentRegion: string,
  source: string,
  order: number,
  dataset: "value" | "volume" = "value"
): ExtractedRow | null {
  if (numbers.length < 3) return null;

  let region = currentRegion;
  let segment = "";
  let subSegment = "";
  let subSegment1 = "";
  let subSegment2 = "";

  if (textCols.length >= 5) {
    [region, segment, subSegment, subSegment1, subSegment2] = textCols;
  } else if (textCols.length === 4) {
    [region, segment, subSegment, subSegment2] = textCols;
    subSegment1 = subSegment2;
  } else if (textCols.length === 3) {
    [region, segment, subSegment2] = textCols;
    subSegment = textCols[1];
    subSegment1 = subSegment2;
  } else if (textCols.length === 2) {
    [segment, subSegment2] = textCols;
    subSegment = subSegment2;
    subSegment1 = subSegment2;
  } else if (textCols.length === 1) {
    subSegment2 = textCols[0];
    subSegment1 = subSegment2;
    subSegment = subSegment2;
    segment = "By Segment";
  } else {
    return null;
  }

  const regionHit = detectRegion(region);
  if (regionHit) region = regionHit;
  if (!region) region = currentRegion;

  subSegment2 = subSegment2 || subSegment1 || subSegment || segment;
  subSegment1 = subSegment1 || subSegment2;
  subSegment = subSegment || subSegment1;
  segment =
    resolveSegmentForRow(segment, subSegment, subSegment1, subSegment2) ??
    (segment || "By Segment");

  if (!subSegment2 || subSegment2.length < 2) return null;

  const cleaned = sanitizeHierarchyFields({
    region,
    segment,
    subSegment,
    subSegment1,
    subSegment2,
  });

  return {
    region: cleaned.region,
    segment: cleaned.segment,
    subSegment: cleaned.subSegment,
    subSegment1: cleaned.subSegment1,
    subSegment2: cleaned.subSegment2,
    values: assignNumbersToYears(numbers),
    source,
    order,
    dataset,
  };
}

function parseTableLines(
  lines: string[],
  category: UploadCategory,
  sourceName: string,
  dataset: "value" | "volume"
): ExtractedRow[] {
  const parsed: ExtractedRow[] = [];
  let currentRegion = "Global";
  let order = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || looksLikeYearHeader(line)) continue;

    const regionHit = detectRegion(line);
    if (regionHit && extractYearNumbersFromLine(line).length < 3) {
      currentRegion = regionHit;
      continue;
    }

    const { textCols, numbers } = splitTextAndNumbers(line);
    if (numbers.length < 3) continue;

    const row = buildRowFromParts(
      textCols.length ? textCols : [line.replace(/-?\d[\d,]*\.?\d*/g, "").trim()],
      numbers,
      currentRegion,
      sourceName,
      order,
      dataset
    );

    if (row) {
      parsed.push(row);
      order++;
    }
  }

  return parsed;
}

function mergeValues(target: ExtractedRow, source: ExtractedRow): void {
  for (const year of YEARS) {
    if (source.values[year] != null) target.values[year] = source.values[year];
  }
}

function mergeRowLists(rows: ExtractedRow[]): ExtractedRow[] {
  const merged = new Map<string, ExtractedRow>();
  for (const row of rows) {
    const key = [row.dataset, row.region, row.segment, row.subSegment, row.subSegment1, row.subSegment2].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
    } else {
      mergeValues(existing, row);
    }
  }
  return [...merged.values()].sort((a, b) => a.order - b.order);
}

export function parseOcrText(
  text: string,
  category: UploadCategory,
  sourceName: string,
  ocrLines: OcrLine[] = []
): ExtractedRow[] {
  const dataset: "value" | "volume" = /volume/i.test(sourceName) ? "volume" : "value";
  const hierarchyRows = parseHierarchyFromOcr(text, ocrLines, category, sourceName);

  if (!hasNumericTableData(text)) {
    return hierarchyRows;
  }

  const tableRows = parseTableLines(text.split(/\r?\n/), category, sourceName, dataset);

  if (tableRows.length === 0) return hierarchyRows;
  if (hierarchyRows.length === 0) return tableRows;

  return mergeRowLists([...hierarchyRows, ...tableRows]);
}

export function mergeExtractedRows(existing: ExtractedRow[], incoming: ExtractedRow[]): ExtractedRow[] {
  const byKey = new Map<string, ExtractedRow>();
  let order = 0;

  for (const row of [...existing, ...incoming]) {
    const key = [row.dataset, row.region, row.segment, row.subSegment, row.subSegment1, row.subSegment2].join("|");
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...row, order: order++ });
    } else {
      mergeValues(prev, row);
    }
  }

  return [...byKey.values()].sort((a, b) => a.order - b.order);
}

export function createStructureOnlyRows(
  rows: ExtractedRow[],
  dataset: "value" | "volume"
): ExtractedRow[] {
  return rows.map((row, index) => ({
    ...row,
    dataset,
    values: { ...emptyYearValues(), ...row.values },
    order: index,
  }));
}
