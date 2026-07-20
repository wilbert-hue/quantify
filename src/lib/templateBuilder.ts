import {
  mergeSegmentCatalogs,
  toSegmentDefinition,
  type SegmentDefinition,
} from "./ivlCatalog";
import { isValidGeoDefinition } from "./regions";
import { emptyYearValues, type ExtractedRow, type UploadCategory } from "./types";

function isGeoSegment(segment: string): boolean {
  return segment === "By Region" || segment === "By Country";
}

function definitionToRow(
  region: string,
  def: SegmentDefinition,
  order: number,
  source: string,
  uploadCategory?: UploadCategory
): ExtractedRow {
  return {
    region,
    segment: def.segment,
    subSegment: def.subSegment,
    subSegment1: def.subSegment1,
    subSegment2: def.subSegment2,
    values: emptyYearValues(),
    source,
    order,
    dataset: "value",
    uploadCategory,
  };
}

function collectDefinitions(parsedRows: ExtractedRow[]): {
  segmentDefs: SegmentDefinition[];
  geoDefs: SegmentDefinition[];
} {
  const segmentDefs: SegmentDefinition[] = [];
  const geoDefs: SegmentDefinition[] = [];
  const seenSegments = new Set<string>();
  const seenGeo = new Set<string>();

  for (const row of parsedRows) {
    const category = row.uploadCategory;

    // Geography uploads: use raw row data directly — skip resolveSegmentDefinition
    // which rejects rows whose segment name isn't a "By X" header (e.g. filename fallback).
    // Always normalize segment to "By Region" so geography never leaks into the segment dropdown.
    if (category === "geographies") {
      if (!row.subSegment) continue;
      const def: SegmentDefinition = {
        segment: "By Region",
        subSegment: row.subSegment,
        subSegment1: row.subSegment1 || row.subSegment,
        subSegment2: row.subSegment2 || row.subSegment1 || row.subSegment,
      };
      const key = [def.segment, def.subSegment, def.subSegment1, def.subSegment2].join("|");
      if (seenGeo.has(key)) continue;
      seenGeo.add(key);
      geoDefs.push(def);
      continue;
    }

    const def = toSegmentDefinition(row);
    if (!def) continue;

    const key = [def.segment, def.subSegment, def.subSegment1, def.subSegment2].join("|");

    if (isGeoSegment(def.segment)) {
      if (category === "segments") continue;
      if (!isValidGeoDefinition(def)) continue;
      if (seenGeo.has(key)) continue;
      seenGeo.add(key);
      geoDefs.push(def);
      continue;
    }

    if (seenSegments.has(key)) continue;
    seenSegments.add(key);
    segmentDefs.push(def);
  }

  return { segmentDefs, geoDefs };
}

/**
 * Derive the ordered region list from uploaded geography rows.
 * hierarchy: Global → parent (subSegment) → child (subSegment1)
 */
function regionsFromGeoDefs(geoDefs: SegmentDefinition[]): string[] {
  const regions: string[] = [];
  const seen = new Set<string>();

  const add = (r: string | undefined) => {
    const v = r?.trim();
    if (v && v.toLowerCase() !== "none" && !seen.has(v)) {
      seen.add(v);
      regions.push(v);
    }
  };

  for (const geo of geoDefs) {
    add(geo.subSegment);   // level 1 region (e.g. Asia Pacific)
    add(geo.subSegment1);  // level 2 region (e.g. South Asia)
    add(geo.subSegment2);  // level 3 region (e.g. India) — only added when different from level 2
  }

  return regions;
}

/**
 * Builds the full Value-style dataset from the current upload batch only:
 * - Regions are derived from the uploaded geography image (not hardcoded)
 * - Segment rows from segment uploads, repeated per extracted region
 */
export function buildAlignedDataset(parsedRows: ExtractedRow[]): ExtractedRow[] {
  if (parsedRows.length === 0) return [];

  const { segmentDefs, geoDefs } = collectDefinitions(parsedRows);
  const catalog = mergeSegmentCatalogs(segmentDefs);

  if (catalog.length === 0 && geoDefs.length === 0) return [];

  // Use only the regions present in the uploaded geography image
  const regions = geoDefs.length > 0 ? regionsFromGeoDefs(geoDefs) : ["Global"];

  const output: ExtractedRow[] = [];
  let order = 0;

  for (const region of regions) {
    for (const def of catalog) {
      output.push(definitionToRow(region, def, order++, "upload", "segments"));
    }

    // Only output geo rows where this region is the direct parent (subSegment === region).
    // Prevents "North America → U.S." geo row from appearing under the "U.S." region row.
    for (const geo of geoDefs) {
      if (geo.subSegment === region) {
        output.push(definitionToRow(region, geo, order++, "upload", "geographies"));
      }
    }
  }

  return output;
}

export function getVolumeRowsFromValueRows(valueRows: ExtractedRow[]): ExtractedRow[] {
  return valueRows.map((row, index) => ({
    ...row,
    dataset: "volume" as const,
    order: index,
  }));
}
