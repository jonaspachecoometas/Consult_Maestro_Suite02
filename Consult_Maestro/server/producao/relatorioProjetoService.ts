// PROD-3 — Relatório Dinâmico do Projeto
// Lê dados existentes (scrum_internal_projects, scrum_sprints, scrum_backlog_items,
// reunioes_projeto, acoes_reuniao, orcamentos_mensais) e produz relatório consolidado
// + alertas via Agente IA (cache 30min) + exports XLSX e HTML-imprimível para PDF.

import * as XLSX from "xlsx";
import { db } from "../db";
import {
  scrumInternalProjects, scrumSprints, scrumBacklogItems,
  reunioesProjeto, acoesReuniao, projects, clients,
  orcamentosMensais,
} from "@shared/schema";
import { and, eq, desc, asc, gte, sql } from "drizzle-orm";
import { runWithOrchestration } from "../mcp/llmOrchestrator";
import { callChatLLM } from "../mcp/llmClient";

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface VisaoGeral {
  projetoId: string;
  nome: string;
  clienteNome: string | null;
  faseAtual: string;
  percentualConclusao: number; // 0..100
  dataInicio: string | null;
  previsaoFim: string | null;
  diasRestantes: number | null;
  orcamentoTotal: number; // BRL
  valorPago: number; // BRL — fases concluídas (heurística)
  proximoMarco: { label: string; data: string; diasRestantes: number } | null;
}

export interface SprintAtual {
  sprintId: string | null;
  nome: string | null;
  goal: string | null;
  totalTarefas: number;
  concluidas: number;
  emAndamento: number;
  atrasadas: number;
  percentual: number;
  velocidadeSemanal: number; // tarefas concluídas nos últimos 7d
  impedimentos: { id: string; titulo: string; motivo: string | null }[];
}

export interface SprintHistorico {
  id: string;
  numero: number;
  titulo: string;
  periodo: string;
  totalTarefas: number;
  concluidas: number;
  percentual: number;
  status: "concluido" | "em_andamento" | "atrasado" | "futuro";
}

export interface ReuniaoProxima {
  id: string;
  numero: number;
  data: string;
  tipo: string;
  sprint: string | null;
  temPauta: boolean;
}

export interface AlertaAgente {
  nivel: "critico" | "atencao" | "info";
  mensagem: string;
}

export interface RelatorioProjeto {
  visaoGeral: VisaoGeral;
  sprintAtual: SprintAtual;
  historicoSprints: SprintHistorico[];
  proximasReunioes: ReuniaoProxima[];
  alertasAgente: AlertaAgente[];
  geradoEm: string;
}

// ── Cache de alertas (30min) ─────────────────────────────────────────────────

