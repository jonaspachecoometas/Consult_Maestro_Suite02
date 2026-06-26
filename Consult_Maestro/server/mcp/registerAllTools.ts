/**
 * MCP Hub — Module tools registration (Sprint 2)
 *
 * Wires every module's tools into the central registry. Called once at boot
 * from `server/index.ts`, AFTER `registerCoreTools()` (so the 5 core tools
 * are in place) and BEFORE `registerRoutes()` (so HTTP handlers can already
 * enumerate them).
 *
 * Module handlers MUST NOT reimplement business logic — each one must call
 * an existing service. Tools that mutate state, send something externally,
 * or burn LLM tokens MUST set `requiresConfirmation: true`. Read-only tools
 * are free to run.
 *
 * Sprint 2 fix (post-architect review): every tool now ships an
 * `inputValidator` (Zod) so validation runs CENTRALLY in `toolRegistry.execute`
 * and `/api/mcp/tools/:name` — handlers no longer duplicate the safeParse.
 *
 * Idempotent: safe to call multiple times. Module flag flips on first call.
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { toolRegistry } from "./toolRegistry";
import { registerCoreTools } from "./registerCoreTools";
import { registerBrowserTools } from "../browserAgent/browserTools";
import {
  processosSocietarios,
  processoTarefas,
  recoveryScenarios,
  recoveryProcesses,
  clients,
} from "@shared/schema";

let allRegistered = false;

export function registerAllTools(): void {
  if (allRegistered) {
    console.log("[mcp] all module tools already registered, skipping");
    return;
  }

  // Sprint 1 core tools (idempotent — registry already protects against
  // double-register; we still call to be explicit about the boot order).
  registerCoreTools();

  registerControlTools();
  registerSocietarioTools();
  registerRecoveryTools();
  registerGoogleTools();
  registerMicrosoftTools();
  registerWhatsappTools();
  registerBrowserTools();

  allRegistered = true;
  console.log(
    "[mcp] registered module tools (control: 1, societario: 2, recovery: 1, google: 6, microsoft: 5, whatsapp: 2, browser: 12)",
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Control — Diagnóstico financeiro estrutural (Modelo Fleuriet)
// ─────────────────────────────────────────────────────────────────────────

const fleurietInputSchema = z.object({
  clienteId: z.string().min(1, "clienteId obrigatório"),
  dataReferencia: z.string().optional(),
});

function registerControlTools(): void {
  toolRegistry.register({
    name: "calcular_fleuriet",
    module: "control",
    requiresConfirmation: false, // read-only: só lê lançamentos do tenant
    description:
      "Calcula o diagnóstico Fleuriet (NCG, CGL, Saldo de Tesouraria, ciclo financeiro/operacional, efeito tesoura) de um cliente do Arcádia Control. Use quando o usuário pedir análise estrutural de capital de giro, saúde financeira, ou diagnóstico do cliente. O escopo é restrito ao tenant atual.",
    inputSchema: {
      type: "object",
      properties: {
        clienteId: { type: "string", description: "ID do cliente (obrigatório)." },
        dataReferencia: {
          type: "string",
          description: "Data de referência ISO (YYYY-MM-DD). Default: hoje.",
        },
      },
      required: ["clienteId"],
    },
    inputValidator: fleurietInputSchema,
    handler: async (input: z.infer<typeof fleurietInputSchema>, ctx) => {
      // Garante que o cliente pertence ao tenant antes de chamar o serviço.
      const [cli] = await db
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, input.clienteId), eq(clients.tenantId, ctx.tenantId)))
        .limit(1);
      if (!cli) return { error: "Cliente não encontrado neste tenant." };

      const { calcularFleuriet } = await import("../control/fleurietService");
      const data = input.dataReferencia ? new Date(input.dataReferencia) : new Date();
      if (Number.isNaN(data.getTime())) {
        return { error: "dataReferencia inválida (use YYYY-MM-DD)" };
      }
      const result = await calcularFleuriet(ctx.tenantId, cli.id, data);
      return { cliente: { id: cli.id, name: cli.name }, ...result };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Societário — Pipeline de processos + validação documental
// ─────────────────────────────────────────────────────────────────────────

const analisarPipelineInputSchema = z.object({
  tipoProcesso: z.string().optional(),
  status: z.string().optional(),
  analista: z.string().optional(),
});

const validarDocumentoInputSchema = z.object({
  processoId: z.string().min(1),
  tarefaId: z.string().min(1),
});

function registerSocietarioTools(): void {
  // Read-only: agrega o estado atual do pipeline societário do tenant.
  toolRegistry.register({
    name: "analisar_pipeline_societario",
    module: "societario",
    requiresConfirmation: false,
    description:
      "Analisa o estado atual do pipeline societário do tenant: totais por status, distribuição por etapa/coluna, gargalos (processos parados ≥14 dias), KPIs por analista e por tipo, tarefas pendentes por executor e KPIs do agente. Use para responder perguntas como 'como está o pipeline societário?', 'quantos processos estão atrasados?', 'qual o gargalo atual?'. Filtros opcionais: tipoProcesso, status (ativo|concluido|pausado|cancelado) e analista (ID do usuário ou '__me__' para o usuário logado). Delegada ao serviço `computePipelineDashboard` — mesma fonte que alimenta o dashboard da UI.",
    inputSchema: {
      type: "object",
      properties: {
        tipoProcesso: {
          type: "string",
          description: "Filtra por tipo (constituicao, alteracao_contratual, etc.). Opcional.",
        },
        status: {
          type: "string",
          description:
            "Filtra por status (ativo, concluido, pausado, cancelado). Opcional.",
        },
        analista: {
          type: "string",
          description:
            "Filtra por analista responsável. Aceita ID de usuário ou '__me__' para o usuário logado. Opcional.",
        },
      },
    },
    inputValidator: analisarPipelineInputSchema,
    handler: async (input: z.infer<typeof analisarPipelineInputSchema>, ctx) => {
      // Delega ao mesmo serviço usado pela rota /api/societario/pipeline/dashboard
      // — sem reimplementar agregação aqui (regra: tools chamam services existentes).
      const { computePipelineDashboard } = await import(
        "../societario/pipeline/dashboard"
      );
      return await computePipelineDashboard(ctx.tenantId, {
        tipo: input.tipoProcesso,
        status: input.status,
        analista: input.analista,
        viewerId: ctx.userId ?? undefined,
        incluirGargalos: true,
      });
    },
  });

  // Mutating skill: roda OCR/extract sobre upload, pode escrever auditoria.
  // → requiresConfirmation true.
  toolRegistry.register({
    name: "validar_documento_societario",
    module: "societario",
    requiresConfirmation: true,
    description:
      "Valida um documento societário enviado em uma tarefa do pipeline: baixa o arquivo do Object Storage, roda extração de texto / OCR e devolve um veredito (válido / ilegível / curto). Requer confirmação do usuário porque grava auditoria e pode disparar OCR remoto.",
    inputSchema: {
      type: "object",
      properties: {
        processoId: { type: "string", description: "ID do processo societário." },
        tarefaId: {
          type: "string",
          description: "ID da tarefa (do tipo upload) cujo arquivo deve ser validado.",
        },
      },
      required: ["processoId", "tarefaId"],
    },
    inputValidator: validarDocumentoInputSchema,
    handler: async (input: z.infer<typeof validarDocumentoInputSchema>, ctx) => {
      // Garante que o processo pertence ao tenant.
      const [proc] = await db
        .select({ id: processosSocietarios.id })
        .from(processosSocietarios)
        .where(
          and(
            eq(processosSocietarios.id, input.processoId),
            eq(processosSocietarios.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!proc) return { error: "Processo não encontrado neste tenant." };

      // Garante que a tarefa pertence ao processo + tenant.
      const [tarefa] = await db
        .select()
        .from(processoTarefas)
        .where(
          and(
            eq(processoTarefas.id, input.tarefaId),
            eq(processoTarefas.tenantId, ctx.tenantId),
            eq(processoTarefas.processoId, input.processoId),
          ),
        )
        .limit(1);
      if (!tarefa) return { error: "Tarefa não encontrada neste processo." };

      const { dispatchSkill } = await import("../societario/pipeline/skills");
      const result = await dispatchSkill("validar_documentos_recebidos", {
        tenantId: ctx.tenantId,
        processoId: input.processoId,
        userId: ctx.userId ?? null,
        source: "manual",
        tarefaId: input.tarefaId,
        triggerTarefa: tarefa,
      });
      return result;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Recovery — Simulação de cenário de negociação
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sprint 2 contract (post-architect review): the spec asks for
 * `(processoId, parametros)`. Recovery actually has N scenarios under one
 * process, so we keep `processoId` as the primary key (matches spec + how the
 * user thinks) and accept an optional `cenarioId` to disambiguate. When the
 * caller omits `cenarioId` we resolve it server-side to the most recent
 * scenario of the process (by `createdAt desc`).
 */
