import geoData from "@/data/geoTemplate.json";
import { sanitizeHierarchyFields } from "./textSanitizer";
import { emptyYearValues, type ExtractedRow } from "./types";

export interface GeoRow {
  region: string;
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
}

export const REGIONS_IN_ORDER: string[] = geoData.regionsInOrder;

export function getGeoRowsForRegion(region: string): GeoRow[] {
  return geoData.geoRows.filter((r) => r.region === region);
}

export function templateRowToExtracted(
  row: GeoRow,
  order: number,
  dataset: "value" | "volume" = "value"
): ExtractedRow {
  const cleaned = sanitizeHierarchyFields({
    region: row.region,
    segment: row.segment,
    subSegment: row.subSegment,
    subSegment1: row.subSegment1,
    subSegment2: row.subSegment2,
  });

  return {
    region: cleaned.region,
    segment: cleaned.segment,
    subSegment: cleaned.subSegment,
    subSegment1: cleaned.subSegment1,
    subSegment2: cleaned.subSegment2,
    values: emptyYearValues(),
    source: "template",
    order,
    dataset,
  };
}
