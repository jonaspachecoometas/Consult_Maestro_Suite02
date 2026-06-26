// Sprint RH-4 — empacota os arquivos em um ZIP em memória usando archiver.
// archiver v8 é ESM-only e expõe apenas classes (sem factory function);
// instanciamos ZipArchive diretamente.

import { ZipArchive } from "archiver";

export async function buildExportZip(files: Record<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive: any = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("warning", (err: any) => {
      if (err.code !== "ENOENT") reject(err);
    });
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    for (const [name, buf] of Object.entries(files)) {
      archive.append(buf, { name });
    }
    archive.finalize().catch(reject);
  });
}
