/**
 * proposalPdfService.ts — Geração de PDF de proposta formal de pagamento
 * (Sprint 2). Usa pdf-lib para criar um documento A4 com:
 *  - Header Arcádia + nº do processo
 *  - Bloco identificação do devedor (cliente do consultor)
 *  - Bloco identificação do credor
 *  - Resumo financeiro (valor original, valor proposto, desconto, CET)
 *  - Tabela de parcelas (até 60 — depois "ver anexo")
 *  - Justificativa
 *  - Linhas de assinatura
 */
import { PDFDocument, StandardFonts, rgb, PageSizes, type PDFFont, type PDFPage } from "pdf-lib";
import type { RecoveryProposal, RecoveryScenario, RecoveryCreditor, RecoveryProcess, Pessoa } from "@shared/schema";

const MARGIN = 50;
const LINE = 14;

function fmtBRL(v: any): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtPct(v: any, dec = 4): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(dec)}%`;
}
function fmtDate(v: any): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

/** Helper para pular página quando o cursor passar do limite. */
function ensureSpace(state: { page: PDFPage; y: number; doc: PDFDocument }, needed: number, font: PDFFont) {
  if (state.y - needed < MARGIN + 30) {
    state.page = state.doc.addPage(PageSizes.A4);
    state.y = state.page.getHeight() - MARGIN;
  }
}

function drawText(state: { page: PDFPage; y: number; doc: PDFDocument }, text: string, opts: {
  font: PDFFont; size?: number; color?: { r: number; g: number; b: number }; x?: number; bold?: boolean;
}) {
  const size = opts.size ?? 10;
  const color = opts.color ?? { r: 0.15, g: 0.15, b: 0.2 };
  ensureSpace(state, size + 4, opts.font);
  state.page.drawText(text, {
    x: opts.x ?? MARGIN,
    y: state.y,
    size,
    font: opts.font,
    color: rgb(color.r, color.g, color.b),
  });
  state.y -= size + 4;
}

export type PdfInput = {
  proposal: RecoveryProposal;
  scenario: RecoveryScenario;
  creditor: RecoveryCreditor;
  process: RecoveryProcess;
  cliente?: Pessoa | null;
};

export async function generateProposalPdf(input: PdfInput): Promise<Uint8Array> {
  const { proposal, scenario, creditor, process: proc, cliente } = input;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage(PageSizes.A4);
  const state = { page, y: page.getHeight() - MARGIN, doc };

  // ---------- HEADER ----------
  drawText(state, "ARCÁDIA CONSULTING", { font: fontBold, size: 18, color: { r: 0.04, g: 0.32, b: 0.55 } });
  drawText(state, "Proposta Formal de Pagamento — Recuperação Empresarial", { font, size: 10, color: { r: 0.4, g: 0.4, b: 0.5 } });
  state.y -= 6;
  drawText(state, `Processo: ${proc.nomeProcesso}`, { font, size: 9 });
  drawText(state, `Tipo: ${proc.tipoRecuperacao}${proc.numeroProcessoJudicial ? ` · Nº judicial ${proc.numeroProcessoJudicial}` : ""}`, { font, size: 9 });
  drawText(state, `Documento gerado em: ${new Date().toLocaleString("pt-BR")}`, { font, size: 9 });
  state.y -= 6;
  // Linha separadora
  state.page.drawLine({
    start: { x: MARGIN, y: state.y },
    end: { x: state.page.getWidth() - MARGIN, y: state.y },
    thickness: 0.6, color: rgb(0.04, 0.32, 0.55),
  });
  state.y -= 16;

  // ---------- DEVEDOR ----------
  drawText(state, "DEVEDOR", { font: fontBold, size: 11 });
  if (cliente) {
    const nome = cliente.razaoSocial || cliente.nomeFantasia || "—";
    drawText(state, `${nome}`, { font, size: 10 });
    if (cliente.cnpjCpf) drawText(state, `CNPJ/CPF: ${cliente.cnpjCpf}`, { font, size: 9 });
  } else {
    drawText(state, proc.nomeProcesso, { font, size: 10 });
  }
  state.y -= 8;

  // ---------- CREDOR ----------
  drawText(state, "CREDOR", { font: fontBold, size: 11 });
  drawText(state, creditor.credorNome, { font, size: 10 });
  if (creditor.credorDocumento) drawText(state, `CNPJ/CPF: ${creditor.credorDocumento}`, { font, size: 9 });
  if (creditor.tipoDebito) drawText(state, `Detalhe: ${creditor.tipoDebito}`, { font, size: 9 });
  if (creditor.numeroDocumento) drawText(state, `Documento de origem: ${creditor.numeroDocumento}`, { font, size: 9 });
  state.y -= 8;

  // ---------- RESUMO FINANCEIRO ----------
  drawText(state, "RESUMO FINANCEIRO DA PROPOSTA", { font: fontBold, size: 11 });
  const valorOriginal = Number(proposal.valorOriginal);
  const valorProposto = Number(proposal.valorProposto);
  const descontoCalc = valorOriginal > 0 ? 1 - valorProposto / valorOriginal : 0;
  drawText(state, `Valor original da dívida: ${fmtBRL(valorOriginal)}`, { font, size: 10 });
  drawText(state, `Valor proposto (total nominal): ${fmtBRL(valorProposto)}`, { font, size: 10 });
  drawText(state, `Desconto efetivo: ${(descontoCalc * 100).toFixed(2)}%`, { font, size: 10 });
  drawText(state, `Parcelas: ${proposal.numParcelas ?? 1}x · intervalo ${proposal.intervaloDias ?? 30} dias · carência ${proposal.carenciaMeses ?? 0} mês(es)`, { font, size: 10 });
  if (proposal.primeiraParcelaData) drawText(state, `Primeira parcela: ${fmtDate(proposal.primeiraParcelaData)}`, { font, size: 10 });
  if (proposal.taxaPropostaMensal != null) drawText(state, `Taxa informada: ${fmtPct(proposal.taxaPropostaMensal)} a.m.`, { font, size: 10 });
  if (proposal.cetMensal != null) {
    drawText(state, `CET (Custo Efetivo Total): ${fmtPct(proposal.cetMensal)} a.m.`, { font: fontBold, size: 10, color: { r: 0.04, g: 0.32, b: 0.55 } });
  }
  state.y -= 8;

  // ---------- TABELA DE PARCELAS (até 60) ----------
  const num = Number(proposal.numParcelas || 1);
  const valorParcela = num > 0 ? valorProposto / num : valorProposto;
  const intervalo = Number(proposal.intervaloDias || 30);
  const baseDate = proposal.primeiraParcelaData ? new Date(proposal.primeiraParcelaData) : new Date();
  drawText(state, "CRONOGRAMA DE PAGAMENTOS", { font: fontBold, size: 11 });
  drawText(state, "Nº     Vencimento        Valor", { font: fontBold, size: 9 });
  const limite = Math.min(num, 60);
  for (let i = 0; i < limite; i++) {
    const due = new Date(baseDate.getTime() + i * intervalo * 86_400_000);
    const linha = `${String(i + 1).padStart(3, "0")}    ${fmtDate(due).padEnd(14)}  ${fmtBRL(valorParcela)}`;
    drawText(state, linha, { font, size: 9 });
  }
  if (num > limite) {
    drawText(state, `... (mais ${num - limite} parcela(s) — vide planilha anexa)`, { font, size: 9, color: { r: 0.5, g: 0.5, b: 0.5 } });
  }
  state.y -= 10;

  // ---------- JUSTIFICATIVA ----------
  if (proposal.justificativa) {
    drawText(state, "JUSTIFICATIVA / CONTEXTO", { font: fontBold, size: 11 });
    const lines = wrapText(proposal.justificativa, font, 10, state.page.getWidth() - 2 * MARGIN);
    for (const ln of lines) drawText(state, ln, { font, size: 10 });
    state.y -= 8;
  }

  // ---------- ASSINATURAS ----------
  ensureSpace(state, 100, font);
  state.y -= 30;
  state.page.drawLine({ start: { x: MARGIN, y: state.y }, end: { x: MARGIN + 200, y: state.y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  state.page.drawLine({ start: { x: state.page.getWidth() - MARGIN - 200, y: state.y }, end: { x: state.page.getWidth() - MARGIN, y: state.y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.3) });
  state.y -= 12;
  state.page.drawText("Devedor", { x: MARGIN, y: state.y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  state.page.drawText("Credor", { x: state.page.getWidth() - MARGIN - 200, y: state.y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  state.y -= 12;
  state.page.drawText("Data: ____ / ____ / ________", { x: MARGIN, y: state.y, size: 9, font });
  state.page.drawText("Data: ____ / ____ / ________", { x: state.page.getWidth() - MARGIN - 200, y: state.y, size: 9, font });

  // Footer numero da página em todas
  const total = doc.getPageCount();
  for (let i = 0; i < total; i++) {
    const p = doc.getPage(i);
    p.drawText(`Arcádia Consulting — Recovery — proposta ${proposal.id.slice(0, 8)} — ${i + 1}/${total}`, {
      x: MARGIN, y: 20, size: 7, font, color: rgb(0.6, 0.6, 0.6),
    });
  }

  return doc.save();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.replace(/\r/g, "").split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    const wlen = font.widthOfTextAtSize(test, size);
    if (wlen > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  // Quebra linhas explícitas
  const final: string[] = [];
  for (const ln of lines) {
    final.push(...ln.split("\n"));
  }
  return final;
}
