import { YEARS, type ExtractedRow, type YearValues } from "./types";

export type DataMode = "value" | "volume";

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number, index: number): number {
  const x = Math.sin(seed * 9973 + index * 7919) * 10000;
  return x - Math.floor(x);
}

function roundForMode(value: number, mode: DataMode): number {
  if (mode === "value") return Math.round(value * 10) / 10;
  return Math.round(value);
}

function getRegionScale(region: string): number {
  const key = region.trim().toLowerCase();
  if (key === "global") return 1;

  const major = ["north america", "europe", "asia pacific", "latin america", "middle east & africa"];
  if (major.includes(key)) return 0.22 + seededRandom(hashString(region), 1) * 0.14;

  const large = ["u.s.", "china", "germany", "japan", "u.k.", "france", "india", "canada", "brazil"];
  if (large.includes(key)) return 0.1 + seededRandom(hashString(region), 2) * 0.12;

  if (key.startsWith("rest of")) return 0.04 + seededRandom(hashString(region), 3) * 0.05;

  return 0.06 + seededRandom(hashString(region), 4) * 0.08;
}

function growthRate(seed: number, yearIndex: number): number {
  const base = 0.085 + seededRandom(seed, 10) * 0.035;
  const jitter = (seededRandom(seed, 20 + yearIndex) - 0.5) * 0.012;
  return base + jitter;
}

function baseFor2021(row: ExtractedRow, mode: DataMode, rowIndex: number): number {
  const seed = hashString(
    `${row.region}|${row.segment}|${row.subSegment}|${row.subSegment2}|${rowIndex}|${mode}`
  );
  const scale = getRegionScale(row.region);
  const rowFactor = 0.55 + seededRandom(seed, 7) * 0.95;

  if (mode === "value") {
    const segmentBoost =
      /product type|application|technology/i.test(row.segment) ? 1.15 : 1;
    return (22 + seededRandom(seed, 2) * 240) * scale * rowFactor * segmentBoost;
  }

  const segmentBoost =
    /product type|application|hardware/i.test(row.subSegment) ? 1.2 : 1;
  return (42000 + seededRandom(seed, 3) * 210000) * scale * rowFactor * segmentBoost;
}

export function fillMissingYearValues(
  row: ExtractedRow,
  mode: DataMode,
  rowIndex: number
): YearValues {
  const values: YearValues = { ...row.values };
  const filledYears = YEARS.filter((y) => values[y] != null);

  if (filledYears.length === YEARS.length) return values;

  const seed = hashString(
    `${row.region}|${row.segment}|${row.subSegment2}|${rowIndex}|${mode}`
  );

  if (filledYears.length > 0) {
    let anchorIndex = YEARS.findIndex((y) => values[y] != null);
    let anchorValue = values[YEARS[anchorIndex]]!;

    for (let i = anchorIndex - 1; i >= 0; i--) {
      if (values[YEARS[i]] == null) {
        const rate = growthRate(seed, i);
        anchorValue = roundForMode(anchorValue / (1 + rate), mode);
        values[YEARS[i]] = anchorValue;
      } else {
        anchorValue = values[YEARS[i]]!;
      }
    }

    anchorIndex = YEARS.findIndex((y) => values[y] != null);
    anchorValue = values[YEARS[anchorIndex]]!;

    for (let i = anchorIndex + 1; i < YEARS.length; i++) {
      if (values[YEARS[i]] == null) {
        const rate = growthRate(seed, i);
        anchorValue = roundForMode(anchorValue * (1 + rate), mode);
        values[YEARS[i]] = anchorValue;
      } else {
        anchorValue = values[YEARS[i]]!;
      }
    }

    return values;
  }

  let current = roundForMode(baseFor2021(row, mode, rowIndex), mode);
  values[YEARS[0]] = current;

  for (let i = 1; i < YEARS.length; i++) {
    current = roundForMode(current * (1 + growthRate(seed, i)), mode);
    values[YEARS[i]] = current;
  }

  return values;
}

export function fillRowsForExport(rows: ExtractedRow[], mode: DataMode): ExtractedRow[] {
  return rows.map((row, index) => ({
    ...row,
    values: fillMissingYearValues(row, mode, index),
  }));
}

export function fillAllRows(rows: ExtractedRow[]): ExtractedRow[] {
  let valueIndex = 0;
  let volumeIndex = 0;

  return rows.map((row) => {
    if (row.dataset === "volume") {
      const filled = fillMissingYearValues(row, "volume", volumeIndex);
      volumeIndex++;
      return { ...row, values: filled };
    }

    const filled = fillMissingYearValues(row, "value", valueIndex);
    valueIndex++;
    return { ...row, values: filled };
  });
}

export function countFilledYears(values: YearValues): number {
  return YEARS.filter((y) => values[y] != null).length;
}
