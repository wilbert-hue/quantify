export type UploadCategory = "segments" | "geographies";
export type FileKind = "image" | "spreadsheet";

export const YEARS = [
  "2021", "2022", "2023", "2024", "2025", "2026", "2027",
  "2028", "2029", "2030", "2031", "2032", "2033",
] as const;

export const CSV_HEADER = [
  "Region",
  "Segment",
  "Sub-segment",
  "Sub-segment 1",
  "Sub-segment 2",
  ...YEARS,
];

export type YearValues = Record<string, number | null>;

export interface ExtractedRow {
  region: string;
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
  values: YearValues;
  source: string;
  order: number;
  dataset: "value" | "volume";
  /** Which upload bucket this row came from — prevents cross-category collision. */
  uploadCategory?: UploadCategory;
}

export interface UploadedFile {
  id: string;
  file: File;
  preview: string;
  category: UploadCategory;
  kind: FileKind;
  status: "pending" | "processing" | "done" | "error";
  ocrText?: string;
  parsedRows?: ExtractedRow[];
  error?: string;
}

export interface GenerationStats {
  valueFilled: number;
  valueTotal: number;
  volumeFilled: number;
  volumeTotal: number;
}

export function rowKey(row: Pick<ExtractedRow, "region" | "segment" | "subSegment" | "subSegment1" | "subSegment2">): string {
  return [row.region, row.segment, row.subSegment, row.subSegment1, row.subSegment2].join("|");
}

export function isVolumeExcluded(row: Pick<ExtractedRow, "subSegment">): boolean {
  const s = row.subSegment.trim().toLowerCase();
  return s === "software" || s === "services";
}

export function emptyYearValues(): YearValues {
  return Object.fromEntries(YEARS.map((y) => [y, null]));
}
