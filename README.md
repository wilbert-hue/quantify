# Quantify

Next.js platform to generate **Value.csv** and **Volume.csv** from uploaded segment, sub-segment, and geography table images.

## Reference templates

Row order is taken from:

- `Value 1.csv` — full Value template (1,434 rows)
- `Volume2.csv` — Volume template (1,147 rows, same order minus Software/Services)

Regenerate embedded template after editing reference CSVs:

```bash
npm run build-template
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Workflow

1. Upload **Segments & Sub-segments** images (component, product type, technology tables).
2. Upload **Geographies** images (regional and country tables).
3. Click **Extract data from images** — OCR reads numbers and maps rows to the template.
4. Download **Value.csv** and **Volume.csv** in the exact reference order.

## Stack

- Next.js 15 (App Router)
- Tesseract.js (client-side OCR)
- TypeScript
