import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

type Row = { segment: string; subSegment: string; subSegment1: string; subSegment2: string };

const PROMPT = `This image shows a slide with one or more panels. Each panel has a blue header bar and a bullet list.

The bullet list in each panel has TWO visual levels:
- LEVEL 1 items: have a FILLED SQUARE bullet, are positioned at the LEFT edge of the content
- LEVEL 2 items: have an OPEN CIRCLE bullet, are INDENTED (positioned to the RIGHT of level-1 items), and belong to the nearest level-1 item above them

YOUR OUTPUT FORMAT:
One line per relationship, using " >>> " (space-arrow-arrow-arrow-space) as separator:

For each LEVEL 2 item: write    [its LEVEL 1 parent] >>> [the LEVEL 2 item]
For each LEVEL 1 item with NO LEVEL 2 children: write    [LEVEL 1 item] >>> (none)

Separate panels with: === [exact full header text] ===

MULTI-LINE RULE: If bullet text continues on the next line (no bullet on that line), join it with a space onto the SAME output line. Never output a continuation as its own line.

EXACT WORKED EXAMPLE for this specific panel content:
Panel: "By Application" with these items:
  LEVEL1: Coronary Artery Disease (CAD)
    LEVEL2: Severely Calcified Coronary Lesions
    LEVEL2: Calcified Left Main Coronary Artery  <-- text wraps to next line: "Disease" -> JOIN as one
    LEVEL2: Underexpanded Stents and Calcified   <-- text wraps to next line: "in Stent Restenosis Cases" -> JOIN
  LEVEL1: Peripheral Artery Disease (PAD)
    LEVEL2: Calcified Iliac Artery Lesions
    LEVEL2: Calcified Femoral Popliteal Lesions
    LEVEL2: Selected Infrapopliteal Calcified    <-- text wraps to next line: "Lesions" -> JOIN
  LEVEL1: Other Emerging Areas (Renal Artery     <-- text wraps to next line: "Stenosis)" -> JOIN
    (no LEVEL2 children)

CORRECT output for that panel:
=== By Application ===
Coronary Artery Disease (CAD) >>> Severely Calcified Coronary Lesions
Coronary Artery Disease (CAD) >>> Calcified Left Main Coronary Artery Disease
Coronary Artery Disease (CAD) >>> Underexpanded Stents and Calcified in Stent Restenosis Cases
Peripheral Artery Disease (PAD) >>> Calcified Iliac Artery Lesions
Peripheral Artery Disease (PAD) >>> Calcified Femoral Popliteal Lesions
Peripheral Artery Disease (PAD) >>> Selected Infrapopliteal Calcified Lesions
Other Emerging Areas (Renal Artery Stenosis) >>> (none)

CRITICAL RULES:
- "Disease" alone is NEVER a separate output line - it joins "Calcified Left Main Coronary Artery"
- "in Stent Restenosis Cases" alone is NEVER a separate output line
- "Lesions" alone is NEVER a separate output line
- A LEVEL 1 parent that HAS LEVEL 2 children must NOT get a "(none)" line - only its children appear
- Remove all bullet symbols from text
- Write the FULL blue header text (never truncate)
- Output ONLY the === and >>> lines. No other text, no explanation.`;

// ─── Parse >>> lines into rows ────────────────────────────────────────────────
function parseArrowLines(text: string, fallbackName: string): Row[] {
  const allRows: Row[] = [];
  const sections = text.split(/===\s*(.+?)\s*===/);

  if (sections.length < 3) {
    allRows.push(...parseSectionArrows(text, fallbackName));
    return allRows;
  }

  for (let i = 1; i < sections.length - 1; i += 2) {
    const header = sections[i].trim();
    const content = sections[i + 1] ?? "";
    if (header) allRows.push(...parseSectionArrows(content, header));
  }

  return allRows;
}

function parseSectionArrows(content: string, segmentName: string): Row[] {
  const rows: Row[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("===")) continue;

    const arrowIdx = line.indexOf(" >>> ");
    if (arrowIdx === -1) continue;

    const parent = clean(line.slice(0, arrowIdx));
    const child = clean(line.slice(arrowIdx + 5));
    if (!parent) continue;

    if (!child || child.toLowerCase() === "none" || child === "(none)") {
      rows.push({ segment: segmentName, subSegment: parent, subSegment1: parent, subSegment2: parent });
    } else {
      rows.push({ segment: segmentName, subSegment: parent, subSegment1: child, subSegment2: child });
    }
  }
  return rows;
}

function clean(s: string): string {
  return s.replace(/[■○•◦❖▪*]/g, "").replace(/\s+/g, " ").trim();
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: { imageBase64: string; mimeType: string; filename: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { imageBase64, mimeType, filename } = body;
  if (!imageBase64 || !mimeType) {
    return NextResponse.json({ error: "Missing imageBase64 or mimeType" }, { status: 400 });
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
              data: imageBase64,
            },
          },
          { type: "text", text: PROMPT },
        ],
      }],
    });

    const rawText = message.content
      .filter(b => b.type === "text")
      .map(b => (b as { type: "text"; text: string }).text)
      .join("\n");

    const rows = parseArrowLines(rawText, filename);
    return NextResponse.json({ rows, _debug_rawText: rawText });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
