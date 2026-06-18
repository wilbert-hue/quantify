import { YEARS, emptyYearValues, type ExtractedRow, type YearValues } from "./types";
import { parseNumericToken } from "./formatters";

export function assignNumbersToYears(numbers: number[]): YearValues {
  const values = emptyYearValues();

  if (numbers.length === YEARS.length) {
    YEARS.forEach((year, i) => { values[year] = numbers[i]; });
    return values;
  }

  if (numbers.length > YEARS.length) {
    const slice = numbers.slice(-YEARS.length);
    YEARS.forEach((year, i) => { values[year] = slice[i]; });
    return values;
  }

  numbers.forEach((num, i) => {
    if (i < YEARS.length) values[YEARS[i]] = num;
  });

  return values;
}

export function mergeYearValues(target: YearValues, source: YearValues): void {
  for (const year of YEARS) {
    if (source[year] != null) target[year] = source[year];
  }
}

export function countFilledYears(values: YearValues): number {
  return Object.values(values).filter((v) => v != null).length;
}

function normalizeCell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function isYearHeader(cell: string): boolean {
  return /^(202[1-9]|203[0-3])$/.test(cell.trim());
}

function columnIndex(row: string[], pattern: RegExp): number {
  return row.findIndex((c) => pattern.test(c));
}

function findHeaderRow(rows: string[][]): { rowIndex: number; columns: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i].map(normalizeCell);
    const regionIdx = row.findIndex((c) => /^region$/i.test(c));
    if (regionIdx === -1) continue;

    const columns: Record<string, number> = {
      region: regionIdx,
      segment: columnIndex(row, /^segment$/i),
      subSegment: columnIndex(row, /^sub-?segment$/i),
      subSegment1: columnIndex(row, /sub-?segment\s*1/i),
      subSegment2: columnIndex(row, /sub-?segment\s*2/i),
    };

    if (columns.subSegment >= 0) {
      if (columns.subSegment1 === columns.subSegment) columns.subSegment1 = -1;
      if (columns.subSegment2 === columns.subSegment) columns.subSegment2 = -1;
    }

    const yearCols: Record<string, number> = {};
    row.forEach((cell, idx) => {
      if (isYearHeader(cell)) yearCols[cell] = idx;
    });

    if (Object.keys(yearCols).length >= 3) {
      for (const [key, idx] of Object.entries(columns)) {
        if (idx === -1 && key !== "subSegment1" && key !== "subSegment2") return null;
      }
      return { rowIndex: i, columns: { ...columns, ...yearCols } };
    }
  }

  return null;
}

function parseRowFromSheet(
  row: string[],
  columns: Record<string, number>,
  source: string,
  order: number,
  dataset: "value" | "volume"
): ExtractedRow | null {
  const region = normalizeCell(row[columns.region]);
  const segment = normalizeCell(row[columns.segment]);
  const subSegment = normalizeCell(row[columns.subSegment] ?? columns.subSegment1 ?? -1);
  const subSegment1 = normalizeCell(
    columns.subSegment1 >= 0 ? row[columns.subSegment1] : row[columns.subSegment2]
  );
  const subSegment2 = normalizeCell(row[columns.subSegment2]);

  if (!region && !segment && !subSegment2) return null;
  if (/^region$/i.test(region)) return null;

  const values = emptyYearValues();
  let hasYear = false;

  for (const year of YEARS) {
    const idx = columns[year];
    if (idx == null || idx < 0) continue;
    const num = parseNumericToken(normalizeCell(row[idx]));
    if (num != null) {
      values[year] = num;
      hasYear = true;
    }
  }

  const label = subSegment2 || subSegment1 || subSegment || segment;
  if (!label) return null;

  const finalRegion = region || "Global";
  const finalSegment = segment || "By Segment";
  const finalSubSegment = subSegment || subSegment1 || label;
  const finalSub1 = subSegment1 || subSegment2 || label;
  const finalSub2 = subSegment2 || subSegment1 || label;

  if (!hasYear && !finalSegment.startsWith("By")) return null;

  return {
    region: finalRegion,
    segment: finalSegment,
    subSegment: finalSubSegment,
    subSegment1: finalSub1,
    subSegment2: finalSub2,
    values,
    source,
    order,
    dataset,
  };
}

export function parseSpreadsheetRows(
  rows: unknown[][],
  source: string,
  dataset: "value" | "volume" = "value"
): ExtractedRow[] {
  const stringRows = rows.map((r) => (Array.isArray(r) ? r.map(normalizeCell) : []));
  const header = findHeaderRow(stringRows);

  if (!header) {
    return parseRowsWithoutHeader(stringRows, source, dataset);
  }

  const extracted: ExtractedRow[] = [];
  let order = 0;

  for (let i = header.rowIndex + 1; i < stringRows.length; i++) {
    const row = parseRowFromSheet(stringRows[i], header.columns, source, order, dataset);
    if (row) {
      extracted.push(row);
      order++;
    }
  }

  return extracted;
}

function parseRowsWithoutHeader(
  rows: string[][],
  source: string,
  dataset: "value" | "volume"
): ExtractedRow[] {
  const extracted: ExtractedRow[] = [];
  let order = 0;
  let currentRegion = "Global";

  for (const row of rows) {
    if (row.length === 0 || row.every((c) => !c)) continue;

    const line = row.join(" ");
    const numbers = row
      .map((c) => parseNumericToken(c))
      .filter((n): n is number => n != null);

    const textCols = row.filter((c) => parseNumericToken(c) == null && c.trim());
    if (textCols.length === 1 && numbers.length === 0) {
      currentRegion = textCols[0];
      continue;
    }

    if (numbers.length < 3) continue;

    const hierarchy = textCols.length >= 5
      ? textCols.slice(0, 5)
      : padHierarchy(textCols, currentRegion);

    extracted.push({
      region: hierarchy[0] || currentRegion,
      segment: hierarchy[1] || "By Segment",
      subSegment: hierarchy[2] || hierarchy[4],
      subSegment1: hierarchy[3] || hierarchy[4],
      subSegment2: hierarchy[4] || hierarchy[3] || hierarchy[2],
      values: assignNumbersToYears(numbers),
      source,
      order: order++,
      dataset,
    });
  }

  return extracted;
}

function padHierarchy(cols: string[], region: string): string[] {
  if (cols.length >= 5) return cols;
  const padded = [...cols];
  while (padded.length < 5) padded.push(padded[padded.length - 1] ?? "");
  if (!padded[0]) padded[0] = region;
  return padded;
}

export async function parseSpreadsheetFile(file: File): Promise<ExtractedRow[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  const allRows: ExtractedRow[] = [];
  let orderOffset = 0;

  for (const sheetName of workbook.SheetNames) {
    const dataset = detectDataset(file, sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
    const parsed = parseSpreadsheetRows(rows, `${file.name} (${sheetName})`, dataset);
    for (const row of parsed) {
      allRows.push({ ...row, order: orderOffset++ });
    }
  }

  return allRows;
}

function detectDataset(file: File, sheetName: string): "value" | "volume" {
  const hint = `${file.name} ${sheetName}`.toLowerCase();
  return /volume/.test(hint) ? "volume" : "value";
}
