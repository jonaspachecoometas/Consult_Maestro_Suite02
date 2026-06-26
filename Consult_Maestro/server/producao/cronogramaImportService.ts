// Cronograma Import Service — Sprint PROD-1
// Importa .xlsx do cronograma e faz upsert idempotente em:
//   - scrum_sprints (key: internalProjectId + name "Sprint N — título")
//   - scrum_backlog_items (key: hash(internalProjectId + módulo + tarefa))
//   - project_calendar_events (key: projectId + data + tipo='reuniao_sprint')
//
// Identificadores estáveis evitam duplicação na reimportação.

import * as XLSX from "xlsx";
import { createHash } from "crypto";
import { db } from "../db";
import {
  scrumInternalProjects,
  scrumSprints,
  scrumBacklogItems,
  projectCalendarEvents,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";

export interface ImportResult {
  sprints: { criados: number; atualizados: number };
  tarefas: { criadas: number; atualizadas: number };
  reunioes: { criadas: number; atualizadas: number };
  erros: string[];
  resumo: string;
}

interface ParsedSprint {
  numero: number;
  titulo: string;
  inicio: Date | null;
  fim: Date | null;
  reuniao: Date | null;
  fase: string;
  tarefas: ParsedTarefa[];
}

interface ParsedTarefa {
  modulo: string;
  tarefa: string;
  responsavel: string;
  entregavel: string;
  status: string;
  dataConclusao: Date | null;
  observacoes: string;
}

interface ParsedReuniao {
  numero: number;
  data: Date;
  sprint: string;
  pauta: string;
  fase: string;
  observacoes: string;
}

const SPRINT_HEADER_RE = /Sprint\s+(\d+)\s+[—\-–]\s+(.+?)(?:\s+\|\s+(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4}))?(?:\s+\|\s+Reuni[aã]o:\s*(\d{2}\/\d{2}\/\d{4}))?/i;
const DATE_RE = /(\d{2})\/(\d{2})\/(\d{4})/;

function parseDateBr(s: any): Date | null {
  if (!s) return null;
  if (s instanceof Date && !isNaN(s.getTime())) return s;
  // SheetJS pode retornar serial number Excel
  if (typeof s === "number" && s > 0) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(s));
    return epoch;
  }
  const str = String(s).trim();
  const m = str.match(DATE_RE);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return isNaN(d.getTime()) ? null : d;
}

function normalizeStatus(s: any): "backlog" | "em_execucao" | "concluido" {
  const str = String(s || "").toLowerCase().trim();
  if (str.includes("conclu") || str.includes("done")) return "concluido";
  if (str.includes("andamento") || str.includes("progress") || str.includes("execu")) return "em_execucao";
  return "backlog";
}

