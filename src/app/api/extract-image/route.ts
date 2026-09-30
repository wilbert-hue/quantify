import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

type Row = { segment: string; subSegment: string; subSegment1: string; subSegment2: string };

const PROMPT = `The image(s) show market segmentation lists in ONE of two layouts:

LAYOUT 1 — SLIDE PANELS: each panel has a coloured (usually blue) header bar and a bullet list below it.
LAYOUT 2 — SPREADSHEET / TABLE: a single column of cells. Shaded/coloured/bold rows (usually starting with "By ...") are the PANEL HEADERS. Every plain row below a header, until the next header, is a LEVEL 1 item of that header (these rows have no bullets). Blank rows only separate groups — ignore them.

The bullet list can have up to THREE visual levels:
- LEVEL 1: FILLED SQUARE bullet (■), at the far LEFT edge
- LEVEL 2: OPEN CIRCLE bullet (○), INDENTED right of level-1
- LEVEL 3: SMALL DOT (·) or further-indented circle, INDENTED right of level-2

YOUR OUTPUT FORMAT — one line per item at the DEEPEST level it reaches:

  If item has LEVEL 3 children:   [LEVEL 1] >>> [LEVEL 2] >>> [LEVEL 3]
  If item has LEVEL 2 but no L3:  [LEVEL 1] >>> [LEVEL 2]
  If LEVEL 1 has NO children:     [LEVEL 1] >>> (none)

KEY RULE: A parent that HAS children of its own must NEVER get its own output line — only its deepest children appear.

Separate panels with: === [exact full header text] ===

MULTI-LINE RULE: If bullet text wraps to the next line (no bullet on that line), JOIN it onto the same output line with a space.

WORKED EXAMPLE A — 2-level hierarchy (By Application):
  LEVEL1: Coronary Artery Disease (CAD)
    LEVEL2: Severely Calcified Coronary Lesions
    LEVEL2: Calcified Left Main Coronary Artery Disease  ← wrap joined
  LEVEL1: Peripheral Artery Disease (PAD)
    LEVEL2: Calcified Iliac Artery Lesions
  LEVEL1: Other Emerging Areas (Renal Artery Stenosis)  ← no children

Correct output:
=== By Application ===
Coronary Artery Disease (CAD) >>> Severely Calcified Coronary Lesions
Coronary Artery Disease (CAD) >>> Calcified Left Main Coronary Artery Disease
Peripheral Artery Disease (PAD) >>> Calcified Iliac Artery Lesions
Other Emerging Areas (Renal Artery Stenosis) >>> (none)

WORKED EXAMPLE B — 3-level hierarchy (By Vehicle Class):
  LEVEL1: Passenger Vehicles
    LEVEL2: Hatchback/Sedan          ← no level-3
    LEVEL2: SUVs and Crossovers      ← no level-3
  LEVEL1: Micromobility Vehicles
    LEVEL2: Two-Wheelers
      LEVEL3: Scooters/Mopeds
      LEVEL3: Motorcycles
    LEVEL2: Three-Wheelers
      LEVEL3: Passenger (Auto-Rickshaw type)
      LEVEL3: Cargo/Load-Carrying
  LEVEL1: Off-Highway Vehicles
    LEVEL2: Construction Equipment
      LEVEL3: Excavators
      LEVEL3: Loaders

Correct output:
=== By Vehicle Class ===
Passenger Vehicles >>> Hatchback/Sedan
Passenger Vehicles >>> SUVs and Crossovers
Micromobility Vehicles >>> Two-Wheelers >>> Scooters/Mopeds
Micromobility Vehicles >>> Two-Wheelers >>> Motorcycles
Micromobility Vehicles >>> Three-Wheelers >>> Passenger (Auto-Rickshaw type)
Micromobility Vehicles >>> Three-Wheelers >>> Cargo/Load-Carrying
Off-Highway Vehicles >>> Construction Equipment >>> Excavators
Off-Highway Vehicles >>> Construction Equipment >>> Loaders

WORKED EXAMPLE C — spreadsheet/table layout (no bullets):
  [shaded] By Gas Type
  Hydrocarbon Gases
  Carbon Monoxide
  [blank]
  [shaded] By Distribution Channel
  Direct Sales

Correct output:
=== By Gas Type ===
Hydrocarbon Gases >>> (none)
Carbon Monoxide >>> (none)
=== By Distribution Channel ===
Direct Sales >>> (none)

WORKED EXAMPLE D — multi-column panel (e.g. By Region): a panel's list may flow into a 2nd/3rd COLUMN.
An indented (○) item at the TOP of a new column belongs to the LAST level-1 item of the previous column.
  Column 1 ends with:    ■ Asia Pacific, ○ China, ○ India, ○ Japan
  Column 2 starts with:  ○ South Korea, ○ ASEAN, ■ Latin America, ○ Brazil

Correct output:
Asia Pacific >>> China
Asia Pacific >>> India
Asia Pacific >>> Japan
Asia Pacific >>> South Korea
Asia Pacific >>> ASEAN
Latin America >>> Brazil

CRITICAL RULES:
- NEVER repeat the header text (e.g. "By Gas Type") as a LEVEL 1 item — it goes ONLY in the === line
- Ignore slide titles such as "GLOBAL ... MARKET" — they are not panel headers
- If the image has NO header at all (e.g. it only shows "U.S." or a plain list of names), do NOT turn the items into === lines — output each one as "[item] >>> (none)" with no === line
- Remove all bullet symbols (■ ○ · •) from text
- Write the FULL blue header text — never truncate
- Wrap continuation lines: join them with a space onto the prior line
- Output ONLY the === and >>> lines. No other text, no explanation.`;

