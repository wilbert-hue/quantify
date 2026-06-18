const IMAGE_TYPES = /^image\/(jpeg|jpg|png|gif|webp|bmp|tiff)$/i;
const SPREADSHEET_EXT = /\.(xlsx|xls|csv)$/i;

export function isImageFile(file: File): boolean {
  if (file.type && IMAGE_TYPES.test(file.type)) return true;
  return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(file.name);
}

export function isSpreadsheetFile(file: File): boolean {
  if (
    file.type.includes("spreadsheet") ||
    file.type.includes("excel") ||
    file.type === "text/csv"
  ) {
    return true;
  }
  return SPREADSHEET_EXT.test(file.name);
}

export function isSupportedFile(file: File): boolean {
  return isImageFile(file) || isSpreadsheetFile(file);
}

export function getFileKind(file: File): "image" | "spreadsheet" {
  return isSpreadsheetFile(file) ? "spreadsheet" : "image";
}

export function collectUploadFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(isSupportedFile);
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(isSupportedFile(file) ? file : null),
      () => resolve(null)
    );
  });
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const entries: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        () => resolve(entries)
      );
    };

    readBatch();
  });
}

async function traverseEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    return file ? [file] : [];
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await readDirectoryEntries(reader);
    const nested = await Promise.all(entries.map(traverseEntry));
    return nested.flat();
  }

  return [];
}

export async function readDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = dataTransfer.items;

  if (items && items.length > 0) {
    const entries = Array.from(items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry));

    if (entries.length > 0) {
      const nested = await Promise.all(entries.map(traverseEntry));
      return dedupeFiles(nested.flat());
    }
  }

  return dedupeFiles(collectUploadFiles(dataTransfer.files));
}

export function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const unique: File[] = [];

  for (const file of files) {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }

  return unique;
}

export function fileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function detectDataset(file: File, sheetName?: string): "value" | "volume" {
  const hint = `${file.name} ${sheetName ?? ""}`.toLowerCase();
  return /volume/.test(hint) ? "volume" : "value";
}