function pbiHash(internalProjectId: string, modulo: string, tarefa: string): string {
  return createHash("sha256")
    .update(`${internalProjectId}::${modulo.trim().toLowerCase()}::${tarefa.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

/** Faz parse de uma aba de tarefas que pode conter múltiplas seções de sprint */
function parseAbaTarefas(rows: any[][], faseDefault: string): ParsedSprint[] {
  const sprints: ParsedSprint[] = [];
  let current: ParsedSprint | null = null;
  let inHeader = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const first = String(row[0] || "").trim();
    if (!first && !row.some((c) => String(c || "").trim())) {
      // linha vazia
      inHeader = false;
      continue;
    }

    // detectar header de sprint
    const m = first.match(SPRINT_HEADER_RE);
    if (m) {
      const [, num, titulo, ini, fim, reun] = m;
      current = {
        numero: parseInt(num, 10),
        titulo: titulo.trim(),
        inicio: parseDateBr(ini),
        fim: parseDateBr(fim),
        reuniao: parseDateBr(reun),
        fase: faseDefault,
        tarefas: [],
      };
      sprints.push(current);
      inHeader = true;
      continue;
    }

    // header da tabela de tarefas (Módulo | Tarefa | ...)
    if (inHeader && first.toLowerCase() === "módulo") {
      inHeader = false;
      continue;
    }

    // título da aba (linha 1) — ignora
    if (first.toUpperCase().startsWith("CRONOGRAMA")) continue;

    // linha de tarefa
    if (current && first) {
      current.tarefas.push({
        modulo: first,
        tarefa: String(row[1] || "").trim(),
        responsavel: String(row[2] || "").trim(),
        entregavel: String(row[3] || "").trim(),
        status: String(row[4] || "A Fazer").trim(),
        dataConclusao: parseDateBr(row[5]),
        observacoes: String(row[6] || "").trim(),
      });
    }
  }
  // remove tarefas vazias
  for (const s of sprints) {
    s.tarefas = s.tarefas.filter((t) => t.tarefa);
  }
  return sprints;
}

/** Faz parse da aba Calendário de Reuniões */
function parseCalendario(rows: any[][]): ParsedReuniao[] {
  const reunioes: ParsedReuniao[] = [];
  for (const row of rows) {
    const first = row[0];
    // pula títulos e cabeçalhos
    if (!first) continue;
    const num = typeof first === "number" ? first : parseInt(String(first), 10);
    if (!Number.isFinite(num) || num <= 0) continue;
    const data = parseDateBr(row[1]);
    if (!data) continue;
    reunioes.push({
      numero: num,
      data,
      sprint: String(row[2] || "").trim(),
      pauta: String(row[3] || "").trim(),
      fase: String(row[4] || "").trim(),
      observacoes: String(row[5] || "").trim(),
    });
  }
  return reunioes;
}

/** Importa cronograma .xlsx no projeto interno (scrum_internal_projects). */
export async function importarCronograma(
  buffer: Buffer,
  opts: { internalProjectId: string; tenantId: string; userId?: string }
): Promise<ImportResult> {
  const result: ImportResult = {
    sprints: { criados: 0, atualizados: 0 },
    tarefas: { criadas: 0, atualizadas: 0 },
    reunioes: { criadas: 0, atualizadas: 0 },
    erros: [],
    resumo: "",
  };

  // Carrega o internal project para descobrir o clientProjectId (necessário para calendar)
  const [iproj] = await db.select().from(scrumInternalProjects)
    .where(eq(scrumInternalProjects.id, opts.internalProjectId)).limit(1);
  if (!iproj) {
    throw new Error(`Projeto interno ${opts.internalProjectId} não encontrado`);
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (e: any) {
    throw new Error(`Falha ao ler arquivo .xlsx: ${e.message}`);
  }

  // Mapeamento: aba → fase
  const abaFase: Record<string, string> = {};
  for (const name of wb.SheetNames) {
    const lower = name.toLowerCase();
    if (lower.includes("prepara")) abaFase[name] = "Preparação";
    else if (lower.startsWith("n1") || lower.includes("nível 1") || lower.includes("nivel 1")) abaFase[name] = "Nível 1";
    else if (lower.startsWith("n2") || lower.includes("nível 2") || lower.includes("nivel 2")) abaFase[name] = "Nível 2";
    else if (lower.startsWith("n3") || lower.includes("nível 3") || lower.includes("nivel 3")) abaFase[name] = "Nível 3";
  }

  // Parse de tarefas
  const todasSprints: ParsedSprint[] = [];
  for (const [aba, fase] of Object.entries(abaFase)) {
    const ws = wb.Sheets[aba];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
    try {
      const sps = parseAbaTarefas(rows, fase);
      todasSprints.push(...sps);
    } catch (e: any) {
      result.erros.push(`Aba "${aba}": ${e.message}`);
    }
  }

  // Upsert sprints — chave natural: (internalProjectId, número da sprint), extraído do prefixo
  // "Sprint N — ..." do campo name. Isso permite renomear o título sem duplicar.
  const existentesSprints = await db.select().from(scrumSprints)
    .where(eq(scrumSprints.internalProjectId, opts.internalProjectId));
  const sprintByNumero = new Map<number, typeof existentesSprints[number]>();
  for (const s of existentesSprints) {
    const m = s.name?.match(/^Sprint\s+(\d+)\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!sprintByNumero.has(n)) sprintByNumero.set(n, s);
    }
  }

  const sprintIdByNumero = new Map<number, string>();

  for (const sp of todasSprints) {
    const name = `Sprint ${sp.numero} — ${sp.titulo}`;
    const goal = sp.titulo;
    const existing = sprintByNumero.get(sp.numero);
    if (existing) {
      const [updated] = await db.update(scrumSprints).set({
        name, // permite atualizar o título da sprint mantendo o mesmo registro
        goal,
        startDate: sp.inicio,
        endDate: sp.fim,
        updatedAt: new Date(),
      }).where(eq(scrumSprints.id, existing.id)).returning();
      sprintIdByNumero.set(sp.numero, updated.id);
      result.sprints.atualizados++;
    } else {
      const [created] = await db.insert(scrumSprints).values({
        internalProjectId: opts.internalProjectId,
        name,
        goal,
        status: "planning",
        startDate: sp.inicio,
        endDate: sp.fim,
        createdById: opts.userId || null,
      }).returning();
      sprintIdByNumero.set(sp.numero, created.id);
      result.sprints.criados++;
    }
  }

  // Upsert backlog items (key = pbiHash → originId)
  // Carrega existentes de uma vez
  // originType = 'manual' (enum não tem 'import'); identificamos via prefixo "xlsx:" no originId
  const existentesPbi = await db.select().from(scrumBacklogItems)
    .where(eq(scrumBacklogItems.internalProjectId, opts.internalProjectId));
  const pbiByOrigin = new Map(existentesPbi.map((p) => [p.originId, p]));

  for (const sp of todasSprints) {
    const sprintId = sprintIdByNumero.get(sp.numero);
    for (const t of sp.tarefas) {
      const origin = `xlsx:${pbiHash(opts.internalProjectId, t.modulo, t.tarefa)}`;
      const status = normalizeStatus(t.status);
      const tags = [t.modulo, sp.fase].filter(Boolean);
      const description = [
        t.entregavel ? `**Entregável:** ${t.entregavel}` : null,
        t.responsavel ? `**Responsável:** ${t.responsavel}` : null,
        t.observacoes ? `\n${t.observacoes}` : null,
      ].filter(Boolean).join("\n");

      const existing = pbiByOrigin.get(origin);
      if (existing) {
        await db.update(scrumBacklogItems).set({
          title: t.tarefa,
          description,
          status,
          sprintId: sprintId || null,
          completedAt: t.dataConclusao,
          tags,
          updatedAt: new Date(),
        }).where(eq(scrumBacklogItems.id, existing.id));
        result.tarefas.atualizadas++;
      } else {
        await db.insert(scrumBacklogItems).values({
          tenantId: opts.tenantId,
          internalProjectId: opts.internalProjectId,
          sprintId: sprintId || null,
          title: t.tarefa,
          description,
          type: "feature",
          status,
          priority: "medium",
          originType: "manual",
          originId: origin,
          completedAt: t.dataConclusao,
          tags,
          createdById: opts.userId || null,
        });
        result.tarefas.criadas++;
      }
    }
  }

  // Upsert calendário (somente se há clientProjectId vinculado)
  const abaCal = wb.SheetNames.find((n) => n.toLowerCase().includes("calend"));
  if (abaCal && iproj.clientProjectId) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[abaCal], { header: 1, defval: "" });
    const reunioes = parseCalendario(rows);

    // Carrega existentes do tipo reuniao_sprint para esse projeto
    const existentesEv = await db.select().from(projectCalendarEvents)
      .where(and(
        eq(projectCalendarEvents.projectId, iproj.clientProjectId),
        eq(projectCalendarEvents.tipo, "reuniao_sprint"),
      ));
    const evByDate = new Map(existentesEv.map((e) => [String(e.dataInicio), e]));

    for (const r of reunioes) {
      const yyyy = r.data.getFullYear();
      const mm = String(r.data.getMonth() + 1).padStart(2, "0");
      const dd = String(r.data.getDate()).padStart(2, "0");
      const dataStr = `${yyyy}-${mm}-${dd}`;
      const titulo = `Reunião ${r.numero} — ${r.sprint || "Sprint"}`;
      const descricao = [r.pauta, r.observacoes].filter(Boolean).join("\n\n");

      const existing = evByDate.get(dataStr);
      if (existing) {
        await db.update(projectCalendarEvents).set({
          titulo,
          descricao,
          updatedAt: new Date(),
        }).where(eq(projectCalendarEvents.id, existing.id));
        result.reunioes.atualizadas++;
      } else {
        await db.insert(projectCalendarEvents).values({
          projectId: iproj.clientProjectId,
          tenantId: opts.tenantId,
          titulo,
          descricao,
          dataInicio: dataStr,
          tipo: "reuniao_sprint",
          createdById: opts.userId || null,
        });
        result.reunioes.criadas++;
      }
    }
  }

  result.resumo = [
    `Sprints: ${result.sprints.criados} criados, ${result.sprints.atualizados} atualizados.`,
    `Tarefas: ${result.tarefas.criadas} criadas, ${result.tarefas.atualizadas} atualizadas.`,
    `Reuniões: ${result.reunioes.criadas} criadas, ${result.reunioes.atualizadas} atualizadas.`,
    result.erros.length ? `Erros: ${result.erros.length}` : "",
  ].filter(Boolean).join(" ");

  return result;
}
