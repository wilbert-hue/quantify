import { fillRowsForExport } from "./dataGenerator";
import { formatValueCell, formatVolumeCell, rowToCsvLine } from "./formatters";
import { toSegmentDefinition } from "./ivlCatalog";
import { sanitizeHierarchyFields } from "./textSanitizer";
import { getVolumeRowsFromValueRows } from "./templateBuilder";
import { CSV_HEADER, YEARS, emptyYearValues, type ExtractedRow, type GenerationStats } from "./types";

function sanitizeRow(row: ExtractedRow): ExtractedRow {
  const cleaned = sanitizeHierarchyFields({
    region: row.region,
    segment: row.segment,
    subSegment: row.subSegment,
    subSegment1: row.subSegment1,
    subSegment2: row.subSegment2,
  });

  if (row.segment === "By Region" || row.segment === "By Country") {
    return { ...row, ...cleaned };
  }

  const def = toSegmentDefinition(cleaned);
  return def ? { ...row, ...def } : { ...row, ...cleaned };
}

function ensureAligned(rows: ExtractedRow[]): ExtractedRow[] {
  if (rows.length === 0) return [];
  return rows.map(sanitizeRow);
}

export function generateValueCsv(rows: ExtractedRow[]): string {
  const aligned = fillRowsForExport(ensureAligned(rows), "value");
  const lines: string[] = [CSV_HEADER.join(",")];

  for (const row of aligned) {
    const values = YEARS.map((year) => row.values[year] ?? null);
    lines.push(
      rowToCsvLine(
        [row.region, row.segment, row.subSegment, row.subSegment1, row.subSegment2],
        values,
        formatValueCell
      )
    );
  }

  return lines.join("\n");
}

export function generateVolumeCsv(rows: ExtractedRow[]): string {
  const aligned = ensureAligned(rows);
  const volumeRows = fillRowsForExport(
    getVolumeRowsFromValueRows(aligned).map((row) => ({
      ...row,
      values: emptyYearValues(),
    })),
    "volume"
  );
  const lines: string[] = [CSV_HEADER.join(",")];

  for (const row of volumeRows) {
    const values = YEARS.map((year) => row.values[year] ?? null);
    lines.push(
      rowToCsvLine(
        [row.region, row.segment, row.subSegment, row.subSegment1, row.subSegment2],
        values,
        formatVolumeCell
      )
    );
  }

  return lines.join("\n");
}

export function getExportStats(rows: ExtractedRow[]): GenerationStats {
  const aligned = ensureAligned(rows);
  const valueRows = aligned.filter((r) => r.dataset === "value");
  const volumeRows = getVolumeRowsFromValueRows(aligned);

  return {
    valueFilled: valueRows.length,
    valueTotal: valueRows.length,
    volumeFilled: volumeRows.length,
    volumeTotal: volumeRows.length,
  };
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
