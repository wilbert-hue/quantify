export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

interface BboxLine {
  text?: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

function toLine(entry: BboxLine): OcrLine | null {
  const text = entry.text?.trim();
  if (!text || !entry.bbox) return null;
  return { text, ...entry.bbox };
}

function extractLinesFromPage(data: {
  blocks?: { paragraphs?: { lines?: BboxLine[] }[] }[] | null;
}): OcrLine[] {
  const lines: OcrLine[] = [];

  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const parsed = toLine(line);
        if (parsed) lines.push(parsed);
      }
    }
  }

  return lines;
}

export async function runOcr(
  imageFile: File,
  onProgress?: (pct: number) => void
): Promise<OcrResult> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
    });
    const { data } = await worker.recognize(imageFile);
    let lines = extractLinesFromPage(data);

    if (lines.length === 0 && data.text) {
      lines = data.text
        .split(/\r?\n/)
        .map((text, index) => text.trim())
        .filter(Boolean)
        .map((text, index) => ({
          text,
          x0: 0,
          y0: index * 24,
          x1: 800,
          y1: index * 24 + 20,
        }));
    }

    return { text: data.text, lines };
  } finally {
    await worker.terminate();
  }
}
