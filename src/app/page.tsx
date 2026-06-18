"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { FileUploader, filePreviewFor } from "@/components/FileUploader";
import { dedupeFiles, fileKey } from "@/lib/fileUpload";
import type { ExtractedRow, GenerationStats, UploadCategory, UploadedFile } from "@/lib/types";

function createId() {
  return crypto.randomUUID();
}

async function finalizeFromFiles(fileList: UploadedFile[]): Promise<ExtractedRow[]> {
  const { finalizeDataset } = await import("@/lib/extractFile");
  const parsed = fileList
    .filter((f) => f.status === "done")
    .flatMap((f) => f.parsedRows ?? []);
  return finalizeDataset(parsed);
}

export default function HomePage() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [allRows, setAllRows] = useState<ExtractedRow[]>([]);
  const [lastOcrPreview, setLastOcrPreview] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [stats, setStats] = useState<GenerationStats | null>(null);

  useEffect(() => {
    if (allRows.length === 0) {
      setStats(null);
      return;
    }
    let cancelled = false;
    import("@/lib/csvGenerator").then(({ getExportStats }) => {
      if (!cancelled) setStats(getExportStats(allRows));
    });
    return () => {
      cancelled = true;
    };
  }, [allRows]);

  const pendingCount = files.filter((f) => f.status === "pending" || f.status === "error").length;
  const doneCount = files.filter((f) => f.status === "done").length;
  const segmentCount = files.filter((f) => f.category === "segments").length;
  const geographyCount = files.filter((f) => f.category === "geographies").length;
  const queueIsFullyProcessed = files.length > 0 && pendingCount === 0 && doneCount > 0;
  const extractedFromUploads = files
    .filter((f) => f.status === "done")
    .reduce((sum, f) => sum + (f.parsedRows?.length ?? 0), 0);
  const canDownload =
    queueIsFullyProcessed && allRows.length > 0 && extractedFromUploads > 0 && !processing;

  const syncRowsFromFiles = useCallback(async (fileList: UploadedFile[]) => {
    const doneFiles = fileList.filter((f) => f.status === "done");
    if (doneFiles.length === 0) {
      setAllRows([]);
      setLastOcrPreview("");
      return;
    }
    const finalized = await finalizeFromFiles(fileList);
    setAllRows(finalized);
    const lastDone = [...doneFiles].reverse().find((f) => f.ocrText);
    setLastOcrPreview(lastDone?.ocrText?.slice(0, 2500) ?? "");
  }, []);

  const handleAdd = useCallback((incoming: File[], category: UploadCategory) => {
    const uniqueFiles = dedupeFiles(incoming);

    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => fileKey(f.file)));
      const newFiles = uniqueFiles.filter((file) => !existingKeys.has(fileKey(file)));
      const skipped = uniqueFiles.length - newFiles.length;

      if (newFiles.length === 0) {
        setUploadNotice(
          skipped > 0 ? "Those files are already in the queue." : "No new files were added."
        );
        return prev;
      }

      const next = newFiles.map((file) => {
        const { preview, kind } = filePreviewFor(file);
        return {
          id: createId(),
          file,
          preview,
          category,
          kind,
          status: "pending" as const,
        };
      });

      const categoryLabel =
        category === "segments" ? "segment" : "geography";
      setUploadNotice(
        `Added ${newFiles.length} ${categoryLabel} file${newFiles.length === 1 ? "" : "s"}` +
          (skipped > 0 ? ` · ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : "") +
          ` · click Extract to generate fresh CSVs`
      );

      setAllRows([]);
      setLastOcrPreview("");

      return [...prev, ...next];
    });
  }, []);

  const handleRemove = (id: string) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      const next = prev.filter((f) => f.id !== id);

      void syncRowsFromFiles(next).then(() => {
        const doneLeft = next.filter((f) => f.status === "done").length;
        if (next.length === 0) {
          setUploadNotice("");
        } else if (doneLeft === 0) {
          setUploadNotice("File removed. Extract again after your uploads are ready.");
        } else if (next.some((f) => f.status === "pending" || f.status === "error")) {
          setUploadNotice("File removed. Re-run Extract to update your CSV files.");
        }
      });

      return next;
    });
  };

  const processFiles = async () => {
    let queue = [...files];
    let pending = queue.filter((f) => f.status === "pending" || f.status === "error");

    if (pending.length === 0 && queue.some((f) => f.status === "done")) {
      queue = queue.map((f) => ({
        ...f,
        status: "pending" as const,
        parsedRows: undefined,
        ocrText: undefined,
        error: undefined,
      }));
      pending = queue;
      setFiles(queue);
    }

    if (pending.length === 0) return;

    setProcessing(true);
    setProgress(0);
    let workingFiles = queue;
    const { extractRowsFromFile } = await import("@/lib/extractFile");

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      workingFiles = workingFiles.map((f) =>
        f.id === item.id ? { ...f, status: "processing" as const, error: undefined } : f
      );
      setFiles(workingFiles);

      try {
        const { rows, ocrText } = await extractRowsFromFile(
          item.file,
          item.category,
          item.kind === "image"
            ? (pct) => setProgress(Math.round(((i + pct / 100) / pending.length) * 100))
            : undefined
        );

        if (ocrText) setLastOcrPreview(ocrText.slice(0, 2500));

        workingFiles = workingFiles.map((f) =>
          f.id === item.id ? { ...f, status: "done" as const, ocrText, parsedRows: rows } : f
        );
      } catch (error) {
        workingFiles = workingFiles.map((f) =>
          f.id === item.id
            ? {
                ...f,
                status: "error" as const,
                error: error instanceof Error ? error.message : "Processing failed",
              }
            : f
        );
      }

      setFiles(workingFiles);
    }

    const finalized = await finalizeFromFiles(workingFiles);

    if (finalized.length === 0) {
      setAllRows([]);
      setUploadNotice(
        "No segments detected in your uploads. Try clearer photos of your segmentation slides."
      );
    } else {
      setUploadNotice(
        `${finalized.length.toLocaleString()} rows generated with forecast data for 2021–2033. Ready to download.`
      );
    }

    setAllRows(finalized);
    setProgress(100);
    setProcessing(false);
  };

  const handleDownloadValue = async () => {
    const { downloadCsv, generateValueCsv } = await import("@/lib/csvGenerator");
    downloadCsv(generateValueCsv(allRows), "Value.csv");
  };
  const handleDownloadVolume = async () => {
    const { downloadCsv, generateVolumeCsv } = await import("@/lib/csvGenerator");
    downloadCsv(generateVolumeCsv(allRows), "Volume.csv");
  };
  const handleDownloadBoth = async () => {
    await handleDownloadValue();
    setTimeout(() => void handleDownloadVolume(), 300);
  };

  const clearAll = () => {
    files.forEach((f) => {
      if (f.preview) URL.revokeObjectURL(f.preview);
    });
    setFiles([]);
    setAllRows([]);
    setLastOcrPreview("");
    setProgress(0);
    setUploadNotice("");
  };

  return (
    <main className="app-shell">
      <nav className="top-nav">
        <div className="brand">
          <div className="brand-logo-wrap">
            <Image
              src="/logo.png"
              alt="Coherent Market Insights"
              width={200}
              height={56}
              className="brand-logo"
              priority
            />
          </div>
        </div>
        <span className="nav-badge">Value · Volume</span>
      </nav>

      <header className="hero">
        <h1>Turn market slides into Value &amp; Volume CSVs</h1>
        <p>
          Upload segmentation and geography charts. Quantify extracts the hierarchy and
          builds forecast-ready files for 2021–2033.
        </p>
      </header>

      {files.length > 0 && (
        <section className="metrics-strip" aria-label="Upload summary">
          <div className="metric-card">
            <label>Files</label>
            <strong>{files.length}</strong>
          </div>
          <div className="metric-card">
            <label>Segments</label>
            <strong>{segmentCount}</strong>
          </div>
          <div className="metric-card">
            <label>Geographies</label>
            <strong>{geographyCount}</strong>
          </div>
          <div className="metric-card">
            <label>Rows</label>
            <strong>{allRows.length.toLocaleString()}</strong>
          </div>
        </section>
      )}

      {uploadNotice && (
        <div className="notice" role="status">
          <svg className="notice-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          {uploadNotice}
        </div>
      )}

      <div className="grid-2">
        <FileUploader
          title="Segments & Sub-segments"
          description="Product type, application, technology, age group, end user charts. Drop all segment slides here — multiple uploads accumulate."
          category="segments"
          variant="segments"
          files={files}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
        <FileUploader
          title="Geographies"
          description="By region, by country, and regional breakdown slides. Multiple uploads accumulate."
          category="geographies"
          variant="geographies"
          files={files}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </div>

      <section className="action-panel">
        <div className="action-panel-header">
          <div>
            <h2>Generate &amp; export</h2>
            <p>
              {processing
                ? `Processing files… ${progress}%`
                : pendingCount > 0
                  ? `${pendingCount} file${pendingCount === 1 ? "" : "s"} ready to extract`
                  : canDownload
                    ? "Extraction complete — download your CSV files"
                    : "Upload files above to get started"}
            </p>
          </div>
        </div>

        {canDownload && (
          <div className="download-banner">
            <div className="download-banner-header">
              <div className="download-banner-icon" aria-hidden>
                ✓
              </div>
              <h3>Your CSV files are ready</h3>
            </div>
            <p>
              Saves directly to your browser&apos;s Downloads folder
              {doneCount === 1 ? " (from 1 processed file)" : ` (from ${doneCount} processed files)`}.
            </p>
            <div className="actions download-actions">
              <button type="button" className="btn btn-success btn-lg" onClick={handleDownloadValue}>
                Value.csv
              </button>
              <button type="button" className="btn btn-success btn-lg" onClick={handleDownloadVolume}>
                Volume.csv
              </button>
              {doneCount > 1 && (
                <button type="button" className="btn btn-primary btn-lg" onClick={handleDownloadBoth}>
                  Download both
                </button>
              )}
            </div>
          </div>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={pendingCount === 0 || processing}
            onClick={processFiles}
          >
            {processing
              ? `Extracting… ${progress}%`
              : pendingCount > 0
                ? `Extract from ${pendingCount} file${pendingCount === 1 ? "" : "s"}`
                : doneCount > 0
                  ? "Re-extract all files"
                  : "Extract data"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={files.length === 0 || processing}
            onClick={clearAll}
          >
            Clear all
          </button>
        </div>

        {processing && (
          <div className="progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
          </div>
        )}

        {canDownload && stats && (
          <div className="stats-grid">
            <div className="stat">
              <label>Value rows</label>
              <strong>
                {stats.valueFilled}/{stats.valueTotal}
              </strong>
            </div>
            <div className="stat">
              <label>Volume rows</label>
              <strong>
                {stats.volumeFilled}/{stats.volumeTotal}
              </strong>
            </div>
            <div className="stat">
              <label>With data</label>
              <strong>{stats.valueFilled + stats.volumeFilled}</strong>
            </div>
            <div className="stat">
              <label>Processed</label>
              <strong>
                {doneCount}/{files.length}
              </strong>
            </div>
          </div>
        )}

        {canDownload && lastOcrPreview && (
          <details className="ocr-details">
            <summary>Latest OCR preview</summary>
            <div className="preview-box">{lastOcrPreview}</div>
          </details>
        )}
      </section>

      <footer className="page-footer">
        Quantify · Aligned to Value 1.csv &amp; Volume2.csv templates
      </footer>
    </main>
  );
}