const simularCenarioInputSchema = z.object({
  processoId: z.string().min(1, "processoId obrigatório"),
  cenarioId: z.string().min(1).optional(),
  parametros: z
    .object({
      valorTotalDivida: z.union([z.string(), z.number()]).optional(),
      valorTotalProposto: z.union([z.string(), z.number()]).optional(),
      numParcelas: z.union([z.string(), z.number()]).optional(),
      intervaloDias: z.union([z.string(), z.number()]).optional(),
      carenciaMeses: z.union([z.string(), z.number()]).optional(),
      hasReducedInitial: z.boolean().optional(),
      reducedCount: z.union([z.string(), z.number()]).optional(),
      reducedAmount: z.union([z.string(), z.number()]).optional(),
      normalAmount: z.union([z.string(), z.number()]).optional(),
      primeiraParcelaData: z.string().optional(),
      taxaPropostaMensal: z.union([z.string(), z.number()]).optional(),
    })
    .partial()
    .optional(),
});

function registerRecoveryTools(): void {
  // Preview-only: não persiste, apenas simula CET + cronograma.
  toolRegistry.register({
    name: "simular_cenario_recovery",
    module: "recovery",
    requiresConfirmation: false,
    description:
      "Simula um cenário de negociação do módulo Recovery: roda CET (Custo Efetivo Total), cronograma de parcelas e impacto no fluxo de caixa, sem persistir alterações. Use quando o usuário pedir 'simule esse cenário', 'qual o CET dessa proposta?' ou pedir para testar parâmetros antes de salvar. Aceita override opcional de parâmetros (valorTotalProposto, numParcelas, etc.) sem alterar nada no banco. Quando há vários cenários no processo, omitir cenarioId pega o mais recente.",
    inputSchema: {
      type: "object",
      properties: {
        processoId: {
          type: "string",
          description: "ID do processo de recuperação (obrigatório).",
        },
        cenarioId: {
          type: "string",
          description:
            "ID de cenário específico desse processo. Opcional — se omitido, usa o cenário mais recente do processo.",
        },
        parametros: {
          type: "object",
          description: "Override opcional (não persistido) dos parâmetros do cenário.",
          properties: {
            valorTotalDivida: { type: ["string", "number"] },
            valorTotalProposto: { type: ["string", "number"] },
            numParcelas: { type: ["string", "number"] },
            intervaloDias: { type: ["string", "number"] },
            carenciaMeses: { type: ["string", "number"] },
            hasReducedInitial: { type: "boolean" },
            reducedCount: { type: ["string", "number"] },
            reducedAmount: { type: ["string", "number"] },
            normalAmount: { type: ["string", "number"] },
            primeiraParcelaData: { type: "string", description: "ISO YYYY-MM-DD" },
            taxaPropostaMensal: { type: ["string", "number"] },
          },
        },
      },
      required: ["processoId"],
    },
    inputValidator: simularCenarioInputSchema,
    handler: async (input: z.infer<typeof simularCenarioInputSchema>, ctx) => {
      // Garante que o processo pertence ao tenant.
      const [proc] = await db
        .select({ id: recoveryProcesses.id })
        .from(recoveryProcesses)
        .where(
          and(
            eq(recoveryProcesses.id, input.processoId),
            eq(recoveryProcesses.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (!proc) return { error: "Processo de recovery não encontrado neste tenant." };

      // Resolve scenario: explícito por cenarioId, ou o mais recente do processo.
      const scenarioConds = [
        eq(recoveryScenarios.tenantId, ctx.tenantId),
        eq(recoveryScenarios.processId, proc.id),
      ];
      if (input.cenarioId) {
        scenarioConds.push(eq(recoveryScenarios.id, input.cenarioId));
      }
      const [scenario] = await db
        .select()
        .from(recoveryScenarios)
        .where(and(...scenarioConds))
        .orderBy(desc(recoveryScenarios.createdAt))
        .limit(1);
      if (!scenario) {
        return {
          error: input.cenarioId
            ? "Cenário não encontrado neste processo."
            : "Nenhum cenário cadastrado para este processo. Crie um cenário antes de simular.",
        };
      }

      // Delega ao mesmo `runSimulation` consumido pelo endpoint
      // POST /api/recovery/scenarios/:id/simulate — sem duplicar a fórmula.
      const { runSimulation } = await import("../recovery/scenarios");
      const merged = { ...scenario, ...(input.parametros || {}) };
      const sim = runSimulation(merged);
      if (!sim) {
        return {
          error:
            "Parâmetros insuficientes para simular (valor e número de parcelas obrigatórios).",
        };
      }
      return {
        processoId: proc.id,
        cenarioId: scenario.id,
        nome: scenario.nome,
        result: sim.result,
        // cashFlowImpact omitido para manter resposta enxuta; UI usa /simulate.
      };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Google Workspace — Sprint 3 (Drive, Gmail, Calendar, Docs)
// ─────────────────────────────────────────────────────────────────────────

const driveListInputSchema = z.object({
  query: z.string().optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  mimeType: z.string().optional(),
});
const driveReadInputSchema = z.object({
  fileId: z.string().min(1, "fileId obrigatório"),
});
const driveCreateInputSchema = z.object({
  name: z.string().min(1, "name obrigatório"),
  content: z.string().min(0, "content obrigatório"),
  mimeType: z.string().optional(),
  folderId: z.string().optional(),
});
const gmailSendInputSchema = z.object({
  to: z.string().email("to deve ser email válido"),
  subject: z.string().min(1, "subject obrigatório"),
  body: z.string().min(1, "body obrigatório"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  isHtml: z.boolean().optional(),
});
const calendarCreateInputSchema = z.object({
  summary: z.string().min(1, "summary obrigatório"),
  description: z.string().optional(),
  startIso: z.string().min(1, "startIso obrigatório (RFC3339)"),
  endIso: z.string().min(1, "endIso obrigatório (RFC3339)"),
  timeZone: z.string().optional(),
  attendees: z.array(z.string().email()).optional(),
  location: z.string().optional(),
  calendarId: z.string().optional(),
});
const docsCreateInputSchema = z.object({
  title: z.string().min(1, "title obrigatório"),
  body: z.string().optional(),
});

/**
 * Standard error payload for Google tools. When the tenant has no Google
 * connection (or it expired and refresh failed), we surface a stable
 * `error: "google_not_connected"` code so the orchestrator/UI can branch on
 * it consistently instead of parsing free-text messages.
 */
function googleErrorPayload(e: any): { error: string; message: string } {
  if (e?.code === "google_not_connected" || e?.name === "GoogleNotConnectedError") {
    return {
      error: "google_not_connected",
      message: e?.message || "Google não conectado para este tenant. Conecte em Configurações → Integrações.",
    };
  }
  return { error: "google_api_error", message: e?.message || "Falha ao chamar a API do Google." };
}

function registerGoogleTools(): void {
  // 1. Lista arquivos do Drive (read-only) — escopo drive.file só vê arquivos
  // criados/abertos pelo app, então a busca é segura por design.
  toolRegistry.register({
    name: "google_drive_list_files",
    module: "google",
    requiresConfirmation: false,
    description:
      "Lista arquivos do Google Drive da conta conectada do tenant (escopo drive.file: só arquivos criados ou abertos por este app). Use para responder 'que documentos eu tenho?', 'liste os PDFs do projeto', etc. Aceita filtros por nome (query) e mimeType.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filtra por nome (parcial). Opcional." },
        pageSize: { type: "number", description: "Número máximo de resultados (1-50). Padrão 20." },
        mimeType: { type: "string", description: "Filtra por mimeType (ex.: application/pdf). Opcional." },
      },
    },
    inputValidator: driveListInputSchema,
    handler: async (input: z.infer<typeof driveListInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const drive = google.drive({ version: "v3", auth });
        const conds: string[] = ["trashed = false"];
        if (input.query) conds.push(`name contains '${String(input.query).replace(/'/g, "\\'")}'`);
        if (input.mimeType) conds.push(`mimeType = '${String(input.mimeType).replace(/'/g, "\\'")}'`);
        const r = await drive.files.list({
          q: conds.join(" and "),
          pageSize: input.pageSize ?? 20,
          fields: "files(id,name,mimeType,size,modifiedTime,webViewLink)",
          orderBy: "modifiedTime desc",
        });
        return {
          count: r.data.files?.length ?? 0,
          files: (r.data.files ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink,
          })),
        };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });

  // 2. Lê conteúdo textual de um arquivo do Drive (read-only).
  toolRegistry.register({
    name: "google_drive_read_file",
    module: "google",
    requiresConfirmation: false,
    description:
      "Baixa o conteúdo textual de um arquivo do Google Drive da conta conectada do tenant. Para Google Docs, exporta como text/plain. Para outros tipos, devolve até 200KB de texto bruto. Use depois de google_drive_list_files para ler o conteúdo de um arquivo específico.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID do arquivo no Drive (obrigatório)." },
      },
      required: ["fileId"],
    },
    inputValidator: driveReadInputSchema,
    handler: async (input: z.infer<typeof driveReadInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const drive = google.drive({ version: "v3", auth });
        const meta = await drive.files.get({ fileId: input.fileId, fields: "id,name,mimeType" });
        const mime = meta.data.mimeType || "";
        let text = "";
        if (mime === "application/vnd.google-apps.document") {
          const r = await drive.files.export({ fileId: input.fileId, mimeType: "text/plain" }, { responseType: "text" });
          text = String(r.data || "");
        } else if (mime === "application/vnd.google-apps.spreadsheet") {
          const r = await drive.files.export({ fileId: input.fileId, mimeType: "text/csv" }, { responseType: "text" });
          text = String(r.data || "");
        } else if (mime.startsWith("text/") || mime === "application/json") {
          const r = await drive.files.get({ fileId: input.fileId, alt: "media" }, { responseType: "text" });
          text = String(r.data || "");
        } else {
          return { error: `Tipo de arquivo não suportado para leitura textual (${mime}).` };
        }
        const truncated = text.length > 200_000;
        return {
          id: meta.data.id,
          name: meta.data.name,
          mimeType: mime,
          truncated,
          content: truncated ? text.slice(0, 200_000) : text,
        };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });

  // 3. Cria arquivo de texto/json no Drive (write — exige confirmação).
  toolRegistry.register({
    name: "google_drive_create_file",
    module: "google",
    requiresConfirmation: true,
    description:
      "Cria um arquivo no Google Drive da conta conectada do tenant. Útil para salvar relatórios, exports e anotações. Aceita conteúdo de texto/JSON. Requer confirmação porque grava no Drive do usuário.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome do arquivo." },
        content: { type: "string", description: "Conteúdo do arquivo." },
        mimeType: { type: "string", description: "MIME type. Padrão: text/plain." },
        folderId: { type: "string", description: "ID da pasta destino. Opcional." },
      },
      required: ["name", "content"],
    },
    inputValidator: driveCreateInputSchema,
    handler: async (input: z.infer<typeof driveCreateInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const drive = google.drive({ version: "v3", auth });
        const mime = input.mimeType || "text/plain";
        const r = await drive.files.create({
          requestBody: {
            name: input.name,
            mimeType: mime,
            parents: input.folderId ? [input.folderId] : undefined,
          },
          media: { mimeType: mime, body: input.content },
          fields: "id,name,mimeType,webViewLink",
        });
        return {
          id: r.data.id,
          name: r.data.name,
          mimeType: r.data.mimeType,
          webViewLink: r.data.webViewLink,
        };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });

  // 4. Envia email via Gmail (send-only escopo, exige confirmação).
  toolRegistry.register({
    name: "gmail_send",
    module: "google",
    requiresConfirmation: true,
    description:
      "Envia um email pela conta Gmail conectada do tenant. Requer confirmação obrigatória — não envie sem o usuário aprovar. Aceita texto puro ou HTML. Use para notificar clientes, enviar resumos, follow-ups.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Destinatário (email)." },
        subject: { type: "string", description: "Assunto do email." },
        body: { type: "string", description: "Corpo do email (texto ou HTML)." },
        cc: { type: "string", description: "CC. Opcional." },
        bcc: { type: "string", description: "BCC. Opcional." },
        isHtml: { type: "boolean", description: "Se true, body é HTML. Padrão false." },
      },
      required: ["to", "subject", "body"],
    },
    inputValidator: gmailSendInputSchema,
    handler: async (input: z.infer<typeof gmailSendInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const gmail = google.gmail({ version: "v1", auth });
        const headers: string[] = [
          `To: ${input.to}`,
          input.cc ? `Cc: ${input.cc}` : "",
          input.bcc ? `Bcc: ${input.bcc}` : "",
          `Subject: ${encodeMimeHeader(input.subject)}`,
          "MIME-Version: 1.0",
          input.isHtml ? "Content-Type: text/html; charset=UTF-8" : "Content-Type: text/plain; charset=UTF-8",
        ].filter(Boolean);
        const raw = `${headers.join("\r\n")}\r\n\r\n${input.body}`;
        const encoded = Buffer.from(raw, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
        return { id: r.data.id, threadId: r.data.threadId, sentTo: input.to };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });

  // 5. Cria evento no Calendar (write/external — exige confirmação).
  toolRegistry.register({
    name: "google_calendar_create_event",
    module: "google",
    requiresConfirmation: true,
    description:
      "Cria um evento no Google Calendar da conta conectada do tenant. Requer confirmação obrigatória — pode notificar convidados. Use para agendar reuniões, follow-ups, vistorias.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Título do evento." },
        description: { type: "string", description: "Descrição. Opcional." },
        startIso: { type: "string", description: "Início no formato RFC3339 (ex.: 2026-05-15T14:00:00-03:00)." },
        endIso: { type: "string", description: "Fim no formato RFC3339." },
        timeZone: { type: "string", description: "Time zone IANA (ex.: America/Sao_Paulo). Opcional." },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Lista de emails de convidados. Opcional.",
        },
        location: { type: "string", description: "Local. Opcional." },
        calendarId: { type: "string", description: "ID do calendário. Padrão 'primary'." },
      },
      required: ["summary", "startIso", "endIso"],
    },
    inputValidator: calendarCreateInputSchema,
    handler: async (input: z.infer<typeof calendarCreateInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const cal = google.calendar({ version: "v3", auth });
        const r = await cal.events.insert({
          calendarId: input.calendarId || "primary",
          sendUpdates: input.attendees && input.attendees.length > 0 ? "all" : "none",
          requestBody: {
            summary: input.summary,
            description: input.description,
            location: input.location,
            start: { dateTime: input.startIso, timeZone: input.timeZone },
            end: { dateTime: input.endIso, timeZone: input.timeZone },
            attendees: input.attendees?.map((email) => ({ email })),
          },
        });
        return {
          id: r.data.id,
          htmlLink: r.data.htmlLink,
          start: r.data.start,
          end: r.data.end,
        };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });

  // 6. Cria Google Doc novo (write — exige confirmação).
  toolRegistry.register({
    name: "google_docs_create",
    module: "google",
    requiresConfirmation: true,
    description:
      "Cria um Google Doc novo na conta conectada do tenant, opcionalmente com conteúdo inicial. Requer confirmação. Use para gerar relatórios em Docs editáveis em vez de PDFs estáticos.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título do documento." },
        body: { type: "string", description: "Conteúdo inicial em texto puro. Opcional." },
      },
      required: ["title"],
    },
    inputValidator: docsCreateInputSchema,
    handler: async (input: z.infer<typeof docsCreateInputSchema>, ctx) => {
      try {
        const { getGoogleAuthClient } = await import("./oauthService");
        const { google } = await import("googleapis");
        const auth = await getGoogleAuthClient(ctx.tenantId);
        const docs = google.docs({ version: "v1", auth });
        const created = await docs.documents.create({ requestBody: { title: input.title } });
        const docId = created.data.documentId!;
        if (input.body && input.body.length > 0) {
          await docs.documents.batchUpdate({
            documentId: docId,
            requestBody: {
              requests: [{ insertText: { location: { index: 1 }, text: input.body } }],
            },
          });
        }
        return {
          id: docId,
          title: created.data.title,
          webViewLink: `https://docs.google.com/document/d/${docId}/edit`,
        };
      } catch (e: any) {
        return googleErrorPayload(e);
      }
    },
  });
}

