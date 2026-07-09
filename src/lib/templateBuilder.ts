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
    const def = toSegmentDefinition(row);
    if (!def) continue;

    const key = [def.segment, def.subSegment, def.subSegment1, def.subSegment2].join("|");
    const category = row.uploadCategory;

    // Treat as geo if the segment name signals geography OR the user uploaded it as a geography
    const treatAsGeo = isGeoSegment(def.segment) || category === "geographies";

    if (treatAsGeo) {
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
  const regions: string[] = ["Global"];
  const seen = new Set<string>(["Global"]);

  for (const geo of geoDefs) {
    const parent = geo.subSegment?.trim();
    const child = geo.subSegment1?.trim();

    if (parent && !seen.has(parent)) {
      seen.add(parent);
      regions.push(parent);
    }
    if (child && child.toLowerCase() !== "none" && child !== parent && !seen.has(child)) {
      seen.add(child);
      regions.push(child);
    }
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

    for (const geo of geoDefs) {
      output.push(definitionToRow(region, geo, order++, "upload", "geographies"));
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
