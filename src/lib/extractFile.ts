import { detectDataset } from "./fileUpload";
import { parseSpreadsheetFile } from "./spreadsheetParser";
import { buildAlignedDataset } from "./templateBuilder";
import { fillAllRows } from "./dataGenerator";
import { emptyYearValues } from "./types";
import { log } from "./logger";
import type { ExtractedRow, UploadCategory } from "./types";

interface VisionRow {
  segment: string;
  subSegment: string;
  subSegment1: string;
  subSegment2: string;
}

async function fileToBase64(file: File): Promise<string> {
  log.info("fileToBase64", `name="${file.name}" size=${file.size}B type="${file.type}"`);

  // Primary: arrayBuffer (fast)
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
      binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
    }
    const b64 = btoa(binary);
    log.ok("fileToBase64 via arrayBuffer", `${b64.length} chars`);
    return b64;
  } catch (e1) {
    log.warn("fileToBase64 arrayBuffer failed — trying FileReader", e1);

    // Fallback: FileReader (handles network drives, OneDrive, etc.)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          log.ok("fileToBase64 via FileReader", `${base64.length} chars`);
          resolve(base64);
        } else {
          reject(new Error("File read returned empty — try re-selecting the file"));
        }
      };
      reader.onerror = (e) => {
        log.error("fileToBase64 FileReader failed", e);
        reject(
          new Error(
            "Could not read file. Save it to your Desktop (not OneDrive/network) then re-upload."
          )
        );
      };
      reader.readAsDataURL(file);
    });
  }
}

function normalizeMime(file: File): string {
  const t = file.type.toLowerCase();
  if (t === "image/png") return "image/png";
  if (t === "image/jpeg" || t === "image/jpg") return "image/jpeg";
  if (t === "image/webp") return "image/webp";
  if (t === "image/gif") return "image/gif";
  if (file.name.endsWith(".png")) return "image/png";
  if (file.name.endsWith(".jpg") || file.name.endsWith(".jpeg")) return "image/jpeg";
  return "image/png";
}

async function extractWithVision(
  file: File,
  category: UploadCategory
): Promise<ExtractedRow[]> {
  log.info("extractWithVision start", file.name, category);

  const imageBase64 = await fileToBase64(file);
  const mimeType = normalizeMime(file);
  log.info("POST /api/extract-image", { mimeType, base64Len: imageBase64.length });

  const res = await fetch("/api/extract-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, mimeType, filename: file.name }),
  });

  log.info("API response", `HTTP ${res.status}`);
  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    const msg = String(data?.error ?? res.statusText);
    log.error("API error", msg, data);
    throw new Error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
  }

  if (data._debug_rawText) {
    log.info("Claude raw output", "\n" + data._debug_rawText);
  }

  const visionRows: VisionRow[] = Array.isArray(data.rows) ? data.rows : [];
  log.info("Parsed rows", visionRows.length, visionRows);

  if (visionRows.length === 0) {
    log.warn("Zero rows returned", "Check the image contains segment data");
    throw new Error("No rows extracted — check the image contains visible segment data");
  }

  const dataset = detectDataset(file);
  const rows = visionRows.map((r, order) => ({
    region: "Global",
    segment: r.segment ?? "",
    subSegment: r.subSegment ?? "",
    subSegment1: r.subSegment1 ?? r.subSegment ?? "",
    subSegment2: r.subSegment2 ?? r.subSegment1 ?? r.subSegment ?? "",
    values: emptyYearValues(),
    source: file.name,
    order,
    dataset,
    uploadCategory: category,
  }));

  log.ok("extractWithVision done", `${rows.length} rows`);
  return rows;
}

export async function extractRowsFromFile(
  file: File,
  category: UploadCategory,
  _onProgress?: (pct: number) => void
): Promise<{ rows: ExtractedRow[]; ocrText?: string }> {
  log.info("extractRowsFromFile", `"${file.name}" category=${category}`);

  const isSpreadsheet =
    file.name.match(/\.(xlsx|xls|csv)$/i) ||
    file.type.includes("spreadsheet") ||
    file.type.includes("excel") ||
    file.type === "text/csv";

  if (isSpreadsheet) {
    log.info("Spreadsheet detected — parsing directly");
    const rows = await parseSpreadsheetFile(file);
    log.ok("Spreadsheet parsed", `${rows.length} rows`);
    return { rows: rows.map((row) => ({ ...row, uploadCategory: category })) };
  }

  log.info("Image detected — calling Claude Vision");
  const rows = await extractWithVision(file, category);
  return { rows };
}

export function finalizeDataset(parsedRows: ExtractedRow[]): ExtractedRow[] {
  return fillAllRows(buildAlignedDataset(parsedRows));
}
