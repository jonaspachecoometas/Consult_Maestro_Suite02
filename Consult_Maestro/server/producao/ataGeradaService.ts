// PROD-2 — Geração de Ata de Reunião em DOCX
// Usa runWithOrchestration para gerar markdown estruturado e
// docx para renderizar o arquivo .docx final.

import * as fs from "fs";
import * as path from "path";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, PageOrientation,
} from "docx";
import { db } from "../db";
import {
  reunioesProjeto, acoesReuniao, scrumInternalProjects, scrumSprints,
  scrumBacklogItems, projects, clients,
} from "@shared/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { runWithOrchestration } from "../mcp/llmOrchestrator";
import { callChatLLM } from "../mcp/llmClient";

const ATAS_DIR = path.resolve(process.cwd(), "uploads", "atas");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeReuniaoId(id: string): string {
  if (!UUID_RE.test(id)) throw new Error("reuniaoId inválido");
  return id;
}

function ensureDir() {
  if (!fs.existsSync(ATAS_DIR)) fs.mkdirSync(ATAS_DIR, { recursive: true });
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDateOnly(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR");
}

const STATUS_LABEL: Record<string, string> = {
  backlog: "Pendente", em_execucao: "Em execução", concluido: "Concluído",
  pendente: "Pendente", concluida: "Concluída", cancelada: "Cancelada",
};

interface AtaContext {
  projetoNome: string;
  clienteNome: string;
  reuniaoData: Date;
  reuniaoNumero: number;
  reuniaoTipo: string;
  participantes: Array<{ nome: string; papel?: string }>;
  pauta: Array<{ titulo: string; descricao?: string }>;
  anotacoes: string;
  sprintNome: string | null;
  tarefasConcluidas: Array<{ titulo: string; responsavel?: string }>;
  tarefasPendentes: Array<{ titulo: string; responsavel?: string; status: string }>;
  acoes: Array<{ descricao: string; responsavel?: string; prazo?: string }>;
  isGoLive: boolean;
}

async function buildContexto(tenantId: string, reuniaoId: string): Promise<AtaContext> {
  const [reuniao] = await db.select().from(reunioesProjeto)
    .where(and(eq(reunioesProjeto.id, reuniaoId), eq(reunioesProjeto.tenantId, tenantId))).limit(1);
  if (!reuniao) throw new Error("Reunião não encontrada");

  const [iproj] = await db.select().from(scrumInternalProjects)
    .where(eq(scrumInternalProjects.id, reuniao.projetoId)).limit(1);

  let clienteNome = "—";
  if (iproj?.clientProjectId) {
    const [proj] = await db.select({ name: projects.name, clientId: projects.clientId })
      .from(projects).where(eq(projects.id, iproj.clientProjectId)).limit(1);
    if (proj?.clientId) {
      const [cli] = await db.select({ name: clients.name }).from(clients)
        .where(eq(clients.id, proj.clientId)).limit(1);
      clienteNome = cli?.name || proj.name || "—";
    }
  }

  // Sprint mais relevante
  const [sprintAtivo] = await db.select().from(scrumSprints)
    .where(and(eq(scrumSprints.internalProjectId, reuniao.projetoId), eq(scrumSprints.status, "active"))).limit(1);
  const sprintRef = sprintAtivo || (await db.select().from(scrumSprints)
    .where(eq(scrumSprints.internalProjectId, reuniao.projetoId))
    .orderBy(desc(scrumSprints.startDate)).limit(1))[0] || null;

  const tarefasConcl = sprintRef
    ? await db.select().from(scrumBacklogItems)
        .where(and(eq(scrumBacklogItems.sprintId, sprintRef.id), eq(scrumBacklogItems.status, "concluido")))
    : [];
  const tarefasPend = sprintRef
    ? await db.select().from(scrumBacklogItems)
        .where(and(eq(scrumBacklogItems.sprintId, sprintRef.id),
          inArray(scrumBacklogItems.status, ["backlog", "em_execucao"])))
    : [];

  const acoes = await db.select().from(acoesReuniao)
    .where(and(eq(acoesReuniao.tenantId, tenantId), eq(acoesReuniao.reuniaoId, reuniaoId)))
    .orderBy(desc(acoesReuniao.createdAt));

  return {
    projetoNome: iproj?.name || "—",
    clienteNome,
    reuniaoData: reuniao.data,
    reuniaoNumero: reuniao.numero ?? 0,
    reuniaoTipo: reuniao.tipo,
    participantes: (reuniao.participantes as any) || [],
    pauta: (reuniao.pautaJson as any) || [],
    anotacoes: reuniao.anotacoes || "",
    sprintNome: sprintRef?.name || null,
    tarefasConcluidas: tarefasConcl.slice(0, 30).map(t => ({ titulo: t.title })),
    tarefasPendentes: tarefasPend.slice(0, 30).map(t => ({ titulo: t.title, status: t.status })),
    acoes: acoes.map(a => ({
      descricao: a.descricao,
      responsavel: a.responsavel || undefined,
      prazo: a.prazo ? fmtDateOnly(a.prazo) : undefined,
    })),
    isGoLive: reuniao.tipo === "golive",
  };
}

async function gerarResumoIA(ctx: AtaContext, tenantId: string): Promise<{
  resumo: string;
  decisoes: string[];
}> {
  const systemPrompt = `Você é o secretário-relator da ARCadia Consulting.
Receberá o contexto de uma reunião de projeto e deve gerar:
1. Um RESUMO EXECUTIVO em 1 parágrafo (60–120 palavras), impessoal e objetivo
2. Uma lista de DECISÕES TOMADAS (de 0 a 8 itens, frases curtas)

Responda em JSON puro, sem markdown:
{ "resumo": "...", "decisoes": ["...", "..."] }`;
  const userPrompt = JSON.stringify({
    projeto: ctx.projetoNome, cliente: ctx.clienteNome,
    reuniao: { numero: ctx.reuniaoNumero, tipo: ctx.reuniaoTipo, data: fmtDate(ctx.reuniaoData) },
    sprint: ctx.sprintNome,
    pauta: ctx.pauta,
    anotacoes: ctx.anotacoes.slice(0, 4000),
    tarefasConcluidas: ctx.tarefasConcluidas,
    tarefasPendentes: ctx.tarefasPendentes,
    acoes: ctx.acoes,
  });

  try {
    const orch = await runWithOrchestration(
      "gerar_ata_reuniao",
      tenantId,
      { sensitivity: "internal" },
      (cb) => callChatLLM(cb, { systemPrompt, userPrompt, maxTokens: 1200 }),
    );
    const text = String(orch.data || "").trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return {
        resumo: String(parsed.resumo || "").slice(0, 1500),
        decisoes: Array.isArray(parsed.decisoes) ? parsed.decisoes.slice(0, 10).map((d: any) => String(d).slice(0, 300)) : [],
      };
    }
  } catch (err) {
    console.warn("[ata] geração IA falhou:", (err as any)?.message);
  }
  // Fallback simples
  return {
    resumo: `Reunião ${ctx.reuniaoTipo} nº ${ctx.reuniaoNumero} do projeto ${ctx.projetoNome} (${ctx.clienteNome}) realizada em ${fmtDate(ctx.reuniaoData)}.` +
      (ctx.anotacoes ? ` Notas: ${ctx.anotacoes.slice(0, 400)}` : ""),
    decisoes: [],
  };
}