// Encodes a string for use in a MIME header (Subject, etc.) using RFC 2047
// when it contains non-ASCII characters. Avoids breaking accents/PT-BR.
function encodeMimeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

// ─────────────────────────────────────────────────────────────────────────
// Microsoft 365 — Sprint 4 (OneDrive, Outlook, Teams)
// ─────────────────────────────────────────────────────────────────────────

const onedriveListInputSchema = z.object({
  folderId: z.string().optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
});
const onedriveReadInputSchema = z.object({
  fileId: z.string().min(1, "fileId obrigatório"),
});
const onedriveWriteInputSchema = z.object({
  // Either provide an absolute path under root (e.g. "Documentos/relatorio.txt")
  // or an explicit `folderId` + `name` pair to land the file in a known folder.
  path: z.string().min(1).optional(),
  folderId: z.string().optional(),
  name: z.string().optional(),
  content: z.string().min(1, "content obrigatório"),
  contentType: z.string().optional(),
  // base64 = decode before upload (binary). Default is utf-8 text.
  encoding: z.enum(["utf-8", "base64"]).optional(),
}).refine(
  (v) => Boolean(v.path) || (v.folderId && v.name),
  { message: "Informe `path` (ex: Documentos/relatorio.txt) ou (`folderId` + `name`)." },
);
const outlookSendInputSchema = z.object({
  to: z.string().email("to deve ser email válido"),
  subject: z.string().min(1, "subject obrigatório"),
  body: z.string().min(1, "body obrigatório"),
  cc: z.string().optional(),
  isHtml: z.boolean().optional(),
});
const teamsSendInputSchema = z.object({
  // Destino: ou (teamId+channelId) para postar em canal, ou chatId para chat 1:1/grupo.
  teamId: z.string().optional(),
  channelId: z.string().optional(),
  chatId: z.string().optional(),
  message: z.string().min(1, "message obrigatória"),
}).refine(
  (v) => (v.teamId && v.channelId) || v.chatId,
  { message: "Informe (teamId + channelId) para canal ou chatId para chat." },
);

