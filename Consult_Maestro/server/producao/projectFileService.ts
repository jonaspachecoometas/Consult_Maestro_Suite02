// Extração de texto para o Drive da Central de Produção.
// Falhas são silenciosas — não bloqueiam o upload.

const MAX_CHARS = 50_000;

export async function extractText(buffer: Buffer, mimeType: string, originalName?: string): Promise<string> {
  const mime = (mimeType || "").toLowerCase();
  const name = (originalName || "").toLowerCase();

  try {
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const mod: any = await import("pdf-parse");
      const pdfParse = mod.default || mod;
      const data = await pdfParse(buffer);
      return String(data?.text || "").slice(0, MAX_CHARS);
    }

    if (
      mime.includes("word") ||
      mime.includes("officedocument.wordprocessingml") ||
      name.endsWith(".docx") ||
      name.endsWith(".doc")
    ) {
      const mammoth: any = (await import("mammoth")).default || (await import("mammoth"));
      const { value } = await mammoth.extractRawText({ buffer });
      return String(value || "").slice(0, MAX_CHARS);
    }

    if (
      mime.includes("spreadsheetml") ||
      mime.includes("excel") ||
      mime.includes("csv") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv")
    ) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buffer, { type: "buffer" });
      return wb.SheetNames
        .map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
        .join("\n\n")
        .slice(0, MAX_CHARS);
    }

    if (
      mime.startsWith("text/") ||
      name.endsWith(".txt") ||
      name.endsWith(".md") ||
      name.endsWith(".json")
    ) {
      return buffer.toString("utf8").slice(0, MAX_CHARS);
    }
  } catch (err: any) {
    console.warn(`[projectFileService] extractText failed for ${originalName} (${mimeType}):`, err?.message);
  }
  return "";
}

export function mapFileType(mimeType: string, originalName: string): string {
  const m = (mimeType || "").toLowerCase();
  const n = (originalName || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return "image";
  if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (m.includes("word") || /\.(docx?|odt)$/.test(n)) return "document";
  if (m.includes("spreadsheet") || m.includes("excel") || /\.(xlsx?|csv|ods)$/.test(n)) return "spreadsheet";
  if (m.includes("presentation") || /\.(pptx?|odp)$/.test(n)) return "presentation";
  if (m.startsWith("video/") || /\.(mp4|mov|avi|mkv)$/.test(n)) return "video";
  if (m.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/.test(n)) return "audio";
  return "other";
}