interface CacheEntry { at: number; alertas: AlertaAgente[]; }
const ALERTAS_CACHE = new Map<string, CacheEntry>();
const ALERTAS_TTL_MS = 30 * 60 * 1000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${dt.getFullYear()}`;
}
function diasEntre(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
function parseSprintNumero(name: string): number {
  const m = name.match(/sprint\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 9999;
}
function extractFase(name: string): string {
  // Padrão "Sprint 3 — Nível 1 - Financeiro" ou "Sprint 0 — Preparação"
  const m = name.match(/—\s*([^—-]+)/);
  return m ? m[1].trim() : name;
}

// ── Carregamento base ────────────────────────────────────────────────────────

async function loadProjeto(tenantId: string, projetoId: string) {
  const [iproj] = await db.select().from(scrumInternalProjects)
    .where(eq(scrumInternalProjects.id, projetoId)).limit(1);
  if (!iproj) throw Object.assign(new Error("Projeto não encontrado"), { httpStatus: 404 });

  let cliente: { id: string; name: string } | null = null;
  let projetoCliente: { id: string; tenantId: string | null; clientId: string; dueDate: Date | null; startDate: Date | null } | null = null;
  if (iproj.clientProjectId) {
    const [pj] = await db.select().from(projects).where(eq(projects.id, iproj.clientProjectId)).limit(1);
    if (pj) {
      if (pj.tenantId !== tenantId) throw Object.assign(new Error("Sem acesso"), { httpStatus: 403 });
      projetoCliente = { id: pj.id, tenantId: pj.tenantId, clientId: pj.clientId, dueDate: pj.dueDate, startDate: pj.startDate };
      const [cl] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, pj.clientId)).limit(1);
      cliente = cl ?? null;
    }
  }
  return { iproj, cliente, projetoCliente };
}

async function buildVisaoGeral(
  tenantId: string,
  iproj: any, cliente: { id: string; name: string } | null,
  projetoCliente: any, sprints: any[], pbis: any[],
): Promise<VisaoGeral> {
  const total = pbis.length;
  const done = pbis.filter(p => p.status === "concluido").length;
  const percentual = total > 0 ? Math.round((done / total) * 100) : 0;

  // Datas: prioriza scrum_internal_projects.startDate/endDate; senão usa client project
  const startDate: Date | null = iproj.startDate ?? projetoCliente?.startDate ?? null;
  const endDate: Date | null = iproj.endDate ?? projetoCliente?.dueDate ?? null;
  const hoje = new Date();
  const diasRestantes = endDate ? diasEntre(hoje, new Date(endDate)) : null;

  // Fase atual = nome da fase do sprint ativo (ou último não concluído)
  const ativo = sprints.find(s => s.status === "active");
  const faseAtual = ativo ? extractFase(ativo.name) : (sprints[sprints.length - 1] ? extractFase(sprints[sprints.length - 1].name) : "—");

  // Próximo marco = próximo sprint endDate >= hoje
  const futuros = sprints
    .filter(s => s.endDate && new Date(s.endDate).getTime() >= hoje.getTime())
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  const proximoMarco = futuros[0]
    ? { label: futuros[0].name, data: fmtDate(futuros[0].endDate)!, diasRestantes: diasEntre(hoje, new Date(futuros[0].endDate)) }
    : null;

  // Orçamento: soma valorPrevisto de orcamentos_mensais do cliente no ano corrente.
  // valorPago é heurístico: % conclusão geral × orçamento total.
  let orcamentoTotal = 0;
  if (cliente) {
    const ano = hoje.getFullYear();
    const rows = await db.select({ valorPrevisto: orcamentosMensais.valorPrevisto })
      .from(orcamentosMensais)
      .where(and(
        eq(orcamentosMensais.tenantId, tenantId),
        eq(orcamentosMensais.clienteId, cliente.id),
        eq(orcamentosMensais.ano, ano),
      ));
    orcamentoTotal = rows.reduce((acc, r) => acc + Number(r.valorPrevisto || 0), 0);
  }
  const valorPago = Math.round(orcamentoTotal * (percentual / 100) * 100) / 100;

  return {
    projetoId: iproj.id,
    nome: iproj.name,
    clienteNome: cliente?.name ?? null,
    faseAtual,
    percentualConclusao: percentual,
    dataInicio: fmtDate(startDate),
    previsaoFim: fmtDate(endDate),
    diasRestantes,
    orcamentoTotal,
    valorPago,
    proximoMarco,
  };
}

function buildSprintAtual(sprints: any[], pbis: any[]): SprintAtual {
  const ativo = sprints.find(s => s.status === "active") ?? null;
  if (!ativo) {
    return {
      sprintId: null, nome: null, goal: null,
      totalTarefas: 0, concluidas: 0, emAndamento: 0, atrasadas: 0,
      percentual: 0, velocidadeSemanal: 0, impedimentos: [],
    };
  }
  const tasks = pbis.filter(p => p.sprintId === ativo.id);
  const total = tasks.length;
  const concluidas = tasks.filter(p => p.status === "concluido").length;
  const emAndamento = tasks.filter(p => p.status === "em_execucao" || p.status === "em_revisao" || p.status === "selecionado").length;
  const hoje = new Date();
  const atrasadas = tasks.filter(p => p.dueDate && new Date(p.dueDate).getTime() < hoje.getTime() && p.status !== "concluido" && p.status !== "cancelado").length;
  const sete = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);
  const velocidadeSemanal = tasks.filter(p => p.completedAt && new Date(p.completedAt).getTime() >= sete.getTime()).length;
  const impedimentos = tasks
    .filter(p => p.isBlocked === 1 || p.status === "bloqueado")
    .map(p => ({ id: p.id, titulo: p.title, motivo: p.blockedReason ?? null }));

  return {
    sprintId: ativo.id, nome: ativo.name, goal: ativo.goal,
    totalTarefas: total, concluidas, emAndamento, atrasadas,
    percentual: total > 0 ? Math.round((concluidas / total) * 100) : 0,
    velocidadeSemanal,
    impedimentos,
  };
}

function buildHistoricoSprints(sprints: any[], pbis: any[]): SprintHistorico[] {
  const hoje = new Date();
  return sprints
    .slice()
    .sort((a, b) => parseSprintNumero(a.name) - parseSprintNumero(b.name))
    .map(s => {
      const tasks = pbis.filter(p => p.sprintId === s.id);
      const total = tasks.length;
      const concluidas = tasks.filter(p => p.status === "concluido").length;
      const periodo = `${fmtDate(s.startDate) ?? "—"} a ${fmtDate(s.endDate) ?? "—"}`;
      let status: SprintHistorico["status"] = "futuro";
      if (s.status === "completed") status = "concluido";
      else if (s.status === "active") status = "em_andamento";
      else if (s.endDate && new Date(s.endDate).getTime() < hoje.getTime()) status = "atrasado";
      return {
        id: s.id,
        numero: parseSprintNumero(s.name),
        titulo: s.name,
        periodo,
        totalTarefas: total,
        concluidas,
        percentual: total > 0 ? Math.round((concluidas / total) * 100) : 0,
        status,
      };
    });
}

async function buildProximasReunioes(tenantId: string, projetoId: string): Promise<ReuniaoProxima[]> {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const rows = await db.select().from(reunioesProjeto)
    .where(and(
      eq(reunioesProjeto.tenantId, tenantId),
      eq(reunioesProjeto.projetoId, projetoId),
      gte(reunioesProjeto.data, hoje),
    ))
    .orderBy(asc(reunioesProjeto.data))
    .limit(5);
  return rows.map(r => ({
    id: r.id,
    numero: r.numero ?? 0,
    data: r.data instanceof Date ? r.data.toISOString() : String(r.data),
    tipo: r.tipo,
    sprint: r.sprint ?? null,
    temPauta: !!(r.pautaJson && Array.isArray(r.pautaJson) && r.pautaJson.length > 0),
  }));
}

async function gerarAlertasIA(
  tenantId: string, projetoId: string,
  vg: VisaoGeral, sa: SprintAtual, hs: SprintHistorico[], pr: ReuniaoProxima[],
): Promise<AlertaAgente[]> {
  const cacheKey = `${tenantId}::${projetoId}`;
  const cached = ALERTAS_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < ALERTAS_TTL_MS) return cached.alertas;

  // Heurísticas determinísticas (sempre presentes)
  const baseAlertas: AlertaAgente[] = [];
  if (vg.proximoMarco && vg.proximoMarco.diasRestantes <= 10 && sa.percentual < 70) {
    baseAlertas.push({
      nivel: "critico",
      mensagem: `${sa.nome ?? "Sprint atual"} com ${sa.percentual}% de conclusão — ${vg.proximoMarco.label} em ${vg.proximoMarco.diasRestantes} dias.`,
    });
  }
  if (sa.atrasadas > 0) {
    baseAlertas.push({ nivel: "atencao", mensagem: `${sa.atrasadas} tarefa(s) atrasada(s) na sprint atual.` });
  }
  if (sa.impedimentos.length > 0) {
    baseAlertas.push({ nivel: "atencao", mensagem: `${sa.impedimentos.length} impedimento(s) ativo(s) — revise bloqueios.` });
  }
  const semPauta = pr.filter(r => !r.temPauta).length;
  if (semPauta > 0) {
    baseAlertas.push({ nivel: "info", mensagem: `${semPauta} reunião(ões) próxima(s) sem pauta gerada.` });
  }

  // Tenta enriquecer via IA (não bloqueia se falhar)
  let iaAlertas: AlertaAgente[] = [];
  try {
    const contexto = {
      projeto: { nome: vg.nome, fase: vg.faseAtual, percentual: vg.percentualConclusao, diasRestantes: vg.diasRestantes },
      sprintAtual: { nome: sa.nome, percentual: sa.percentual, atrasadas: sa.atrasadas, impedimentos: sa.impedimentos.length },
      historicoStatus: hs.map(h => ({ n: h.numero, p: h.percentual, s: h.status })),
      proximoMarco: vg.proximoMarco,
      proximasReunioes: pr.map(r => ({ data: r.data, sprint: r.sprint, temPauta: r.temPauta })),
    };
    const systemPrompt = `Você é um Project Manager sênior. Analise o estado do projeto e retorne ATÉ 3 alertas acionáveis em JSON: [{nivel:'critico'|'atencao'|'info', mensagem:string}]. Foque em: riscos de prazo, gargalos não óbvios, recomendações de ação imediata. Apenas o JSON, sem texto adicional.`;
    const userPrompt = `Contexto:\n${JSON.stringify(contexto, null, 2)}\n\nGere os alertas agora.`;
    const orch = await runWithOrchestration(
      "analise_projeto", tenantId,
      { sensitivity: "internal" },
      (cb) => callChatLLM(cb, { systemPrompt, userPrompt, maxTokens: 600 }),
    );
    const text = String(orch.data || "").trim();
    const m = text.match(/\[[\s\S]*\]/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) {
        iaAlertas = parsed
          .filter(a => a && typeof a.mensagem === "string")
          .map(a => ({
            nivel: (["critico", "atencao", "info"].includes(a.nivel) ? a.nivel : "info") as AlertaAgente["nivel"],
            mensagem: String(a.mensagem).slice(0, 280),
          }))
          .slice(0, 3);
      }
    }
  } catch (e) {
    console.warn("[relatorio] alertas IA falhou:", (e as any)?.message);
  }

  const alertas = [...baseAlertas, ...iaAlertas].slice(0, 8);
  ALERTAS_CACHE.set(cacheKey, { at: Date.now(), alertas });
  return alertas;
}

// ── API pública ──────────────────────────────────────────────────────────────

export async function getRelatorio(tenantId: string, projetoId: string): Promise<RelatorioProjeto> {
  const { iproj, cliente, projetoCliente } = await loadProjeto(tenantId, projetoId);

  const sprints = await db.select().from(scrumSprints)
    .where(eq(scrumSprints.internalProjectId, projetoId));
  const pbis = await db.select().from(scrumBacklogItems)
    .where(and(
      eq(scrumBacklogItems.tenantId, tenantId),
      eq(scrumBacklogItems.internalProjectId, projetoId),
    ));

  const visaoGeral = await buildVisaoGeral(tenantId, iproj, cliente, projetoCliente, sprints, pbis);
  const sprintAtual = buildSprintAtual(sprints, pbis);
  const historicoSprints = buildHistoricoSprints(sprints, pbis);
  const proximasReunioes = await buildProximasReunioes(tenantId, projetoId);
  const alertasAgente = await gerarAlertasIA(tenantId, projetoId, visaoGeral, sprintAtual, historicoSprints, proximasReunioes);

  return {
    visaoGeral, sprintAtual, historicoSprints, proximasReunioes, alertasAgente,
    geradoEm: new Date().toISOString(),
  };
}

export async function exportarXlsx(tenantId: string, projetoId: string): Promise<{ buffer: Buffer; filename: string }> {
  const rel = await getRelatorio(tenantId, projetoId);

  const wb = XLSX.utils.book_new();

  // Aba 1: Visão Geral
  const vgRows: any[][] = [
    ["Relatório de Projeto"],
    [],
    ["Projeto", rel.visaoGeral.nome],
    ["Cliente", rel.visaoGeral.clienteNome ?? "—"],
    ["Fase Atual", rel.visaoGeral.faseAtual],
    ["% Conclusão", `${rel.visaoGeral.percentualConclusao}%`],
    ["Início", rel.visaoGeral.dataInicio ?? "—"],
    ["Previsão de Fim", rel.visaoGeral.previsaoFim ?? "—"],
    ["Dias Restantes", rel.visaoGeral.diasRestantes ?? "—"],
    ["Orçamento Total (R$)", rel.visaoGeral.orcamentoTotal.toFixed(2)],
    ["Valor Pago Estimado (R$)", rel.visaoGeral.valorPago.toFixed(2)],
    ["Próximo Marco", rel.visaoGeral.proximoMarco ? `${rel.visaoGeral.proximoMarco.label} (${rel.visaoGeral.proximoMarco.data}, em ${rel.visaoGeral.proximoMarco.diasRestantes}d)` : "—"],
    [],
    ["Sprint Atual", rel.sprintAtual.nome ?? "—"],
    ["Total tarefas", rel.sprintAtual.totalTarefas],
    ["Concluídas", rel.sprintAtual.concluidas],
    ["Em andamento", rel.sprintAtual.emAndamento],
    ["Atrasadas", rel.sprintAtual.atrasadas],
    ["% Sprint", `${rel.sprintAtual.percentual}%`],
    ["Velocidade semanal", rel.sprintAtual.velocidadeSemanal],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vgRows), "Visão Geral");

  // Aba 2: Histórico de Sprints
  const hsRows: any[][] = [
    ["#", "Sprint", "Período", "Total", "Concluídas", "% Conclusão", "Status"],
    ...rel.historicoSprints.map(h => [
      h.numero, h.titulo, h.periodo, h.totalTarefas, h.concluidas, `${h.percentual}%`, h.status,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hsRows), "Sprints");

  // Aba 3: Próximas Reuniões
  const prRows: any[][] = [
    ["#", "Data", "Tipo", "Sprint", "Pauta gerada"],
    ...rel.proximasReunioes.map(r => [
      r.numero, fmtDate(r.data) ?? r.data, r.tipo, r.sprint ?? "—", r.temPauta ? "Sim" : "Não",
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prRows), "Reuniões");

  // Aba 4: Alertas
  const alRows: any[][] = [
    ["Nível", "Mensagem"],
    ...rel.alertasAgente.map(a => [a.nivel, a.mensagem]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(alRows), "Alertas");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safe = rel.visaoGeral.nome.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const data = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `relatorio_${safe}_${data}.xlsx` };
}

export async function exportarHtml(tenantId: string, projetoId: string): Promise<{ html: string; filename: string }> {
  const rel = await getRelatorio(tenantId, projetoId);
  const safe = rel.visaoGeral.nome.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const data = new Date().toISOString().slice(0, 10);

  const esc = (s: any) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const nivelCor = (n: string) => n === "critico" ? "#dc2626" : n === "atencao" ? "#f59e0b" : "#0ea5e9";

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório — ${esc(rel.visaoGeral.nome)}</title>
<style>
  body { font-family: 'Inter', system-ui, sans-serif; color: #111; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  h1 { color: #1e3a8a; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; }
  h2 { color: #1e3a8a; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f3f4f6; }
  .kpi { display: inline-block; background: #f3f4f6; padding: 8px 14px; border-radius: 6px; margin: 4px 8px 4px 0; }
  .kpi b { color: #1e3a8a; }
  .alerta { padding: 8px 12px; border-left: 4px solid #aaa; margin: 6px 0; background: #fafafa; font-size: 13px; }
  .footer { margin-top: 40px; font-size: 11px; color: #666; }
  @media print { .no-print { display: none; } body { margin: 0; } }
</style></head><body>
<div class="no-print" style="text-align:right;margin-bottom:8px">
  <button onclick="window.print()" style="padding:8px 16px;background:#1e3a8a;color:#fff;border:0;border-radius:6px;cursor:pointer">Imprimir / Salvar PDF</button>
</div>

<h1>Relatório do Projeto</h1>
<h2>1. Visão Geral</h2>
<div>
  <span class="kpi"><b>Projeto:</b> ${esc(rel.visaoGeral.nome)}</span>
  <span class="kpi"><b>Cliente:</b> ${esc(rel.visaoGeral.clienteNome ?? "—")}</span>
  <span class="kpi"><b>Fase:</b> ${esc(rel.visaoGeral.faseAtual)}</span>
  <span class="kpi"><b>% Conclusão:</b> ${rel.visaoGeral.percentualConclusao}%</span>
  <span class="kpi"><b>Início:</b> ${esc(rel.visaoGeral.dataInicio ?? "—")}</span>
  <span class="kpi"><b>Previsão Fim:</b> ${esc(rel.visaoGeral.previsaoFim ?? "—")}</span>
  ${rel.visaoGeral.diasRestantes !== null ? `<span class="kpi"><b>Dias Restantes:</b> ${rel.visaoGeral.diasRestantes}</span>` : ""}
  <span class="kpi"><b>Orçamento:</b> R$ ${rel.visaoGeral.orcamentoTotal.toFixed(2)}</span>
  <span class="kpi"><b>Valor Pago Estim.:</b> R$ ${rel.visaoGeral.valorPago.toFixed(2)}</span>
  ${rel.visaoGeral.proximoMarco ? `<span class="kpi"><b>Próximo Marco:</b> ${esc(rel.visaoGeral.proximoMarco.label)} (${rel.visaoGeral.proximoMarco.data})</span>` : ""}
</div>

<h2>2. Sprint Atual</h2>
${rel.sprintAtual.nome ? `
<p><b>${esc(rel.sprintAtual.nome)}</b> ${rel.sprintAtual.goal ? `— <i>${esc(rel.sprintAtual.goal)}</i>` : ""}</p>
<div>
  <span class="kpi"><b>Total:</b> ${rel.sprintAtual.totalTarefas}</span>
  <span class="kpi"><b>Concluídas:</b> ${rel.sprintAtual.concluidas}</span>
  <span class="kpi"><b>Em andamento:</b> ${rel.sprintAtual.emAndamento}</span>
  <span class="kpi"><b>Atrasadas:</b> ${rel.sprintAtual.atrasadas}</span>
  <span class="kpi"><b>%:</b> ${rel.sprintAtual.percentual}%</span>
  <span class="kpi"><b>Velocidade (7d):</b> ${rel.sprintAtual.velocidadeSemanal} tarefas</span>
