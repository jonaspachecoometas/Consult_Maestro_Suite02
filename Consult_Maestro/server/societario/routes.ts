import type { Express } from "express";
import { db } from "../db";
import {
  sociedades,
  socios,
  alteracoesSocietarias,
  documentosSocietarios,
  obrigacoesSocietarias,
  certificadosDigitais,
  insertSociedadeSchema,
  insertSocioSchema,
  insertAlteracaoSocietariaSchema,
  insertDocumentoSocietarioSchema,
  insertObrigacaoSocietariaSchema,
  insertCertificadoDigitalSchema,
} from "@shared/schema";
import { isAuthenticated } from "../portableAuth";
import { requireTenant } from "../tenantContext";
import { and, eq, sql, desc, asc, gte, lte, ilike, or } from "drizzle-orm";
import { registerSocietarioAgentRoutes } from "./agentChat";
import { registerPipelineSocietarioRoutes } from "./pipeline/routes";
import { ObjectStorageService, ObjectNotFoundError } from "../objectStorage";
import { extractText } from "../superAgentFiles";
import { createHmac, timingSafeEqual } from "crypto";

const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min

// Detecção de tipo confiável: SEMPRE inspeciona magic bytes do buffer real,
// não confia em fileName/fileMime do cliente. Para texto puro (sem magic),
// valida que o conteúdo é UTF-8 e a extensão pertence à lista de texto.
type DetectedKind =
  | "pdf" | "office_zip" | "office_ole"
  | "png" | "jpeg" | "webp"
  | "text" | "unknown";

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

// Verifica se um ZIP contém os marcadores OOXML mínimos (filename é ASCII no
// directory header — `buf.includes` funciona mesmo em arquivos comprimidos).
function detectOoxmlVariant(buf: Buffer): "docx" | "xlsx" | null {
  const hasContentTypes = buf.includes(Buffer.from("[Content_Types].xml"));
  if (!hasContentTypes) return null;
  if (buf.includes(Buffer.from("word/document.xml"))) return "docx";
  if (buf.includes(Buffer.from("xl/workbook.xml"))) return "xlsx";
  return null;
}

// Verifica se uma janela de bytes é texto "razoável": UTF-8 válido, sem bytes
// nulos e com fração baixa de caracteres de controle não-whitespace.
function looksLikeText(window: Buffer): boolean {
  if (window.length === 0) return false;
  if (window.indexOf(0) !== -1) return false;
  let ctrl = 0;
  for (const b of window) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) ctrl++;
  }
  if (ctrl / window.length > 0.02) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(window);
    return true;
  } catch {
    return false;
  }
}

function detectKind(buf: Buffer): DetectedKind {
  if (buf.length === 0) return "unknown";
  // PDF: %PDF-
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "pdf";
  // PNG
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // JPEG
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  // WEBP: RIFF....WEBP
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  // ZIP-based (DOCX/XLSX): PK\x03\x04 / PK\x05\x06 / PK\x07\x08
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
      startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(buf, [0x50, 0x4b, 0x07, 0x08])) return "office_zip";
  // OLE compound (DOC/XLS antigos)
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "office_ole";
  // Texto: amostra início + meio + fim do arquivo (pega arquivos híbridos texto+binário)
  const len = buf.length;
  const head = buf.subarray(0, Math.min(len, 4096));
  const middle = len > 8192
    ? buf.subarray(Math.floor(len / 2), Math.floor(len / 2) + 2048)
    : Buffer.alloc(0);
  const tail = len > 4096
    ? buf.subarray(Math.max(0, len - 2048))
    : Buffer.alloc(0);
  if (looksLikeText(head) && (middle.length === 0 || looksLikeText(middle)) && (tail.length === 0 || looksLikeText(tail))) {
    return "text";
  }
  return "unknown";
}

// Mime canônico (derivado do servidor) por (kind, ext). Retorna null se rejeitado.
function resolveMimeForKind(kind: DetectedKind, fileName: string): string | null {
  const lower = (fileName || "").toLowerCase();
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".")) : "";
  switch (kind) {
    case "pdf":  return ext === ".pdf" ? "application/pdf" : null;
    case "png":  return ext === ".png" ? "image/png" : null;
    case "jpeg": return ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : null;
    case "webp": return ext === ".webp" ? "image/webp" : null;
    case "office_zip":
      if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return null;
    case "office_ole":
      if (ext === ".doc") return "application/msword";
      if (ext === ".xls") return "application/vnd.ms-excel";
      return null;
    case "text":
      if (ext === ".txt") return "text/plain";
      if (ext === ".md")  return "text/markdown";
      if (ext === ".csv") return "text/csv";
      if (ext === ".json") return "application/json";
      return null;
    default: return null;
  }
}