// ── Builders DOCX ──────────────────────────────────────────────────────────

function p(text: string, opts: { bold?: boolean; size?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: opts.align,
    spacing: { after: opts.spacing ?? 120 },
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? 22 })],
  });
}
function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, bold: true })] });
}
function tableCell(content: string, bold = false): TableCell {
  return new TableCell({
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: content, bold, size: 20 })] })],
  });
}
function makeTable(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map(h => tableCell(h, true)) }),
      ...rows.map(r => new TableRow({ children: r.map(c => tableCell(c)) })),
    ],
  });
}

function buildDoc(ctx: AtaContext, ia: { resumo: string; decisoes: string[] }): Document {
  const children: any[] = [];

  // Cabeçalho
  children.push(p("ARCADIA CONSULTING", { bold: true, size: 28, align: AlignmentType.CENTER, spacing: 60 }));
  children.push(p(`ATA DE REUNIÃO Nº ${String(ctx.reuniaoNumero).padStart(3, "0")} — ${ctx.reuniaoTipo.toUpperCase()}`,
    { bold: true, size: 24, align: AlignmentType.CENTER }));
  children.push(p(""));
  children.push(makeTable(["Projeto", "Cliente", "Data"], [[ctx.projetoNome, ctx.clienteNome, fmtDate(ctx.reuniaoData)]]));

  // Participantes
  children.push(h("Participantes"));
  if (ctx.participantes.length === 0) {
    children.push(p("Não informados.", { size: 20 }));
  } else {
    children.push(makeTable(
      ["Nome", "Papel"],
      ctx.participantes.map(p => [p.nome, p.papel || "—"]),
    ));
  }

  // 1. Resumo executivo
  children.push(h("1. Resumo Executivo"));
  children.push(p(ia.resumo));

  // 2. Pautas e decisões
  children.push(h("2. Pautas Discutidas e Decisões"));
  if (ctx.pauta.length > 0) {
    ctx.pauta.forEach((it, i) => {
      children.push(p(`${i + 1}. ${it.titulo}`, { bold: true, size: 22 }));
      if (it.descricao) children.push(p(it.descricao, { size: 20 }));
    });
  } else {
    children.push(p("(Pauta não registrada)", { size: 20 }));
  }
  if (ia.decisoes.length > 0) {
    children.push(p("Decisões:", { bold: true, size: 22, spacing: 60 }));
    ia.decisoes.forEach(d => children.push(p(`• ${d}`, { size: 20, spacing: 60 })));
  }
  if (ctx.anotacoes) {
    children.push(p("Anotações:", { bold: true, size: 22, spacing: 60 }));
    ctx.anotacoes.split(/\n+/).filter(l => l.trim()).forEach(l => {
      children.push(p(l.trim(), { size: 20, spacing: 60 }));
    });
  }

  // 3. Status do sprint
  children.push(h(`3. Status do Sprint${ctx.sprintNome ? `: ${ctx.sprintNome}` : ""}`));
  if (ctx.tarefasConcluidas.length === 0 && ctx.tarefasPendentes.length === 0) {
    children.push(p("Nenhuma tarefa registrada para o sprint.", { size: 20 }));
  } else {
    const rows = [
      ...ctx.tarefasConcluidas.map(t => [t.titulo, t.responsavel || "—", "Concluído"]),
      ...ctx.tarefasPendentes.map(t => [t.titulo, t.responsavel || "—", STATUS_LABEL[t.status] || t.status]),
    ];
    children.push(makeTable(["Tarefa", "Responsável", "Status"], rows));
  }

  // 4. Próximas ações
  children.push(h("4. Próximas Ações"));
  if (ctx.acoes.length === 0) {
    children.push(p("Nenhuma ação registrada.", { size: 20 }));
  } else {
    children.push(makeTable(
      ["Ação", "Responsável", "Prazo"],
      ctx.acoes.map(a => [a.descricao, a.responsavel || "—", a.prazo || "—"]),
    ));
  }

  // Termo de aceite (Go-Live)
  if (ctx.isGoLive) {
    children.push(h("5. Termo de Aceite (Go-Live)"));
    children.push(p(
      "As partes abaixo declaram que as funcionalidades entregues foram revisadas e atendem aos critérios de aceite acordados, formalizando o GO-LIVE do projeto.",
      { size: 22 },
    ));
  }

  // 5/6. Assinaturas
  children.push(p(""));
  children.push(p(""));
  children.push(h(ctx.isGoLive ? "6. Assinaturas" : "5. Assinaturas"));
  children.push(p(""));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "_____________________________          _____________________________" })] }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60 },
    children: [new TextRun({ text: `ARCadia Consulting          ${ctx.clienteNome}`, bold: true, size: 20 })],
  }));

  return new Document({
    creator: "ARCadia Consulting — Plataforma de Diagnóstico",
    title: `Ata Reunião ${ctx.reuniaoNumero} — ${ctx.projetoNome}`,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT } } },
      children,
    }],
  });
}

