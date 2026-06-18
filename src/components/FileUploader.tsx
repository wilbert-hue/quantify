"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { collectUploadFiles, getFileKind, readDroppedFiles } from "@/lib/fileUpload";
import type { UploadCategory, UploadedFile } from "@/lib/types";

interface FileUploaderProps {
  title: string;
  description: string;
  category: UploadCategory;
  variant?: "segments" | "geographies";
  files: UploadedFile[];
  onAdd: (files: File[], category: UploadCategory) => void;
  onRemove: (id: string) => void;
}

export function FileUploader({
  title,
  description,
  category,
  variant = category === "segments" ? "segments" : "geographies",
  files,
  onAdd,
  onRemove,
}: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const [viewing, setViewing] = useState<{ src: string; name: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!viewing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewing(null);
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [viewing]);

  const openPreview = useCallback((src: string, name: string) => {
    setViewing({ src, name });
  }, []);

  const filtered = files.filter((f) => f.category === category);

  const ingestFiles = useCallback(
    (incoming: File[]) => {
      const supported = collectUploadFiles(incoming);
      setDropError("");

      if (supported.length === 0) {
        setDropError("No supported files found. Use images (PNG, JPG), Excel (.xlsx), or CSV.");
        return;
      }

      onAdd(supported, category);
    },
    [category, onAdd]
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);

      try {
        const dropped = await readDroppedFiles(event.dataTransfer);
        ingestFiles(dropped);
      } catch {
        setDropError("Could not read dropped files. Try browsing instead.");
      }
    },
    [ingestFiles]
  );

  return (
    <section className={`card card-${variant}`}>
      <div className="card-header-row">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {filtered.length > 0 && (
          <span className="count-badge">{filtered.length} files</span>
        )}
      </div>

      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>
        <strong>Drop files here or click to browse</strong>
        <span>PNG, JPG, Excel, or CSV · unlimited uploads</span>

        <div className="upload-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Browse files
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => folderInputRef.current?.click()}
          >
            Browse folder
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.csv,.xlsx,.xls"
          multiple
          onChange={(e) => {
            if (e.target.files) ingestFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          accept="image/*,.csv,.xlsx,.xls"
          multiple
          {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => {
            if (e.target.files) ingestFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {dropError && <p className="upload-error">{dropError}</p>}

      {filtered.length > 0 && (
        <>
          <p className="upload-hint">
            {filtered.length} file{filtered.length === 1 ? "" : "s"} queued
          </p>
          <div className="image-list-scroll">
            <div className="image-list">
              {filtered.map((item, index) => (
                <div key={item.id} className="image-item">
                  {item.kind === "image" ? (
                    <button
                      type="button"
                      className="image-thumb-btn"
                      onClick={() => openPreview(item.preview, item.file.name)}
                      aria-label={`View ${item.file.name}`}
                      title="Click to view full image"
                    >
                      <img src={item.preview} alt="" />
                    </button>
                  ) : (
                    <div className="file-icon">{item.file.name.endsWith(".csv") ? "CSV" : "XLS"}</div>
                  )}
                  <div className="image-meta">
                    {item.kind === "image" ? (
                      <button
                        type="button"
                        className="image-name-btn"
                        onClick={() => openPreview(item.preview, item.file.name)}
                        title="Click to view full image"
                      >
                        {index + 1}. {item.file.name}
                      </button>
                    ) : (
                      <strong title={item.file.name}>
                        {index + 1}. {item.file.name}
                      </strong>
                    )}
                    <small>
                      {item.status === "done"
                        ? item.parsedRows?.length
                          ? `${item.parsedRows.length} rows extracted`
                          : "Processed — no rows found"
                        : item.status === "processing"
                          ? item.kind === "spreadsheet"
                            ? "Reading spreadsheet…"
                            : "Reading image…"
                          : item.status === "error"
                            ? item.error ?? "Processing failed"
                            : "Waiting"}
                    </small>
                    {item.status === "processing" && (
                      <div className="progress-bar">
                        <span style={{ width: "60%" }} />
                      </div>
                    )}
                  </div>
                  <div>
                    <span className={`status ${item.status}`}>{item.status}</span>
                    <button
                      type="button"
                      className="remove-btn"
                      onClick={() => onRemove(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {mounted &&
        viewing &&
        createPortal(
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview: ${viewing.name}`}
          >
            <button
              type="button"
              className="image-lightbox-backdrop"
              onClick={() => setViewing(null)}
              aria-label="Close preview"
            />
            <div className="image-lightbox-panel">
              <div className="image-lightbox-header">
                <span className="image-lightbox-title">{viewing.name}</span>
                <button
                  type="button"
                  className="image-lightbox-close"
                  onClick={() => setViewing(null)}
                  aria-label="Close preview"
                >
                  ×
                </button>
              </div>
              <div className="image-lightbox-body">
                <img src={viewing.src} alt={viewing.name} />
              </div>
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}

export function filePreviewFor(file: File): { preview: string; kind: UploadedFile["kind"] } {
  const kind = getFileKind(file);
  if (kind === "spreadsheet") {
    return { preview: "", kind };
  }
  return { preview: URL.createObjectURL(file), kind };
}