// ─── Parse >>> lines into rows ────────────────────────────────────────────────
function parseArrowLines(text: string, fallbackName: string): Row[] {
  const allRows: Row[] = [];
  // Strip markdown the model sometimes adds: code fences and **bold** around headers
  const normalized = text.replace(/```[a-z]*/gi, "").replace(/\*\*/g, "");
  const sections = normalized.split(/^\s*===\s*(.+?)\s*===\s*$/m);

  if (sections.length < 3) {
    allRows.push(...parseSectionArrows(normalized, fallbackName));
    return allRows;
  }

  for (let i = 1; i < sections.length - 1; i += 2) {
    // Strip continuation suffixes like "(1/2)", "(2/3)" so all parts merge under the same segment
    const header = sections[i].trim().replace(/\s*\(\d+\/\d+\)\s*$/, "").trim();
    const content = sections[i + 1] ?? "";
    if (!header) continue;
    const sectionRows = parseSectionArrows(content, header);
    // Image with no real header (e.g. just "U.S.") — model emits the item as "=== U.S. ===" with nothing under it
    if (sectionRows.length === 0 && !/^by\s+/i.test(header)) {
      const item = clean(header);
      allRows.push({ segment: fallbackName, subSegment: item, subSegment1: item, subSegment2: item });
    } else {
      allRows.push(...sectionRows);
    }
  }

  return allRows;
}

const isNone = (s: string | undefined) =>
  !s || s.toLowerCase() === "none" || s.toLowerCase() === "(none)";

const isHeaderLike = (s: string, segmentName: string) =>
  /^by\s+/i.test(s) || s.replace(/\s+/g, " ").toLowerCase() === segmentName.replace(/\s+/g, " ").toLowerCase();

function parseSectionArrows(content: string, segmentName: string): Row[] {
  const rows: Row[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("===")) continue;

    // A plain line without ">>>" (model skipped the "(none)" marker) is a level-1 item
    let parts = (line.includes(">>>") ? line.split(/\s*>>>\s*/) : [line]).map(clean);

    // Model sometimes repeats the header as level 1 ("By Gas Type >>> Ammonia") — drop it
    while (parts.length > 1 && isHeaderLike(parts[0], segmentName)) parts = parts.slice(1);
    parts = parts.filter((p, i) => i === 0 || !isNone(p));

    const [level1, level2, level3] = parts;
    if (isNone(level1) || isHeaderLike(level1, segmentName)) continue;

    if (!level2) {
      // Level 1 only — all three columns collapse to level1
      rows.push({ segment: segmentName, subSegment: level1, subSegment1: level1, subSegment2: level1 });
    } else if (!level3) {
      // Two-level — subSegment2 repeats level2
      rows.push({ segment: segmentName, subSegment: level1, subSegment1: level2, subSegment2: level2 });
    } else {
      // Three-level — full hierarchy
      rows.push({ segment: segmentName, subSegment: level1, subSegment1: level2, subSegment2: level3 });
    }
  }
  return rows;
}

function clean(s: string): string {
  return s.replace(/^[-–]\s+/, "").replace(/[■○•◦❖▪*]/g, "").replace(/\s+/g, " ").trim();
}

type ImageEntry = { imageBase64: string; mimeType: string; filename: string };

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { images?: ImageEntry[]; imageBase64?: string; mimeType?: string; filename?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  // Support both batch (images[]) and legacy single-image format
  const images: ImageEntry[] = body.images?.length
    ? body.images
    : body.imageBase64 && body.mimeType
      ? [{ imageBase64: body.imageBase64, mimeType: body.mimeType, filename: body.filename ?? "upload" }]
      : [];

  if (images.length === 0) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });

    const imageBlocks = images.map(img => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        data: img.imageBase64,
      },
    }));

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          ...imageBlocks,
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const rawText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");

    const rows = parseArrowLines(rawText, images[0].filename);
    return NextResponse.json({ rows, _debug_rawText: rawText });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