function normalizeStoragePath(p?: string | null): string | null {
  if (!p) return null;
  return p.startsWith("/objects/") ? p : `/objects/${String(p).replace(/^\/+/, "")}`;
}

// Token de intenção HMAC: amarra a uploadURL ao tenant + sociedade + usuário.
// Evita que uma URL assinada vazada seja usada para anexar a outra sociedade.
function uploadIntentSecret(): Buffer {
  const s = process.env.SESSION_SECRET || "";
  if (!s) throw new Error("SESSION_SECRET não configurado");
  return Buffer.from(s, "utf8");
}

function createUploadToken(opts: {
  tenantId: string; userId: string; sociedadeId: string; path: string;
}): string {
  const expiry = Date.now() + UPLOAD_TOKEN_TTL_MS;
  const payload = `${opts.tenantId}|${opts.userId}|${opts.sociedadeId}|${opts.path}|${expiry}`;
  const sig = createHmac("sha256", uploadIntentSecret()).update(payload).digest("base64url");
  return `${expiry}.${sig}`;
}

function verifyUploadToken(opts: {
  token: string; tenantId: string; userId: string; sociedadeId: string; path: string;
}): boolean {
  try {
    const [expiryStr, sig] = String(opts.token).split(".");
    if (!expiryStr || !sig) return false;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
    const payload = `${opts.tenantId}|${opts.userId}|${opts.sociedadeId}|${opts.path}|${expiry}`;
    const expected = createHmac("sha256", uploadIntentSecret()).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function ensureCertificado(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(certificadosDigitais)
    .where(and(eq(certificadosDigitais.id, id), eq(certificadosDigitais.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureAlteracao(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(alteracoesSocietarias)
    .where(and(eq(alteracoesSocietarias.id, id), eq(alteracoesSocietarias.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureDocumento(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(documentosSocietarios)
    .where(and(eq(documentosSocietarios.id, id), eq(documentosSocietarios.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureSociedade(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(sociedades)
    .where(and(eq(sociedades.id, id), eq(sociedades.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureSocio(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(socios)
    .where(and(eq(socios.id, id), eq(socios.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

async function ensureObrigacao(id: string, tenantId: string) {
  const [row] = await db
    .select()
    .from(obrigacoesSocietarias)
    .where(and(eq(obrigacoesSocietarias.id, id), eq(obrigacoesSocietarias.tenantId, tenantId)))
    .limit(1);
  return row || null;
}

export function registerSocietarioRoutes(app: Express) {
  // ---------- AGENT CHAT ----------
  registerSocietarioAgentRoutes(app);
  registerPipelineSocietarioRoutes(app);

  // ---------- LIST + CREATE sociedades ----------
  app.get("/api/societario/sociedades", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const { status, q, limit = "100", offset = "0" } = req.query as Record<string, string>;
      const conds = [eq(sociedades.tenantId, tenantId)];
      if (status && status !== "todas") conds.push(eq(sociedades.status, status));
      if (q && q.trim()) {
        const like = `%${q.trim()}%`;
        conds.push(or(ilike(sociedades.razaoSocial, like), ilike(sociedades.nomeFantasia, like), ilike(sociedades.cnpj, like))!);
      }
      const rows = await db
        .select()
        .from(sociedades)
        .where(and(...conds))
        .orderBy(desc(sociedades.createdAt))
        .limit(Math.min(Number(limit) || 100, 500))
        .offset(Number(offset) || 0);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar sociedades" });
    }
  });

  app.post("/api/societario/sociedades", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const parsed = insertSociedadeSchema.parse({ ...req.body, tenantId });
      // CNPJ único por tenant (quando informado)
      if (parsed.cnpj) {
        const [exists] = await db
          .select({ id: sociedades.id })
          .from(sociedades)
          .where(and(eq(sociedades.tenantId, tenantId), eq(sociedades.cnpj, parsed.cnpj)))
          .limit(1);
        if (exists) return res.status(409).json({ message: "CNPJ já cadastrado neste workspace" });
      }
      const [row] = await db.insert(sociedades).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao criar sociedade" });
    }
  });

  // ---------- DETAIL / UPDATE / SOFT-DELETE ----------
  app.get("/api/societario/sociedades/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const [sociosList, docs, obrigs, certs] = await Promise.all([
        db.select().from(socios).where(and(eq(socios.sociedadeId, sociedade.id), eq(socios.tenantId, tenantId), eq(socios.isAtivo, 1))).orderBy(desc(socios.percentualParticipacao)),
        db.select().from(documentosSocietarios).where(and(eq(documentosSocietarios.sociedadeId, sociedade.id), eq(documentosSocietarios.tenantId, tenantId))).orderBy(desc(documentosSocietarios.createdAt)).limit(50),
        db.select().from(obrigacoesSocietarias).where(and(eq(obrigacoesSocietarias.sociedadeId, sociedade.id), eq(obrigacoesSocietarias.tenantId, tenantId))).orderBy(asc(obrigacoesSocietarias.dataVencimento)).limit(100),
        db.select().from(certificadosDigitais).where(and(eq(certificadosDigitais.sociedadeId, sociedade.id), eq(certificadosDigitais.tenantId, tenantId))).orderBy(desc(certificadosDigitais.dataValidade)),
      ]);
      // strip arquivoEnc bytes
      const certsSafe = certs.map(({ arquivoEnc, ...c }) => ({ ...c, hasArquivo: !!arquivoEnc }));
      res.json({ ...sociedade, socios: sociosList, documentos: docs, obrigacoes: obrigs, certificados: certsSafe });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao buscar sociedade" });
    }
  });

  app.patch("/api/societario/sociedades/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureSociedade(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Sociedade não encontrada" });
      // Whitelist explícito — nunca aceitar id/tenantId/timestamps do body
      const allowed = [
        "clientId", "razaoSocial", "nomeFantasia", "cnpj", "inscricaoEstadual", "inscricaoMunicipal",
        "regimeTributario", "naturezaJuridica", "capitalSocial", "dataConstituicao",
        "enderecoLogradouro", "enderecoNumero", "enderecoComplemento", "enderecoBairro",
        "enderecoCidade", "enderecoUf", "enderecoCep", "objetoSocial", "cnaePrincipal",
        "cnaesSecundarios", "status", "observacoes",
      ] as const;
      const safe: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(sociedades)
        .set(safe)
        .where(and(eq(sociedades.id, found.id), eq(sociedades.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar sociedade" });
    }
  });

  app.delete("/api/societario/sociedades/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureSociedade(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Sociedade não encontrada" });
      await db
        .update(sociedades)
        .set({ status: "inativa", updatedAt: new Date() })
        .where(and(eq(sociedades.id, found.id), eq(sociedades.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao remover sociedade" });
    }
  });

  // ---------- SÓCIOS ----------
  app.get("/api/societario/sociedades/:id/socios", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const rows = await db
        .select()
        .from(socios)
        .where(and(eq(socios.sociedadeId, sociedade.id), eq(socios.isAtivo, 1)))
        .orderBy(desc(socios.percentualParticipacao));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar sócios" });
    }
  });

  app.post("/api/societario/sociedades/:id/socios", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const parsed = insertSocioSchema.parse({ ...req.body, sociedadeId: sociedade.id, tenantId });
      const [row] = await db.insert(socios).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao adicionar sócio" });
    }
  });

  app.patch("/api/societario/socios/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureSocio(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Sócio não encontrado" });
      // Whitelist — nunca aceitar id/tenantId/sociedadeId do body
      // (impedir mover sócio entre sociedades ou tenants)
      const allowed = [
        "nome", "tipoPessoa", "cpfCnpj", "rg", "nacionalidade", "estadoCivil", "profissao",
        "email", "telefone", "enderecoCompleto", "qualificacao", "percentualParticipacao",
        "valorIntegralizado", "dataEntrada", "dataSaida", "isAtivo", "observacoes",
      ] as const;
      const safe: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(socios)
        .set(safe)
        .where(and(eq(socios.id, found.id), eq(socios.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar sócio" });
    }
  });

  app.delete("/api/societario/socios/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureSocio(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Sócio não encontrado" });
      await db.delete(socios).where(and(eq(socios.id, found.id), eq(socios.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao remover sócio" });
    }
  });

  // ---------- ALTERAÇÕES ----------
  app.get("/api/societario/sociedades/:id/alteracoes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const rows = await db
        .select()
        .from(alteracoesSocietarias)
        .where(eq(alteracoesSocietarias.sociedadeId, sociedade.id))
        .orderBy(desc(alteracoesSocietarias.dataEvento));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar alterações" });
    }
  });

  app.post("/api/societario/sociedades/:id/alteracoes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      // Snapshot quadro atual
      const sociosAtuais = await db
        .select()
        .from(socios)
        .where(and(eq(socios.sociedadeId, sociedade.id), eq(socios.isAtivo, 1)));
      const snapshot = {
        capitalSocial: sociedade.capitalSocial,
        socios: sociosAtuais.map((s) => ({
          id: s.id,
          nome: s.nome,
          cpfCnpj: s.cpfCnpj,
          percentual: s.percentualParticipacao,
          qualificacao: s.qualificacao,
        })),
      };
      const parsed = insertAlteracaoSocietariaSchema.parse({
        ...req.body,
        sociedadeId: sociedade.id,
        tenantId,
        snapshotQuadro: snapshot,
        createdBy: req.user?.id,
      });
      const [row] = await db.insert(alteracoesSocietarias).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao registrar alteração" });
    }
  });

  app.patch("/api/societario/alteracoes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureAlteracao(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Alteração não encontrada" });
      const allowed = ["descricao", "dataRegistro", "orgaoRegistro", "numeroRegistro", "status"] as const;
      const safe: Record<string, any> = {};
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(alteracoesSocietarias)
        .set(safe)
        .where(and(eq(alteracoesSocietarias.id, found.id), eq(alteracoesSocietarias.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar alteração" });
    }
  });

  app.delete("/api/societario/alteracoes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureAlteracao(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Alteração não encontrada" });
      await db.delete(alteracoesSocietarias).where(and(eq(alteracoesSocietarias.id, found.id), eq(alteracoesSocietarias.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao remover alteração" });
    }
  });

  // ---------- ALTERAÇÕES (tenant-wide para painel de controle) ----------
  // Lista alterações do tenant com dados da sociedade (join). Filtros:
  //   ?status=pendente|registrada|cancelada
  //   ?sociedadeStatus=ativa|inativa|...
  //   ?limit (default 200)
  // Retorna também `dias_decorridos` (desde data_evento até hoje).
  app.get("/api/societario/alteracoes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const { status, sociedadeStatus, limit = "200" } = req.query as Record<string, string>;
      // Defense-in-depth: filtra por tenant nas DUAS tabelas (não confia só no FK).
      const conds = [
        eq(alteracoesSocietarias.tenantId, tenantId),
        eq(sociedades.tenantId, tenantId),
      ];
      if (status && status !== "todos") conds.push(eq(alteracoesSocietarias.status, status));
      if (sociedadeStatus && sociedadeStatus !== "todas") conds.push(eq(sociedades.status, sociedadeStatus));
      const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
      const rows = await db
        .select({
          id: alteracoesSocietarias.id,
          sociedadeId: alteracoesSocietarias.sociedadeId,
          tipo: alteracoesSocietarias.tipo,
          descricao: alteracoesSocietarias.descricao,
          dataEvento: alteracoesSocietarias.dataEvento,
          dataRegistro: alteracoesSocietarias.dataRegistro,
          orgaoRegistro: alteracoesSocietarias.orgaoRegistro,
          numeroRegistro: alteracoesSocietarias.numeroRegistro,
          status: alteracoesSocietarias.status,
          createdAt: alteracoesSocietarias.createdAt,
          sociedadeRazaoSocial: sociedades.razaoSocial,
          sociedadeNomeFantasia: sociedades.nomeFantasia,
          sociedadeStatus: sociedades.status,
          diasDecorridos: sql<number>`(CURRENT_DATE - ${alteracoesSocietarias.dataEvento})::int`,
        })
        .from(alteracoesSocietarias)
        .innerJoin(sociedades, eq(sociedades.id, alteracoesSocietarias.sociedadeId))
        .where(and(...conds))
        .orderBy(desc(alteracoesSocietarias.dataEvento))
        .limit(lim);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar alterações" });
    }
  });

  // Contadores de alterações pendentes por sociedade (para badge na lista).
  // Retorna [{ sociedade_id, total }] apenas onde total > 0 e a sociedade é do tenant.
  app.get("/api/societario/alteracoes/pendentes-por-sociedade", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const rows = await db
        .select({
          sociedadeId: alteracoesSocietarias.sociedadeId,
          total: sql<number>`COUNT(*)::int`,
        })
        .from(alteracoesSocietarias)
        .where(and(
          eq(alteracoesSocietarias.tenantId, tenantId),
          eq(alteracoesSocietarias.status, "pendente"),
        ))
        .groupBy(alteracoesSocietarias.sociedadeId);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao agregar alterações pendentes" });
    }
  });

  // ---------- DOCUMENTOS ----------
  app.get("/api/societario/sociedades/:id/documentos", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const { tipo } = req.query as Record<string, string>;
      const conds = [eq(documentosSocietarios.sociedadeId, sociedade.id)];
      if (tipo) conds.push(eq(documentosSocietarios.tipo, tipo));
      const rows = await db
        .select()
        .from(documentosSocietarios)
        .where(and(...conds))
        .orderBy(desc(documentosSocietarios.createdAt));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar documentos" });
    }
  });

  // URL assinada de upload — fluxo PUT direto pro Object Storage.
  // Devolve também um uploadToken (HMAC) que amarra a URL ao tenant/usuário/sociedade.
  app.post(
    "/api/societario/sociedades/:id/documentos/upload-url",
    isAuthenticated,
    requireTenant,
    async (req: any, res) => {
      try {
        const tenantId = req.tenantId as string;
        const userId: string | undefined = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Usuário não identificado" });
        const sociedade = await ensureSociedade(req.params.id, tenantId);
        if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
        const svc = new ObjectStorageService();
        const uploadURL = await svc.getObjectEntityUploadURL();
        const path = svc.normalizeObjectEntityPath(uploadURL);
        const uploadToken = createUploadToken({
          tenantId, userId, sociedadeId: sociedade.id, path,
        });
        res.json({ uploadURL, uploadToken });
      } catch (err: any) {
        console.error("[societario] upload-url:", err);
        res.status(500).json({ message: err?.message || "Falha ao gerar URL de upload" });
      }
    },
  );

  app.post("/api/societario/sociedades/:id/documentos", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });

      const body = req.body ?? {};
      const baseFields: Record<string, any> = {
        tipo: body.tipo,
        titulo: body.titulo,
        descricao: body.descricao,
        conteudoMarkdown: body.conteudoMarkdown,
        dataDocumento: body.dataDocumento || null,
        dataValidade: body.dataValidade || null,
        numeroDocumento: body.numeroDocumento,
        variaveis: body.variaveis,
        sociedadeId: sociedade.id,
        tenantId,
        uploadedBy: req.user?.id,
      };

      // Se veio uploadURL (fluxo de arquivo), baixa do storage, extrai texto e popula metadados
      let extractWarning: string | null = null;
      if (body.uploadURL) {
        const userId: string | undefined = req.user?.id;
        if (!userId) return res.status(401).json({ message: "Usuário não identificado" });

        const svc = new ObjectStorageService();
        const path = svc.normalizeObjectEntityPath(String(body.uploadURL));
        if (!path) return res.status(400).json({ message: "uploadURL inválida" });

        // Valida token de intenção: amarra path ao tenant + usuário + sociedade.
        if (!body.uploadToken || !verifyUploadToken({
          token: String(body.uploadToken), tenantId, userId, sociedadeId: sociedade.id, path,
        })) {
          return res.status(403).json({ message: "Token de upload inválido ou expirado" });
        }

        const fileName = String(body.fileName || baseFields.titulo || "documento").slice(0, 200);
        const declaredSize = Number(body.fileSize) || 0;

        // Cutoff barato antes de baixar — declaredSize é hint do cliente, não confiável,
        // mas se já vier acima do limite, rejeita sem trazer o blob.
        if (declaredSize && declaredSize > MAX_DOC_BYTES) {
          return res.status(413).json({ message: `Arquivo excede limite de ${MAX_DOC_BYTES / 1024 / 1024} MB` });
        }
        try {
          const file = await svc.getObjectEntityFile(`/objects/${path.replace(/^\/+/, "")}`);

          // Cutoff confiável: lê metadata do objeto antes do download completo.
          try {
            const [meta] = await file.getMetadata();
            const realSize = Number((meta as any)?.size) || 0;
            if (realSize > MAX_DOC_BYTES) {
              return res.status(413).json({ message: `Arquivo excede limite de ${MAX_DOC_BYTES / 1024 / 1024} MB` });
            }
          } catch { /* getMetadata best-effort */ }

          const [buf] = await file.download();
          if (buf.length > MAX_DOC_BYTES) {
            return res.status(413).json({ message: `Arquivo excede limite de ${MAX_DOC_BYTES / 1024 / 1024} MB` });
          }

          // Validação confiável: detecta tipo por magic bytes do BUFFER REAL.
          // Não confia em fileMime/fileName brutos do cliente.
          const kind = detectKind(buf);
          const canonicalMime = resolveMimeForKind(kind, fileName);
          if (kind === "unknown" || !canonicalMime) {
            return res.status(415).json({
              message: "Tipo de arquivo não suportado ou conteúdo não corresponde à extensão. Use PDF, DOCX, XLSX, DOC, XLS, CSV, TXT, MD, JSON, PNG, JPG ou WEBP.",
            });
          }
          // Para ZIP/Office, exige estrutura OOXML real e que case com a extensão.
          if (kind === "office_zip") {
            const variant = detectOoxmlVariant(buf);
            const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
            if (!variant || (ext === ".docx" && variant !== "docx") || (ext === ".xlsx" && variant !== "xlsx")) {
              return res.status(415).json({
                message: "Arquivo Office inválido — não corresponde a um DOCX ou XLSX legítimo.",
              });
            }
          }

          baseFields.storagePath = path;
          baseFields.mimeType = canonicalMime; // mime derivado do servidor, não do cliente
          baseFields.tamanhoBytes = buf.length;
          // Extração best-effort — falha não impede salvar (ex.: imagens não têm OCR).
          const ext = await extractText(buf, canonicalMime, fileName, tenantId);
          if (ext.status === "ok") {
            baseFields.textoExtraido = ext.text;
          } else if (ext.status === "failed" || ext.status === "empty") {
            extractWarning = ext.errorMessage || (ext.status === "empty" ? "Nenhum texto extraído" : null);
          }
        } catch (err: any) {
          if (err instanceof ObjectNotFoundError) {
            return res.status(404).json({ message: "Arquivo não encontrado no storage" });
          }
          console.error("[societario] download/extract:", err);
          return res.status(500).json({ message: err?.message || "Falha ao processar arquivo" });
        }
      }

      const parsed = insertDocumentoSocietarioSchema.parse(baseFields);
      const [row] = await db.insert(documentosSocietarios).values(parsed as any).returning();
      res.status(201).json({ ...row, _warning: extractWarning });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao salvar documento" });
    }
  });

  // Download do arquivo binário (escopo por tenant via ensureDocumento)
  app.get("/api/societario/documentos/:id/download", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureDocumento(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Documento não encontrado" });
      if (!found.storagePath) return res.status(404).json({ message: "Documento não possui arquivo anexado" });

      const svc = new ObjectStorageService();
      const objectPath = normalizeStoragePath(found.storagePath)!;
      const file = await svc.getObjectEntityFile(objectPath);
      // Mantém o nome original com a extensão correta para o browser saber
      // como tratar (ex.: .pdf → renderiza inline; .docx → baixa).
      const baseName = (found.titulo || "documento").replace(/[\r\n"\\\/]/g, " ").slice(0, 180);
      const extByMime: Record<string, string> = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "text/plain": ".txt",
        "text/markdown": ".md",
        "text/csv": ".csv",
        "application/json": ".json",
        "application/msword": ".doc",
        "application/vnd.ms-excel": ".xls",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
      };
      const wantedExt = extByMime[String(found.mimeType || "")] || "";
      const filename = wantedExt && !baseName.toLowerCase().endsWith(wantedExt)
        ? `${baseName}${wantedExt}` : baseName;
      // ?inline=1 → exibe no browser quando possível; default = download forçado.
      const inline = String(req.query?.inline || "") === "1";
      const disposition = inline ? "inline" : "attachment";
      res.setHeader(
        "Content-Disposition",
        `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      if (found.mimeType) res.setHeader("Content-Type", String(found.mimeType));
      // Cache curto para o iframe não recarregar a cada interação no modal.
      res.setHeader("Cache-Control", "private, max-age=60");
      await svc.downloadObject(file, res, 0);
    } catch (err: any) {
      if (err instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Arquivo não encontrado" });
      }
      console.error("[societario] download:", err);
      if (!res.headersSent) res.status(500).json({ message: err?.message || "Falha no download" });
    }
  });

  app.patch("/api/societario/documentos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureDocumento(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Documento não encontrado" });
      // SEGURANÇA: storagePath, mimeType, tamanhoBytes e textoExtraido são imutáveis
      // após criação. Permitir alterar storagePath via PATCH abriria caminho para
      // sequestrar arquivos de outros documentos (mesmo tenant).
      const allowed = [
        "tipo", "titulo", "descricao", "conteudoMarkdown",
        "dataDocumento", "dataValidade", "numeroDocumento",
      ] as const;
      const safe: Record<string, any> = {};
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(documentosSocietarios)
        .set(safe)
        .where(and(eq(documentosSocietarios.id, found.id), eq(documentosSocietarios.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar documento" });
    }
  });

  // Re-extrai texto de um documento já existente (útil para PDFs escaneados
  // que entraram antes do OCR ou documentos onde a extração anterior falhou).
  // Atualiza textoExtraido bypassing o PATCH-guard porque é um endpoint
  // dedicado, não-genérico — só altera campos derivados do próprio blob.
  app.post("/api/societario/documentos/:id/reextract", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureDocumento(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Documento não encontrado" });
      if (!found.storagePath) return res.status(400).json({ message: "Documento sem arquivo anexado" });

      const svc = new ObjectStorageService();
      const objectPath = normalizeStoragePath(found.storagePath)!;
      const file = await svc.getObjectEntityFile(objectPath);
      const [meta] = await file.getMetadata();
      const size = Number(meta?.size || 0);
      if (size > 25 * 1024 * 1024) {
        return res.status(413).json({ message: "Arquivo excede 25MB" });
      }
      const [buf] = await file.download();
      const fileName = found.titulo || "documento";
      const ext = await extractText(buf, String(found.mimeType || ""), fileName, tenantId);
      if (ext.status !== "ok" || !ext.text) {
        return res.status(200).json({
          ok: false,
          status: ext.status,
          message: ext.errorMessage || "Não foi possível extrair texto deste arquivo.",
        });
      }
      const [row] = await db
        .update(documentosSocietarios)
        .set({ textoExtraido: ext.text })
        .where(and(eq(documentosSocietarios.id, found.id), eq(documentosSocietarios.tenantId, tenantId)))
        .returning();
      res.json({ ok: true, status: "ok", chars: ext.text.length, documento: row });
    } catch (err: any) {
      if (err instanceof ObjectNotFoundError) {
        return res.status(404).json({ message: "Arquivo não encontrado no storage" });
      }
      console.error("[societario] reextract:", err);
      res.status(500).json({ message: err?.message || "Falha na re-extração" });
    }
  });

  app.delete("/api/societario/documentos/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureDocumento(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Documento não encontrado" });
      await db.delete(documentosSocietarios).where(and(eq(documentosSocietarios.id, found.id), eq(documentosSocietarios.tenantId, tenantId)));
      // Best-effort: limpa também o blob no Object Storage. Falha não impede o delete do registro.
      if (found.storagePath) {
        try {
          const svc = new ObjectStorageService();
          const objectPath = normalizeStoragePath(found.storagePath)!;
          await svc.deleteObject(objectPath);
        } catch (e) {
          console.warn("[societario] best-effort delete blob falhou:", (e as any)?.message);
        }
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao remover documento" });
    }
  });

  // ---------- OBRIGAÇÕES ----------
  app.get("/api/societario/sociedades/:id/obrigacoes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const { status, from, to } = req.query as Record<string, string>;
      const conds = [eq(obrigacoesSocietarias.sociedadeId, sociedade.id)];
      if (status) conds.push(eq(obrigacoesSocietarias.status, status));
      if (from) conds.push(gte(obrigacoesSocietarias.dataVencimento, from));
      if (to) conds.push(lte(obrigacoesSocietarias.dataVencimento, to));
      const rows = await db
        .select()
        .from(obrigacoesSocietarias)
        .where(and(...conds))
        .orderBy(asc(obrigacoesSocietarias.dataVencimento));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar obrigações" });
    }
  });

  app.post("/api/societario/sociedades/:id/obrigacoes", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const parsed = insertObrigacaoSocietariaSchema.parse({
        ...req.body,
        sociedadeId: sociedade.id,
        tenantId,
      });
      const [row] = await db.insert(obrigacoesSocietarias).values(parsed as any).returning();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao criar obrigação" });
    }
  });

  app.patch("/api/societario/obrigacoes/:id/concluir", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureObrigacao(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Obrigação não encontrada" });
      const [row] = await db
        .update(obrigacoesSocietarias)
        .set({
          status: "concluida",
          dataConclusao: new Date().toISOString().slice(0, 10),
          updatedAt: new Date(),
        })
        .where(and(eq(obrigacoesSocietarias.id, found.id), eq(obrigacoesSocietarias.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao concluir obrigação" });
    }
  });

  app.patch("/api/societario/obrigacoes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureObrigacao(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Obrigação não encontrada" });
      const allowed = [
        "titulo", "tipo", "descricao", "dataVencimento", "periodicidade",
        "alertaDias", "status", "dataConclusao", "responsavel", "observacoes",
      ] as const;
      const safe: Record<string, any> = { updatedAt: new Date() };
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(obrigacoesSocietarias)
        .set(safe)
        .where(and(eq(obrigacoesSocietarias.id, found.id), eq(obrigacoesSocietarias.tenantId, tenantId)))
        .returning();
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar obrigação" });
    }
  });

  app.delete("/api/societario/obrigacoes/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureObrigacao(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Obrigação não encontrada" });
      await db.delete(obrigacoesSocietarias).where(and(eq(obrigacoesSocietarias.id, found.id), eq(obrigacoesSocietarias.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao remover obrigação" });
    }
  });

  // ---------- CERTIFICADOS DIGITAIS ----------
  // NOTA: arquivoEnc deveria ser o PFX criptografado. Nesta versão da UI o
  // campo aceita apenas texto (anotação manual). A criptografia AES-256-GCM
  // do PFX será implementada em sprint futuro junto com upload binário.
  app.get("/api/societario/sociedades/:id/certificados", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      const rows = await db
        .select({
          id: certificadosDigitais.id,
          sociedadeId: certificadosDigitais.sociedadeId,
          tenantId: certificadosDigitais.tenantId,
          tipo: certificadosDigitais.tipo,
          titular: certificadosDigitais.titular,
          cpfCnpjTitular: certificadosDigitais.cpfCnpjTitular,
          emissor: certificadosDigitais.emissor,
          numeroSerie: certificadosDigitais.numeroSerie,
          dataEmissao: certificadosDigitais.dataEmissao,
          dataValidade: certificadosDigitais.dataValidade,
          status: certificadosDigitais.status,
          observacoes: certificadosDigitais.observacoes,
          createdAt: certificadosDigitais.createdAt,
        })
        .from(certificadosDigitais)
        .where(and(eq(certificadosDigitais.sociedadeId, sociedade.id), eq(certificadosDigitais.tenantId, tenantId)))
        .orderBy(asc(certificadosDigitais.dataValidade));
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao listar certificados" });
    }
  });

  app.post("/api/societario/sociedades/:id/certificados", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const sociedade = await ensureSociedade(req.params.id, tenantId);
      if (!sociedade) return res.status(404).json({ message: "Sociedade não encontrada" });
      // Bloquear arquivoEnc via API (upload de PFX virá em endpoint dedicado).
      const { arquivoEnc, ...body } = req.body ?? {};
      const parsed = insertCertificadoDigitalSchema.parse({
        ...body,
        sociedadeId: sociedade.id,
        tenantId,
      });
      const [row] = await db.insert(certificadosDigitais).values(parsed as any).returning();
      // Não retornar arquivoEnc na resposta
      const { arquivoEnc: _enc, ...safe } = row as any;
      res.status(201).json(safe);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao salvar certificado" });
    }
  });

  app.patch("/api/societario/certificados/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureCertificado(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Certificado não encontrado" });
      const allowed = [
        "tipo", "titular", "cpfCnpjTitular", "emissor", "numeroSerie",
        "dataEmissao", "dataValidade", "status", "observacoes",
      ] as const;
      const safe: Record<string, any> = {};
      for (const k of allowed) if (k in (req.body ?? {})) safe[k] = req.body[k];
      const [row] = await db
        .update(certificadosDigitais)
        .set(safe)
        .where(and(eq(certificadosDigitais.id, found.id), eq(certificadosDigitais.tenantId, tenantId)))
        .returning();
      const { arquivoEnc: _enc, ...rest } = row as any;
      res.json(rest);
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao atualizar certificado" });
    }
  });

  app.delete("/api/societario/certificados/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const found = await ensureCertificado(req.params.id, tenantId);
      if (!found) return res.status(404).json({ message: "Certificado não encontrado" });
      await db.delete(certificadosDigitais).where(and(eq(certificadosDigitais.id, found.id), eq(certificadosDigitais.tenantId, tenantId)));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err?.message || "Falha ao remover certificado" });
    }
  });

  // ---------- DASHBOARD ----------
  app.get("/api/societario/dashboard", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const tenantId = req.tenantId as string;
      const [counts] = await db.execute<any>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM sociedades WHERE tenant_id = ${tenantId} AND status = 'ativa') AS sociedades_ativas,
          (SELECT COUNT(*)::int FROM sociedades WHERE tenant_id = ${tenantId}) AS sociedades_total,
          (SELECT COUNT(*)::int FROM obrigacoes_societarias WHERE tenant_id = ${tenantId} AND status = 'pendente' AND data_vencimento <= (CURRENT_DATE + INTERVAL '30 days')) AS obrigacoes_proximas,
          (SELECT COUNT(*)::int FROM obrigacoes_societarias WHERE tenant_id = ${tenantId} AND status = 'pendente' AND data_vencimento < CURRENT_DATE) AS obrigacoes_atrasadas,
          (SELECT COUNT(*)::int FROM certificados_digitais WHERE tenant_id = ${tenantId} AND status = 'ativo' AND data_validade <= (CURRENT_DATE + INTERVAL '60 days')) AS certificados_vencendo,
          (SELECT COUNT(*)::int FROM alteracoes_societarias WHERE tenant_id = ${tenantId} AND data_evento >= date_trunc('month', CURRENT_DATE)) AS alteracoes_mes
      `).then((r: any) => r.rows ?? r);
      const porRegime = await db.execute<any>(sql`
        SELECT regime_tributario AS name, COUNT(*)::int AS value
        FROM sociedades WHERE tenant_id = ${tenantId} AND status = 'ativa'
        GROUP BY regime_tributario ORDER BY value DESC
      `).then((r: any) => r.rows ?? r);
      res.json({ counts, porRegime });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "Falha ao carregar dashboard" });
    }
  });
}