</div>
${rel.sprintAtual.impedimentos.length > 0 ? `<h3>Impedimentos</h3><ul>${rel.sprintAtual.impedimentos.map(i => `<li><b>${esc(i.titulo)}</b>${i.motivo ? ` — ${esc(i.motivo)}` : ""}</li>`).join("")}</ul>` : ""}
` : "<p><i>Nenhuma sprint ativa.</i></p>"}

<h2>3. Histórico de Sprints</h2>
<table>
  <thead><tr><th>#</th><th>Sprint</th><th>Período</th><th>Total</th><th>Concl.</th><th>%</th><th>Status</th></tr></thead>
  <tbody>${rel.historicoSprints.map(h => `<tr><td>${h.numero}</td><td>${esc(h.titulo)}</td><td>${esc(h.periodo)}</td><td>${h.totalTarefas}</td><td>${h.concluidas}</td><td>${h.percentual}%</td><td>${h.status}</td></tr>`).join("")}</tbody>
</table>

<h2>4. Próximas Reuniões</h2>
${rel.proximasReunioes.length > 0 ? `<table>
  <thead><tr><th>#</th><th>Data</th><th>Tipo</th><th>Sprint</th><th>Pauta</th></tr></thead>
  <tbody>${rel.proximasReunioes.map(r => `<tr><td>${r.numero}</td><td>${esc(fmtDate(r.data) ?? r.data)}</td><td>${esc(r.tipo)}</td><td>${esc(r.sprint ?? "—")}</td><td>${r.temPauta ? "✓" : "—"}</td></tr>`).join("")}</tbody>
</table>` : "<p><i>Nenhuma reunião agendada.</i></p>"}

<h2>5. Alertas do Agente</h2>
${rel.alertasAgente.length > 0 ? rel.alertasAgente.map(a => `<div class="alerta" style="border-left-color:${nivelCor(a.nivel)}"><b>[${a.nivel.toUpperCase()}]</b> ${esc(a.mensagem)}</div>`).join("") : "<p><i>Sem alertas no momento.</i></p>"}

<div class="footer">Gerado em ${new Date(rel.geradoEm).toLocaleString("pt-BR")}.</div>
</body></html>`;

  return { html, filename: `relatorio_${safe}_${data}.pdf.html` };
}

// ── Util de export ───────────────────────────────────────────────────────────

export function invalidarCacheAlertas(tenantId: string, projetoId: string) {
  ALERTAS_CACHE.delete(`${tenantId}::${projetoId}`);
}