function microsoftErrorPayload(e: any): { error: string; message: string } {
  if (e?.code === "microsoft_not_connected" || e?.name === "MicrosoftNotConnectedError") {
    return {
      error: "microsoft_not_connected",
      message: e?.message || "Microsoft 365 não conectado para este tenant. Conecte em Configurações → Integrações.",
    };
  }
  return { error: "microsoft_api_error", message: e?.message || "Falha ao chamar a Microsoft Graph API." };
}

async function callGraph(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let msg = `Graph API ${r.status}`;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || msg;
    } catch {
      if (text) msg = `${msg}: ${text.slice(0, 200)}`;
    }
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

function registerMicrosoftTools(): void {
  // 1. Lista arquivos do OneDrive (read-only).
  toolRegistry.register({
    name: "onedrive_list_files",
    module: "microsoft",
    requiresConfirmation: false,
    description:
      "Lista arquivos do OneDrive da conta Microsoft conectada do tenant. Por padrão, lista a raiz; use folderId para uma pasta específica. Útil para responder 'que arquivos eu tenho?', listar documentos do projeto, etc.",
    inputSchema: {
      type: "object",
      properties: {
        folderId: { type: "string", description: "ID da pasta (omita para raiz)." },
        pageSize: { type: "number", description: "Máximo de resultados (1-50). Padrão 25." },
      },
    },
    inputValidator: onedriveListInputSchema,
    handler: async (input: z.infer<typeof onedriveListInputSchema>, ctx) => {
      try {
        const { getValidMicrosoftAccessToken } = await import("./oauthService");
        const token = await getValidMicrosoftAccessToken(ctx.tenantId);
        const top = input.pageSize ?? 25;
        const path = input.folderId
          ? `/me/drive/items/${encodeURIComponent(input.folderId)}/children?$top=${top}`
          : `/me/drive/root/children?$top=${top}`;
        const data = await callGraph(token, path);
        const items = (data?.value ?? []) as any[];
        return {
          count: items.length,
          files: items.map((f) => ({
            id: f.id,
            name: f.name,
            size: f.size,
            isFolder: !!f.folder,
            mimeType: f.file?.mimeType ?? null,
            webUrl: f.webUrl,
            lastModified: f.lastModifiedDateTime,
          })),
        };
      } catch (e: any) {
        return microsoftErrorPayload(e);
      }
    },
  });

  // 2. Lê conteúdo textual de arquivo do OneDrive (read-only).
  toolRegistry.register({
    name: "onedrive_read_file",
    module: "microsoft",
    requiresConfirmation: false,
    description:
      "Baixa conteúdo textual de um arquivo do OneDrive (até 200KB). Suporta arquivos de texto, JSON, CSV. Use após onedrive_list_files para ler um arquivo específico.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "ID do arquivo no OneDrive." },
      },
      required: ["fileId"],
    },
    inputValidator: onedriveReadInputSchema,
    handler: async (input: z.infer<typeof onedriveReadInputSchema>, ctx) => {
      try {
        const { getValidMicrosoftAccessToken } = await import("./oauthService");
        const token = await getValidMicrosoftAccessToken(ctx.tenantId);
        const meta = await callGraph(token, `/me/drive/items/${encodeURIComponent(input.fileId)}`);
        const mime = meta?.file?.mimeType || "";
        if (!mime.startsWith("text/") && mime !== "application/json" && mime !== "text/csv") {
          return { error: "microsoft_unsupported_mime", message: `Tipo de arquivo não suportado para leitura textual (${mime || "desconhecido"}).` };
        }
        const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(input.fileId)}/content`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          throw new Error(`Falha ao baixar conteúdo (${r.status}).`);
        }
        const text = await r.text();
        const truncated = text.length > 200_000;
        return {
          id: meta.id,
          name: meta.name,
          mimeType: mime,
          truncated,
          content: truncated ? text.slice(0, 200_000) : text,
        };
      } catch (e: any) {
        return microsoftErrorPayload(e);
      }
    },
  });

  // 2.5 Cria/atualiza arquivo no OneDrive (write — requer confirmação).
  toolRegistry.register({
    name: "onedrive_write_file",
    module: "microsoft",
    requiresConfirmation: true,
    description:
      "Cria ou atualiza um arquivo no OneDrive da conta conectada. Requer confirmação. Use `path` (ex: 'Documentos/relatorio.txt') ou (`folderId` + `name`). Aceita conteúdo de texto (utf-8, padrão) ou binário (encoding 'base64').",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Caminho relativo à raiz do OneDrive (ex: 'Documentos/relatorio.txt')." },
        folderId: { type: "string", description: "Alternativa: ID da pasta destino." },
        name: { type: "string", description: "Quando usar folderId, o nome do arquivo." },
        content: { type: "string", description: "Conteúdo a gravar." },
        contentType: { type: "string", description: "MIME type. Default 'text/plain' (ou 'application/octet-stream' para base64)." },
        encoding: { type: "string", enum: ["utf-8", "base64"], description: "Padrão utf-8." },
      },
      required: ["content"],
    },
    inputValidator: onedriveWriteInputSchema,
    handler: async (input: z.infer<typeof onedriveWriteInputSchema>, ctx) => {
      try {
        const { getValidMicrosoftAccessToken } = await import("./oauthService");
        const token = await getValidMicrosoftAccessToken(ctx.tenantId);
        const enc = input.encoding ?? "utf-8";
        const isBinary = enc === "base64";
        const buf = isBinary ? Buffer.from(input.content, "base64") : Buffer.from(input.content, "utf-8");
        const contentType = input.contentType || (isBinary ? "application/octet-stream" : "text/plain; charset=utf-8");
        // Build the upload URL — Microsoft Graph supports two addressing modes.
        let url: string;
        if (input.path) {
          // Encode each segment separately so '/' separators stay literal.
          const safePath = input.path
            .replace(/^\/+/, "")
            .split("/")
            .map((s) => encodeURIComponent(s))
            .join("/");
          url = `https://graph.microsoft.com/v1.0/me/drive/root:/${safePath}:/content`;
        } else {
          // folderId + name (refine() above guarantees both are present)
          url = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(input.folderId!)}:/${encodeURIComponent(input.name!)}:/content`;
        }
        const r = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType,
          },
          body: buf,
        });
        if (!r.ok) {
          const errText = await r.text().catch(() => "");
          throw new Error(`Falha ao enviar arquivo (${r.status}): ${errText.slice(0, 200)}`);
        }
        const created = await r.json();
        return {
          ok: true,
          id: created.id,
          name: created.name,
          size: created.size,
          webUrl: created.webUrl,
          mimeType: created?.file?.mimeType ?? contentType,
        };
      } catch (e: any) {
        return microsoftErrorPayload(e);
      }
    },
  });

  // 3. Envia email via Outlook (write/external — requer confirmação).
  toolRegistry.register({
    name: "outlook_send_email",
    module: "microsoft",
    requiresConfirmation: true,
    description:
      "Envia email pela conta Outlook conectada do tenant. Requer confirmação obrigatória. Aceita texto puro ou HTML.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Destinatário (email)." },
        subject: { type: "string", description: "Assunto." },
        body: { type: "string", description: "Corpo do email." },
        cc: { type: "string", description: "CC. Opcional." },
        isHtml: { type: "boolean", description: "Se true, body é HTML. Padrão false." },
      },
      required: ["to", "subject", "body"],
    },
    inputValidator: outlookSendInputSchema,
    handler: async (input: z.infer<typeof outlookSendInputSchema>, ctx) => {
      try {
        const { getValidMicrosoftAccessToken } = await import("./oauthService");
        const token = await getValidMicrosoftAccessToken(ctx.tenantId);
        const message: Record<string, any> = {
          subject: input.subject,
          body: { contentType: input.isHtml ? "HTML" : "Text", content: input.body },
          toRecipients: [{ emailAddress: { address: input.to } }],
        };
        if (input.cc) {
          message.ccRecipients = [{ emailAddress: { address: input.cc } }];
        }
        await callGraph(token, "/me/sendMail", {
          method: "POST",
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        return { ok: true, sentTo: input.to };
      } catch (e: any) {
        return microsoftErrorPayload(e);
      }
    },
  });

  // 4. Envia mensagem ao Teams (write/external — requer confirmação).
  toolRegistry.register({
    name: "teams_send_message",
    module: "microsoft",
    requiresConfirmation: true,
    description:
      "Envia mensagem pelo Microsoft Teams. Use (teamId + channelId) para postar em canal ou chatId para chat 1:1/grupo. Requer confirmação obrigatória.",
    inputSchema: {
      type: "object",
      properties: {
        teamId: { type: "string", description: "ID do time (use junto com channelId)." },
        channelId: { type: "string", description: "ID do canal (junto com teamId)." },
        chatId: { type: "string", description: "ID do chat (alternativa ao team+channel)." },
        message: { type: "string", description: "Conteúdo da mensagem." },
      },
      required: ["message"],
    },
    inputValidator: teamsSendInputSchema,
    handler: async (input: z.infer<typeof teamsSendInputSchema>, ctx) => {
      try {
        const { getValidMicrosoftAccessToken } = await import("./oauthService");
        const token = await getValidMicrosoftAccessToken(ctx.tenantId);
        const path = input.chatId
          ? `/chats/${encodeURIComponent(input.chatId)}/messages`
          : `/teams/${encodeURIComponent(input.teamId!)}/channels/${encodeURIComponent(input.channelId!)}/messages`;
        const r = await callGraph(token, path, {
          method: "POST",
          body: JSON.stringify({
            body: { content: input.message },
          }),
        });
        return {
          id: r?.id ?? null,
          sentTo: input.chatId ? `chat:${input.chatId}` : `team:${input.teamId}/channel:${input.channelId}`,
        };
      } catch (e: any) {
        return microsoftErrorPayload(e);
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// WhatsApp Business (Meta Cloud API) — Sprint 4
// ─────────────────────────────────────────────────────────────────────────

const whatsappTextInputSchema = z.object({
  to: z.string().min(8, "Telefone destino obrigatório (E.164, ex.: 5511999999999)"),
  message: z.string().min(1, "message obrigatória"),
});

const whatsappTemplateInputSchema = z.object({
  to: z.string().min(8, "Telefone destino obrigatório (E.164)"),
  templateName: z.string().min(1, "templateName obrigatório"),
  languageCode: z.string().min(2).max(10).optional(),
  bodyParams: z.array(z.string()).optional(),
});

function whatsappErrorPayload(e: any): { error: string; message: string } {
  if (e?.code === "whatsapp_not_connected" || e?.name === "WhatsappNotConnectedError") {
    return {
      error: "whatsapp_not_connected",
      message: e?.message || "WhatsApp não conectado para este tenant. Conecte em Configurações → Integrações.",
    };
  }
  return { error: "whatsapp_api_error", message: e?.message || "Falha ao chamar a Meta Cloud API." };
}

async function callMeta(token: string, phoneNumberId: string, payload: any): Promise<any> {
  const r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data as any)?.error?.message || `Meta API ${r.status}`;
    throw new Error(msg);
  }
  return data;
}

function registerWhatsappTools(): void {
  // 1. Envia mensagem de texto livre (apenas em janelas de 24h após mensagem do usuário).
  toolRegistry.register({
    name: "whatsapp_send_text",
    module: "whatsapp",
    requiresConfirmation: true,
    description:
      "Envia mensagem de texto via WhatsApp Business (Meta Cloud). Atenção: só funciona dentro da janela de 24h após mensagem do destinatário; fora dela, use whatsapp_send_template. Requer confirmação obrigatória.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Telefone destino em E.164 (ex.: 5511999999999)." },
        message: { type: "string", description: "Texto da mensagem." },
      },
      required: ["to", "message"],
    },
    inputValidator: whatsappTextInputSchema,
    handler: async (input: z.infer<typeof whatsappTextInputSchema>, ctx) => {
      try {
        const { getWhatsappConnection } = await import("./oauthService");
        const conn = await getWhatsappConnection(ctx.tenantId);
        const data = await callMeta(conn.accessToken, conn.phoneNumberId, {
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: { body: input.message },
        });
        const msgId = (data?.messages?.[0]?.id) ?? null;
        return { id: msgId, to: input.to };
      } catch (e: any) {
        return whatsappErrorPayload(e);
      }
    },
  });

  // 2. Envia template aprovado (funciona fora da janela de 24h).
  toolRegistry.register({
    name: "whatsapp_send_template",
    module: "whatsapp",
    requiresConfirmation: true,
    description:
      "Envia template HSM aprovado pela Meta via WhatsApp Business. Use fora da janela de 24h ou para mensagens de notificação. bodyParams substitui as variáveis {{1}}, {{2}}... do template. Requer confirmação obrigatória.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Telefone destino em E.164." },
        templateName: { type: "string", description: "Nome do template aprovado." },
        languageCode: { type: "string", description: "Código de idioma (ex.: pt_BR). Padrão pt_BR." },
        bodyParams: {
          type: "array",
          items: { type: "string" },
          description: "Variáveis posicionais do template ({{1}}, {{2}}...). Opcional.",
        },
      },
      required: ["to", "templateName"],
    },
    inputValidator: whatsappTemplateInputSchema,
    handler: async (input: z.infer<typeof whatsappTemplateInputSchema>, ctx) => {
      try {
        const { getWhatsappConnection } = await import("./oauthService");
        const conn = await getWhatsappConnection(ctx.tenantId);
        const components: any[] = [];
        if (input.bodyParams && input.bodyParams.length > 0) {
          components.push({
            type: "body",
            parameters: input.bodyParams.map((text) => ({ type: "text", text })),
          });
        }
        const data = await callMeta(conn.accessToken, conn.phoneNumberId, {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.languageCode || "pt_BR" },
            ...(components.length > 0 ? { components } : {}),
          },
        });
        const msgId = (data?.messages?.[0]?.id) ?? null;
        return { id: msgId, to: input.to, template: input.templateName };
      } catch (e: any) {
        return whatsappErrorPayload(e);
      }
    },
  });

  // ─── BI Expansion — tools para o BI Agent (lista métricas + executa) ──
  (async () => {
    const { biTools } = await import("../bi/biAgentTools");
    for (const t of biTools) {
      toolRegistry.register({
        name: t.name,
        module: t.module,
        description: t.description,
        inputSchema: t.inputSchema as any,
        inputValidator: (t as any).inputValidator,
        requiresConfirmation: t.requiresConfirmation,
        handler: t.handler as any,
      });
    }
  })().catch((err) => console.error("[mcp/biTools] registration failed:", err));
}

// Helper exportado para os testes / endpoint Sprint 2.
export function getRegisteredModuleNames(): string[] {
  return ["core", "control", "societario", "recovery", "google", "microsoft", "whatsapp", "bi"];
}
