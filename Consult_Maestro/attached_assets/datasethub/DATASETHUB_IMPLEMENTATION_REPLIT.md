# DatasetHub — Plano de Implementação para o Replit
**Data:** 26/05/2026  
**Arquivo gerado:** `client/src/pages/DatasetHub.tsx` (já criado)

---

## O que o Replit precisa fazer

### PASSO 1 — Registrar a rota em `client/src/App.tsx`

Adicionar import lazy:
```typescript
const DatasetHub = lazy(() => import("@/pages/DatasetHub"));
```

Adicionar rota (dentro do bloco de rotas autenticadas, junto com /integracoes):
```typescript
<Route path="/datasets" component={DatasetHub} />
```

---

### PASSO 2 — Adicionar no sidebar (AppSidebar.tsx ou menu de navegação)

Buscar onde `/integracoes` está listado no menu e adicionar abaixo:
```typescript
{
  label: "Datasets",
  href: "/datasets",
  icon: Database,  // import { Database } from "lucide-react"
}
```

---

### PASSO 3 — Rotas de backend em `server/routes.ts`

Adicionar junto às rotas existentes (pode ser no final, antes do fechamento de registerRoutes):

```typescript
// ── DatasetHub — Upload de dump SQL via multipart ──────────────────────────
app.post("/api/atlas/sync/dump-upload/:dataSourceId", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    // Salvar arquivo temporário
    const multer = (await import("multer")).default;
    const path = await import("path");
    const os = await import("os");

    const tmpDir = os.tmpdir();
    const upload = multer({
      dest: tmpDir,
      limits: { fileSize: 600 * 1024 * 1024 }, // 600MB
    });

    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res as any, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!req.file) return res.status(400).json({ message: "Arquivo não enviado" });

    // Extrair zip se necessário
    let filePath = req.file.path;
    const fs = await import("fs");
    if (req.file.originalname?.endsWith(".zip") || req.file.mimetype === "application/zip") {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries().filter(e => e.entryName.endsWith(".sql"));
      if (entries.length === 0) return res.status(400).json({ message: "ZIP não contém arquivo .sql" });
      const tmpSql = path.join(tmpDir, `atlas_${Date.now()}.sql`);
      zip.extractEntryTo(entries[0], tmpDir, false, true);
      filePath = path.join(tmpDir, entries[0].entryName.split("/").pop()!);
    }

    // Importar
    const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
    const importResult = await importAtlasDump({
      filePath,
      arcadiaTenantId: req.tenantId!,
    });

    // ETL
    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    // Limpar arquivo temporário
    fs.unlink(filePath, () => {});
    if (req.file.path !== filePath) fs.unlink(req.file.path, () => {});

    // Atualizar data source
    const { db } = await import("./db");
    const { sql: drizzleSql } = await import("drizzle-orm");
    await db.execute(drizzleSql.raw(`
      UPDATE analytics.atlas_data_sources
      SET last_sync_at = NOW(), last_sync_status = 'success',
          last_dump_filename = '${req.file.originalname}',
          last_dump_processed_at = NOW(),
          sync_rows_total = ${importResult.totalRows},
          updated_at = NOW()
      WHERE arcadia_tenant_id = '${req.tenantId}'
        AND mode = 'dump'
      LIMIT 1
    `));

    res.json({ import: importResult, etl: etlResult });
  } catch (err: any) {
    console.error("[atlas/dump-upload] error:", err);
    res.status(500).json({ message: err.message });
  }
});

// ── DatasetHub — Download e import via URL externa ─────────────────────────
app.post("/api/atlas/sync/dump-url/:dataSourceId", isAuthenticated, requireTenantAdmin, async (req: any, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ message: "url required" });

    // Validar URL (apenas http/https)
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ message: "URL deve ser http ou https" });
    }

    const os = await import("os");
    const path = await import("path");
    const fs = await import("fs");
    const { default: https } = await import("https");
    const { default: http } = await import("http");

    const tmpFile = path.join(os.tmpdir(), `atlas_url_${Date.now()}.zip`);

    // Download com redirect follow
    await new Promise<void>((resolve, reject) => {
      const protocol = parsed.protocol === "https:" ? https : http;
      const file = fs.createWriteStream(tmpFile);
      protocol.get(url, (response) => {
        // Follow redirect
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location!;
          const rProto = redirectUrl.startsWith("https") ? https : http;
          rProto.get(redirectUrl, (r2) => {
            r2.pipe(file);
            file.on("finish", () => { file.close(); resolve(); });
          }).on("error", reject);
        } else {
          response.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }
      }).on("error", reject);
    });

    // Extrair se zip
    let filePath = tmpFile;
    if (url.includes(".zip") || (fs.statSync(tmpFile).size < 1000 && fs.readFileSync(tmpFile, "utf8").startsWith("PK"))) {
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(tmpFile);
      const entries = zip.getEntries().filter(e => e.entryName.endsWith(".sql"));
      if (entries.length > 0) {
        zip.extractEntryTo(entries[0], os.tmpdir(), false, true);
        filePath = path.join(os.tmpdir(), entries[0].entryName.split("/").pop()!);
      }
    }

    // Importar + ETL
    const { importAtlasDump } = await import("./bi/connectors/atlasDumpConnector");
    const importResult = await importAtlasDump({
      filePath,
      arcadiaTenantId: req.tenantId!,
    });

    const { runAtlasEtl } = await import("./bi/etl/atlasEtl");
    const etlResult = await runAtlasEtl(req.tenantId!);

    // Limpeza
    fs.unlink(tmpFile, () => {});
    if (filePath !== tmpFile) fs.unlink(filePath, () => {});

    res.json({ import: importResult, etl: etlResult });
  } catch (err: any) {
    console.error("[atlas/dump-url] error:", err);
    res.status(500).json({ message: err.message });
  }
});
```

---

### PASSO 4 — Instalar dependência `adm-zip`

```bash
npm install adm-zip
npm install @types/adm-zip --save-dev
```

---

### PASSO 5 — Verificação

Após deploy:
1. Acessar `/datasets` — deve mostrar o catálogo com Atlas homologado + TOTVS e Omie em homologação
2. Clicar no card Atlas → painel de detalhes com 3 abas (Conexões, Métricas, Histórico)
3. Clicar "Conectar sistema" → modal com seletor Import SQL / PostgreSQL live
4. Criar conexão modo "dump" → volta para lista, aparece card de conexão com botão "Importar"
5. Clicar "Importar" → modal com abas Upload / Link externo
6. Upload de um .zip → barra de progresso → tela de resultado com contagem por tabela
7. Clicar "Abrir BI Builder" → deve ter métricas atlas.* disponíveis no catálogo semântico