export async function gerarAta(
  tenantId: string, reuniaoId: string,
): Promise<{ ataDocUrl: string; absolutePath: string; bytes: number }> {
  ensureDir();
  const ctx = await buildContexto(tenantId, reuniaoId);
  const ia = await gerarResumoIA(ctx, tenantId);
  const doc = buildDoc(ctx, ia);
  const buf = await Packer.toBuffer(doc);
  const fname = `ata_${safeReuniaoId(reuniaoId)}.docx`;
  const abs = path.join(ATAS_DIR, fname);
  // Defesa em profundidade: garante que o caminho final permanece dentro de ATAS_DIR
  if (!abs.startsWith(ATAS_DIR + path.sep)) throw new Error("path traversal bloqueado");
  fs.writeFileSync(abs, buf);

  const url = `/uploads/atas/${fname}`;
  await db.update(reunioesProjeto)
    .set({ ataDocUrl: url, status: ctx.reuniaoTipo === "golive" ? "realizada" : "realizada", updatedAt: new Date() })
    .where(and(eq(reunioesProjeto.id, reuniaoId), eq(reunioesProjeto.tenantId, tenantId)));

  return { ataDocUrl: url, absolutePath: abs, bytes: buf.length };
}

export function getAtaAbsolutePath(reuniaoId: string): string {
  const abs = path.join(ATAS_DIR, `ata_${safeReuniaoId(reuniaoId)}.docx`);
  if (!abs.startsWith(ATAS_DIR + path.sep)) throw new Error("path traversal bloqueado");
  return abs;
}
