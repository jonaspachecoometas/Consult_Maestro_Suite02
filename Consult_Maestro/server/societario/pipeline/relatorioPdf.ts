import { PDFDocument, StandardFonts, PageSizes, rgb, type PDFFont } from "pdf-lib";

const MARGIN = 50;

function sanitize(s: string): string {
  return String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitize(text);
  const words = safe.replace(/\r/g, "").split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tentative = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(tentative, size) <= maxWidth) {
      cur = tentative;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  em_andamento: "Em andamento",
  concluido: "Concluído",
  bloqueado: "Bloqueado",
  cancelado: "Cancelado",
};

const EXECUTOR_LABEL: Record<string, string> = {
  analista: "Analista",
  cliente: "Cliente",
  agente: "Agente",
  sistema: "Sistema",
};

export interface RelatorioPdfInput {
  processo: any;
  config: any | null;
  sociedade: any | null;
  cliente?: { nome: string; documento?: string | null } | null;
  analistaNome?: string | null;
  tarefas: any[];
  movimentacoes: any[];
}

export async function renderProcessoRelatorioPdf(input: RelatorioPdfInput): Promise<Uint8Array> {
  const { processo, config, sociedade, cliente, analistaNome, tarefas, movimentacoes } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(PageSizes.A4);
  let y = page.getHeight() - MARGIN;
  const W = page.getWidth();

  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) {
      page = doc.addPage(PageSizes.A4);
      y = page.getHeight() - MARGIN;
    }
  };
  const text = (
    s: string,
    opts: { bold?: boolean; size?: number; color?: any; x?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    ensure(size + 4);
    page.drawText(sanitize(s), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? rgb(0.15, 0.15, 0.2),
      maxWidth: W - 2 * MARGIN,
    });
    y -= size + 4;
  };
  const rule = () => {
    ensure(8);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: W - MARGIN, y },
      thickness: 0.6,
      color: rgb(0.04, 0.32, 0.55),
    });
    y -= 10;
  };

  text("ARCÁDIA CONSULTING", { bold: true, size: 16, color: rgb(0.04, 0.32, 0.55) });
  text("Societário — Relatório de Processo", { size: 10, color: rgb(0.4, 0.4, 0.5) });
  y -= 4;

  text(`Processo: ${processo.processNumber}  ·  ${processo.titulo}`, { bold: true, size: 11 });
  text(`Tipo: ${String(processo.tipoProcesso).replace(/_/g, " ")}  ·  Pipeline: ${config?.nome ?? "—"}`, { size: 9 });
  text(
    `Status: ${processo.status ?? "—"}  ·  Coluna atual: ${processo.colunaAtual ?? "—"}  ·  Prioridade: ${processo.prioridade ?? "—"}  ·  Modo: ${processo.modoOperacao ?? "—"}`,
    { size: 9 },
  );
  if (sociedade) {
    text(`Sociedade: ${sociedade.razaoSocial ?? sociedade.nomeFantasia ?? "—"}`, { size: 9 });
  }
  if (cliente?.nome) {
    text(`Cliente: ${cliente.nome}${cliente.documento ? ` (${cliente.documento})` : ""}`, { size: 9 });
  }
  if (analistaNome) {
    text(`Analista responsável: ${analistaNome}`, { size: 9 });
  }
  text(
    `Aberto em: ${processo.createdAt ? new Date(processo.createdAt).toLocaleDateString("pt-BR") : "—"}` +
      `  ·  Prazo: ${processo.dataPrevistaConclusao ? new Date(processo.dataPrevistaConclusao).toLocaleDateString("pt-BR") : "Não definido"}` +
      `  ·  Concluído em: ${processo.dataConclusao ? new Date(processo.dataConclusao).toLocaleDateString("pt-BR") : "—"}`,
    { size: 9 },
  );
  text(`Documento gerado em: ${new Date().toLocaleString("pt-BR")}`, { size: 8, color: rgb(0.5, 0.5, 0.5) });

  if (processo.descricao) {
    rule();
    text("Descrição", { bold: true, size: 10 });
    for (const ln of wrapText(processo.descricao, font, 9, W - 2 * MARGIN)) {
      text(ln, { size: 9, color: rgb(0.3, 0.3, 0.3) });
    }
  }

  rule();
  text("Checklist", { bold: true, size: 11 });
  const aplicaveis = (tarefas ?? []).filter((t) => t.aplicavel !== false);
  text(
    `${aplicaveis.length} tarefas aplicáveis  ·  ${aplicaveis.filter((t) => t.status === "concluido").length} concluídas`,
    { size: 8, color: rgb(0.5, 0.5, 0.5) },
  );

  const porEtapa = new Map<string, any[]>();
  for (const t of aplicaveis) {
    if (!porEtapa.has(t.etapa)) porEtapa.set(t.etapa, []);
    porEtapa.get(t.etapa)!.push(t);
  }
  const colunasOrdenadas: Array<{ id: string; nome: string }> = (config?.colunas ?? [])
    .slice()
    .sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0));

  for (const col of colunasOrdenadas) {
    const itens = (porEtapa.get(col.id) ?? []).slice().sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
    if (itens.length === 0) continue;
    ensure(20);
    y -= 4;
    text(`Etapa: ${col.nome}`, { bold: true, size: 10, color: rgb(0.04, 0.32, 0.55) });
    for (const t of itens) {
      const marker = t.status === "concluido" ? "[x]" : "[ ]";
      const exec = EXECUTOR_LABEL[t.executorType] ?? t.executorType ?? "—";
      const stat = STATUS_LABEL[t.status] ?? t.status ?? "—";
      text(`${marker} ${t.titulo}  ·  ${exec}  ·  ${stat}`, { size: 9 });
      if (t.concluidoAt) {
        text(
          `    concluída em ${new Date(t.concluidoAt).toLocaleString("pt-BR")}` +
            (t.concluidoNotes ? `  —  ${String(t.concluidoNotes).slice(0, 200)}` : ""),
          { size: 8, color: rgb(0.45, 0.45, 0.5) },
        );
      }
    }
    y -= 2;
  }

  rule();
  text("Histórico de movimentações", { bold: true, size: 11 });
  const movs = (movimentacoes ?? []).slice().sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return da - db;
  });
  if (movs.length === 0) {
    text("Sem movimentações registradas.", { size: 9, color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const m of movs) {
      const dt = m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR") : "—";
      const fluxo = m.colunaDe ? `${m.colunaDe} → ${m.colunaPara}` : `→ ${m.colunaPara}`;
      const ator = m.movidoPorAgente ? "Agente" : "Operador";
      text(`[${dt}]  ${fluxo}  ·  ${ator}`, { size: 9 });
      if (m.motivo) {
        for (const ln of wrapText(`Motivo: ${m.motivo}`, font, 8, W - 2 * MARGIN - 12)) {
          text(`    ${ln}`, { size: 8, color: rgb(0.45, 0.45, 0.5) });
        }
      }
    }
  }

  const total = doc.getPageCount();
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i);
    p.drawText(`Arcádia Consulting — Societário — ${processo.processNumber} — ${i + 1}/${total}`, {
      x: MARGIN,
      y: 20,
      size: 7,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
  return doc.save();
}

// ----- Relatório CONSOLIDADO (lista de processos) -----
// Usado por GET /api/societario/pipeline/relatorio.pdf — recorte gerencial.
export interface RelatorioConsolidadoInput {
  processos: Array<{
    processNumber: string;
    titulo: string;
    tipoProcesso: string;
    colunaAtual: string | null;
    status: string | null;
    prioridade: string | null;
    sociedadeNome?: string | null;
    clienteNome?: string | null;
    analistaNome?: string | null;
    createdAt?: Date | string | null;
    dataPrevistaConclusao?: Date | string | null;
    dataConclusao?: Date | string | null;
  }>;
  filtros?: {
    tipoProcesso?: string;
    analista?: string;
    status?: string;
  };
}

export async function renderPipelineRelatorioConsolidadoPdf(
  input: RelatorioConsolidadoInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(PageSizes.A4);
  let y = page.getHeight() - MARGIN;
  const W = page.getWidth();

  const ensure = (h: number) => {
    if (y - h < MARGIN + 20) {
      page = doc.addPage(PageSizes.A4);
      y = page.getHeight() - MARGIN;
    }
  };
  const text = (
    s: string,
    opts: { bold?: boolean; size?: number; color?: any; x?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    ensure(size + 4);
    page.drawText(sanitize(s), {
      x: opts.x ?? MARGIN,
      y,
      size,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? rgb(0.15, 0.15, 0.2),
      maxWidth: W - 2 * MARGIN,
    });
    y -= size + 4;
  };
  const rule = () => {
    ensure(8);
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: W - MARGIN, y },
      thickness: 0.6,
      color: rgb(0.04, 0.32, 0.55),
    });
    y -= 10;
  };

  text("ARCÁDIA CONSULTING", { bold: true, size: 16, color: rgb(0.04, 0.32, 0.55) });
  text("Societário — Relatório consolidado de processos", { size: 10, color: rgb(0.4, 0.4, 0.5) });
  text(`Documento gerado em: ${new Date().toLocaleString("pt-BR")}`, { size: 8, color: rgb(0.5, 0.5, 0.5) });

  const f = input.filtros ?? {};
  const filtros = [
    f.tipoProcesso ? `Tipo=${f.tipoProcesso}` : null,
    f.status ? `Status=${f.status}` : null,
    f.analista ? `Analista=${f.analista}` : null,
  ].filter(Boolean).join("  ·  ");
  if (filtros) text(`Filtros: ${filtros}`, { size: 8, color: rgb(0.5, 0.5, 0.5) });

  rule();
  text(`Total: ${input.processos.length} processo(s)`, { bold: true, size: 11 });
  y -= 4;

  if (input.processos.length === 0) {
    text("Nenhum processo encontrado para os filtros aplicados.", { size: 9, color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const p of input.processos) {
      ensure(40);
      text(`${p.processNumber}  ·  ${p.titulo}`, { bold: true, size: 10 });
      text(
        `Tipo: ${String(p.tipoProcesso).replace(/_/g, " ")}  ·  Status: ${p.status ?? "—"}  ·  Coluna: ${p.colunaAtual ?? "—"}  ·  Prioridade: ${p.prioridade ?? "—"}`,
        { size: 8, color: rgb(0.3, 0.3, 0.3) },
      );
      const linha2: string[] = [];
      if (p.sociedadeNome) linha2.push(`Sociedade: ${p.sociedadeNome}`);
      if (p.clienteNome) linha2.push(`Cliente: ${p.clienteNome}`);
      if (p.analistaNome) linha2.push(`Analista: ${p.analistaNome}`);
      if (linha2.length) text(linha2.join("  ·  "), { size: 8, color: rgb(0.4, 0.4, 0.4) });
      text(
        `Aberto: ${p.createdAt ? new Date(p.createdAt).toLocaleDateString("pt-BR") : "—"}` +
          `  ·  Prazo: ${p.dataPrevistaConclusao ? new Date(p.dataPrevistaConclusao).toLocaleDateString("pt-BR") : "—"}` +
          `  ·  Concluído: ${p.dataConclusao ? new Date(p.dataConclusao).toLocaleDateString("pt-BR") : "—"}`,
        { size: 8, color: rgb(0.4, 0.4, 0.4) },
      );
      y -= 4;
    }
  }

  const total = doc.getPageCount();
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i);
    p.drawText(`Arcádia Consulting — Societário — Consolidado — ${i + 1}/${total}`, {
      x: MARGIN,
      y: 20,
      size: 7,
      font,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
  return doc.save();
}
