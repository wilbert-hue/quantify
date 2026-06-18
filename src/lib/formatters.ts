import { YEARS } from "./types";
import { sanitizeDisplayText } from "./textSanitizer";

export function formatValueCell(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "";

  const rounded = Math.round(value * 10) / 10;
  const str = rounded.toFixed(1);

  if (rounded >= 1000) {
    const [intPart, decPart] = str.split(".");
    const formatted = `${Number(intPart).toLocaleString("en-US")}.${decPart}`;
    return `"${formatted}"`;
  }

  return str;
}

export function formatVolumeCell(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "";

  const rounded = Math.round(value);
  return `"${rounded.toLocaleString("en-US")}"`;
}

export function escapeCsvField(field: string): string {
  const cleaned = sanitizeDisplayText(field);
  if (cleaned.includes(",") || cleaned.includes('"') || cleaned.includes("\n")) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

export function rowToCsvLine(
  fields: string[],
  values: (number | null)[],
  formatter: (v: number | null) => string
): string {
  const formattedValues = values.map(formatter);
  return [...fields.map(escapeCsvField), ...formattedValues].join(",");
}

export function parseNumericToken(token: string): number | null {
  const cleaned = token.replace(/[",\s$€£%]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function extractYearNumbersFromLine(line: string): number[] {
  const tokens = line.match(/-?\d[\d,]*\.?\d*/g) ?? [];
  return tokens.map(parseNumericToken).filter((n): n is number => n != null);
}

export function looksLikeYearHeader(line: string): boolean {
  const yearsFound = YEARS.filter((y) => line.includes(y));
  return yearsFound.length >= 4;
}
