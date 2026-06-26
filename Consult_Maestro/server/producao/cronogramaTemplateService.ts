// Cronograma Template Service — Sprint PROD-1
// Gera .xlsx no layout exato da planilha Impacto Geologia (6 abas) para download.
// Layout espelhado de attached_assets/Cronograma_ERP_Impacto_Geologia_*.xlsx

import * as XLSX from "xlsx";

export interface CronogramaTemplateOptions {
  projetoNome?: string;
  clienteNome?: string;
  parceiroNome?: string;
  dataInicio?: Date; // base para calcular quintas-feiras
  numeroReunioes?: number; // default 20
}

interface SprintTemplate {
  numero: number;
  titulo: string;
  modulo: string;
  inicio: string; // dd/MM/yyyy
  fim: string;
  reuniao: string; // dd/MM/yyyy quinta
  fase: "Preparação" | "Nível 1" | "Nível 2" | "Nível 3";
  tarefas: { modulo: string; tarefa: string; responsavel: string; entregavel: string }[];
}

const ABA_HEADERS = ["Módulo", "Tarefa / Atividade", "Responsável", "Entregável Esperado", "Status", "Data Conclusão", "Observações"];
const RESP_DEFAULT = "ARCadia Capital";
const STATUS_DEFAULT = "A Fazer";

function fmtDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function nextThursday(from: Date): Date {
  const d = new Date(from);
  // 4 = quinta-feira
  while (d.getDay() !== 4) d.setDate(d.getDate() + 1);
  return d;
}

function tarefasPreparacao() {
  return [
    { modulo: "Infraestrutura", tarefa: "Provisionar ambiente de homologação e produção", responsavel: RESP_DEFAULT, entregavel: "Ambientes acessíveis" },
    { modulo: "Infraestrutura", tarefa: "Configurar acessos, perfis e usuários iniciais", responsavel: RESP_DEFAULT, entregavel: "Usuários ativos" },
    { modulo: "Infraestrutura", tarefa: "Configurar repositório Git e pipeline CI/CD básico", responsavel: RESP_DEFAULT, entregavel: "Repositório ativo com branch strategy" },
    { modulo: "Planejamento", tarefa: "Reunião de kickoff com equipe — apresentação e metodologia", responsavel: "Ambas", entregavel: "Ata de kickoff assinada" },
    { modulo: "Dados Mestres", tarefa: "Coletar plano de contas, centros de custo e cadastros base", responsavel: "Cliente", entregavel: "Planilhas recebidas e validadas" },
    { modulo: "Dados Mestres", tarefa: "Coletar tabela de produtos/serviços e clientes/fornecedores", responsavel: "Cliente", entregavel: "Cadastros validados" },
    { modulo: "Documentação", tarefa: "Validar cronograma e marcos com cliente", responsavel: "Ambas", entregavel: "Cronograma aprovado" },
    { modulo: "Documentação", tarefa: "Definir matriz de responsabilidades RACI", responsavel: "Ambas", entregavel: "Matriz RACI publicada" },
    { modulo: "Treinamento", tarefa: "Plano de capacitação para multiplicadores", responsavel: RESP_DEFAULT, entregavel: "Plano de treinamento aprovado" },
  ];
}

function buildSprintsTemplate(): SprintTemplate[] {
  // Layout baseado no real Impacto: 1 sprint Preparação + 8 N1 + 4 N2 + 3 N3 = 16 sprints
  const sprints: SprintTemplate[] = [];

  // Preparação — Sprint 0
  sprints.push({
    numero: 0,
    titulo: "Preparação de Ambiente e Planejamento",
    modulo: "Preparação",
    inicio: "", fim: "", reuniao: "",
    fase: "Preparação",
    tarefas: tarefasPreparacao(),
  });

  // N1 — Base Operacional (8 sprints)
  const n1: { titulo: string; modulo: string; tarefas: { modulo: string; tarefa: string; entregavel: string }[] }[] = [
    { titulo: "Financeiro: Plano de Contas e Cadastros Base", modulo: "Financeiro", tarefas: [
      { modulo: "Financeiro", tarefa: "Configurar Plano de Contas conforme necessidades do Lucro Real", entregavel: "Plano de Contas homologado" },
      { modulo: "Financeiro", tarefa: "Cadastrar centros de custo e departamentos", entregavel: "Centros de custo ativos" },
      { modulo: "Financeiro", tarefa: "Importar cadastro de clientes e fornecedores", entregavel: "Base de clientes/fornecedores importada" },
      { modulo: "Financeiro", tarefa: "Configurar condições de pagamento e formas de recebimento", entregavel: "Condições de pagamento configuradas" },
      { modulo: "Financeiro", tarefa: "Configurar contas bancárias e carteiras", entregavel: "Bancos cadastrados" },
      { modulo: "Financeiro", tarefa: "Definir tipos de documento financeiro", entregavel: "Tipos de documento ativos" },
    ]},
    { titulo: "Financeiro: CP, CR e Fluxo de Caixa", modulo: "Financeiro", tarefas: [
      { modulo: "Financeiro", tarefa: "Parametrizar Contas a Pagar (lançamento e baixa)", entregavel: "CP operacional" },
      { modulo: "Financeiro", tarefa: "Parametrizar Contas a Receber (lançamento e baixa)", entregavel: "CR operacional" },
      { modulo: "Financeiro", tarefa: "Configurar Fluxo de Caixa diário e mensal", entregavel: "Fluxo de Caixa operante" },
      { modulo: "Financeiro", tarefa: "Configurar conciliação bancária", entregavel: "Conciliação operacional" },
      { modulo: "Financeiro", tarefa: "Configurar relatórios financeiros (DRE, balanço)", entregavel: "Relatórios validados" },
    ]},
    { titulo: "Fiscal: Notas Fiscais e Tributação", modulo: "Fiscal", tarefas: [
      { modulo: "Fiscal", tarefa: "Configurar emissão de NF-e e NFS-e", entregavel: "Emissão de NF-e ativa" },
      { modulo: "Fiscal", tarefa: "Configurar tabela de tributos (PIS, COFINS, ICMS, ISS)", entregavel: "Tributação parametrizada" },
      { modulo: "Fiscal", tarefa: "Configurar regras de retenção e substituição tributária", entregavel: "Regras de retenção ativas" },
      { modulo: "Fiscal", tarefa: "Validar SPED Fiscal e Contribuições", entregavel: "SPED gerado com validação" },
      { modulo: "Fiscal", tarefa: "Configurar livros fiscais e DCTF", entregavel: "Obrigações acessórias prontas" },
    ]},
    { titulo: "RH: Cadastros e Folha", modulo: "RH", tarefas: [
      { modulo: "RH", tarefa: "Cadastrar funcionários, cargos e estrutura salarial", entregavel: "Quadro funcional ativo" },
      { modulo: "RH", tarefa: "Configurar folha de pagamento e proventos/descontos", entregavel: "Folha calculada com sucesso" },
      { modulo: "RH", tarefa: "Configurar férias, 13º, rescisões", entregavel: "Eventos automáticos parametrizados" },
      { modulo: "RH", tarefa: "Integrar folha com financeiro (lançamentos automáticos)", entregavel: "Integração RH-Financeiro ativa" },
      { modulo: "RH", tarefa: "Validar eSocial e DCTFWeb", entregavel: "eSocial transmitido" },
    ]},
    { titulo: "Compras: Pedidos e Cotação", modulo: "Compras", tarefas: [
      { modulo: "Compras", tarefa: "Configurar fluxo de cotação e tomada de preços", entregavel: "Workflow de cotação ativo" },
      { modulo: "Compras", tarefa: "Parametrizar pedidos de compra e aprovações", entregavel: "PO com workflow de aprovação" },
      { modulo: "Compras", tarefa: "Integrar pedidos com Contas a Pagar", entregavel: "Integração Compras-CP ativa" },
      { modulo: "Compras", tarefa: "Configurar contratos com fornecedores", entregavel: "Contratos cadastrados" },
    ]},
    { titulo: "Estoque: Recebimento e Movimentação", modulo: "Estoque", tarefas: [
      { modulo: "Estoque", tarefa: "Configurar locais de estoque e tipos de movimento", entregavel: "Estrutura de estoque definida" },
      { modulo: "Estoque", tarefa: "Configurar entrada de NF de fornecedor com baixa de pedido", entregavel: "Recebimento integrado" },
      { modulo: "Estoque", tarefa: "Parametrizar transferências e ajustes de inventário", entregavel: "Movimentações de ajuste ativas" },
      { modulo: "Estoque", tarefa: "Configurar relatórios de saldo, giro e curva ABC", entregavel: "Relatórios de estoque ativos" },
    ]},
    { titulo: "Vendas: Pedidos e Faturamento", modulo: "Vendas", tarefas: [
      { modulo: "Vendas", tarefa: "Configurar tabela de preços e políticas comerciais", entregavel: "Política comercial ativa" },
      { modulo: "Vendas", tarefa: "Parametrizar pedidos de venda e workflow de aprovação", entregavel: "Pedido de venda operacional" },
      { modulo: "Vendas", tarefa: "Integrar pedidos com Faturamento e CR", entregavel: "Integração Vendas-Faturamento ativa" },
      { modulo: "Vendas", tarefa: "Configurar comissões de vendedores", entregavel: "Comissões calculadas automaticamente" },
    ]},
    { titulo: "Go-Live N1 e Termo de Aceite", modulo: "Implantação", tarefas: [
      { modulo: "Implantação", tarefa: "Migrar saldos iniciais e dados históricos", entregavel: "Saldos abertos no sistema" },
      { modulo: "Implantação", tarefa: "Treinamento operacional dos usuários N1", entregavel: "Usuários treinados" },
      { modulo: "Implantação", tarefa: "Suporte assistido na primeira semana de operação", entregavel: "Operação assistida concluída" },
      { modulo: "Implantação", tarefa: "Termo de Aceite Go-Live N1", entregavel: "Termo assinado" },
    ]},
  ];

  for (let i = 0; i < n1.length; i++) {
    sprints.push({
      numero: i + 1,
      titulo: n1[i].titulo,
      modulo: n1[i].modulo,
      inicio: "", fim: "", reuniao: "",
      fase: "Nível 1",
      tarefas: n1[i].tarefas.map((t) => ({ ...t, responsavel: RESP_DEFAULT })),
    });
  }

  // N2 — Projetos (4 sprints)
  const n2: { titulo: string; modulo: string; tarefas: { modulo: string; tarefa: string; entregavel: string }[] }[] = [
    { titulo: "CRM: Gestão de Clientes e Pipeline Comercial", modulo: "CRM", tarefas: [
      { modulo: "CRM", tarefa: "Configurar pipeline de vendas e funil comercial", entregavel: "Pipeline CRM configurado" },
      { modulo: "CRM", tarefa: "Configurar gestão de leads, oportunidades e propostas", entregavel: "Módulo leads/oportunidades ativo" },
      { modulo: "CRM", tarefa: "Integrar CRM com módulo financeiro (faturamento automático)", entregavel: "Integração CRM-Financeiro ativa" },
      { modulo: "CRM", tarefa: "Configurar relatórios de performance comercial", entregavel: "Relatórios CRM funcionais" },
    ]},
    { titulo: "Projetos: Gestão de Projetos por Fase", modulo: "Projetos", tarefas: [
      { modulo: "Projetos", tarefa: "Configurar estrutura de projetos, fases e marcos", entregavel: "Estrutura de projetos ativa" },
      { modulo: "Projetos", tarefa: "Parametrizar apontamento de horas por projeto", entregavel: "Timesheet operacional" },
      { modulo: "Projetos", tarefa: "Configurar controle orçamentário por projeto (previsto x realizado)", entregavel: "Controle orçamentário ativo" },
      { modulo: "Projetos", tarefa: "Configurar faturamento por projeto / medição", entregavel: "Faturamento por projeto ativo" },
    ]},
    { titulo: "Ordens de Serviço: Operação Técnica", modulo: "OS", tarefas: [
      { modulo: "OS", tarefa: "Configurar abertura e roteirização de OS", entregavel: "Workflow de OS ativo" },
      { modulo: "OS", tarefa: "Parametrizar apontamento de horas/materiais por OS", entregavel: "Apontamento operacional" },
      { modulo: "OS", tarefa: "Integrar OS com Estoque e Financeiro", entregavel: "Integração OS-Estoque-Financeiro ativa" },
      { modulo: "OS", tarefa: "Configurar relatórios de produtividade e SLA", entregavel: "Relatórios de OS funcionais" },
    ]},
    { titulo: "Go-Live N2 e Termo de Aceite", modulo: "Implantação", tarefas: [
      { modulo: "Implantação", tarefa: "Migrar carteira de projetos e OSs em andamento", entregavel: "Projetos abertos no sistema" },
      { modulo: "Implantação", tarefa: "Treinamento operacional dos usuários N2", entregavel: "Usuários treinados" },
      { modulo: "Implantação", tarefa: "Suporte assistido de 1 semana", entregavel: "Operação assistida concluída" },
      { modulo: "Implantação", tarefa: "Termo de Aceite Go-Live N2", entregavel: "Termo assinado" },
    ]},
  ];

  for (let i = 0; i < n2.length; i++) {
    sprints.push({
      numero: 9 + i,
      titulo: n2[i].titulo,
      modulo: n2[i].modulo,
      inicio: "", fim: "", reuniao: "",
      fase: "Nível 2",
      tarefas: n2[i].tarefas.map((t) => ({ ...t, responsavel: RESP_DEFAULT })),
    });
  }

  // N3 — Automação e BI (3 sprints)
  const n3: { titulo: string; modulo: string; tarefas: { modulo: string; tarefa: string; entregavel: string }[] }[] = [
    { titulo: "SGQ: Sistema de Gestão da Qualidade", modulo: "SGQ", tarefas: [
      { modulo: "SGQ", tarefa: "Configurar controle de documentos e registros da qualidade", entregavel: "Gestão documental ativa" },
      { modulo: "SGQ", tarefa: "Configurar não conformidades, ações corretivas e preventivas", entregavel: "Módulo NC/AC/AP ativo" },
      { modulo: "SGQ", tarefa: "Configurar indicadores de qualidade e dashboards SGQ", entregavel: "Indicadores SGQ configurados" },
      { modulo: "SGQ", tarefa: "Configurar auditorias internas e checklists de campo", entregavel: "Módulo auditorias funcional" },
    ]},
    { titulo: "Automação: Workflows e Integrações", modulo: "Automação", tarefas: [
      { modulo: "Automação", tarefa: "Configurar workflows automatizados (aprovações, notificações)", entregavel: "Workflows ativos" },
      { modulo: "Automação", tarefa: "Configurar integrações com APIs externas (NFe.io, bancos)", entregavel: "Integrações operacionais" },
      { modulo: "Automação", tarefa: "Configurar agentes de IA para tarefas recorrentes", entregavel: "Agentes ativos" },
    ]},
    { titulo: "BI e Go-Live N3", modulo: "BI", tarefas: [
      { modulo: "BI", tarefa: "Configurar dashboards executivos (financeiro, vendas, operação)", entregavel: "Dashboards publicados" },
      { modulo: "BI", tarefa: "Configurar BI Builder para usuários finais", entregavel: "BI Builder operacional" },
      { modulo: "Implantação", tarefa: "Treinamento BI e Termo de Aceite Go-Live N3", entregavel: "Termo assinado" },
    ]},
  ];

  for (let i = 0; i < n3.length; i++) {
    sprints.push({
      numero: 13 + i,
      titulo: n3[i].titulo,
      modulo: n3[i].modulo,
      inicio: "", fim: "", reuniao: "",
      fase: "Nível 3",
      tarefas: n3[i].tarefas.map((t) => ({ ...t, responsavel: RESP_DEFAULT })),
    });
  }

  return sprints;
}

function preencheDatas(sprints: SprintTemplate[], dataInicio: Date) {
  // Sprint 0 tem 2 semanas, demais 1 semana cada
  let cursor = new Date(dataInicio);
  for (const s of sprints) {
    const dur = s.numero === 0 ? 14 : 7;
    const ini = new Date(cursor);
    const fim = addDays(cursor, dur - 1);
    s.inicio = fmtDate(ini);
    s.fim = fmtDate(fim);
    s.reuniao = fmtDate(nextThursday(ini));
    cursor = addDays(fim, 1);
  }
}

function calendarioReunioes(dataInicio: Date, sprints: SprintTemplate[], total: number) {
  const linhas: any[][] = [];
  let dataReuniao = nextThursday(dataInicio);
  for (let i = 0; i < total; i++) {
    const sprintIdx = Math.min(i, sprints.length - 1);
    const sprint = sprints[sprintIdx];
    const pauta = sprint.numero === 0
      ? "Kickoff: apresentação de equipe, validação de cronograma e ambiente"
      : `Revisão Sprint ${sprint.numero}: ${sprint.titulo}`;
    linhas.push([
      i + 1,
      `${fmtDate(dataReuniao)} — Quinta`,
      `Sprint ${sprint.numero}`,
      pauta,
      sprint.fase,
      "",
    ]);
    dataReuniao = addDays(dataReuniao, 7);
  }
  return linhas;
}

function buildVisaoGeral(opts: CronogramaTemplateOptions, sprints: SprintTemplate[], dataInicio: Date) {
  const projeto = opts.projetoNome || "PROJETO ERP — A PREENCHER";
  const cliente = opts.clienteNome || "Cliente — A preencher";
  const parceiro = opts.parceiroNome || "ARCadia Capital";
  const aoa: any[][] = [
    [`CRONOGRAMA DE IMPLEMENTAÇÃO — ${projeto.toUpperCase()}`],
    [`${parceiro}  |  Cliente: ${cliente}  |  Início: ${fmtDate(dataInicio)}  |  Reuniões: toda Quinta-feira`],
    [],
    ["Fase", "Sprint", "Título", "Início", "Fim", "Reunião (Qui)", "Valor"],
  ];
  // Linhas resumo por fase
  const fases: SprintTemplate["fase"][] = ["Preparação", "Nível 1", "Nível 2", "Nível 3"];
  const valoresFase: Record<string, string> = { "Preparação": "—", "Nível 1": "R$ 35.000,00", "Nível 2": "R$ 38.000,00", "Nível 3": "R$ 35.000,00" };
  for (const fase of fases) {
    const ss = sprints.filter((s) => s.fase === fase);
    if (!ss.length) continue;
    const sprintRange = ss.length === 1 ? `Sprint ${ss[0].numero}` : `Sprints ${ss[0].numero}–${ss[ss.length - 1].numero}`;
    const titulo = fase === "Preparação" ? "Preparação de Ambiente e Planejamento"
      : fase === "Nível 1" ? "Base Operacional Administrativa"
      : fase === "Nível 2" ? "Gestão de Projetos e Operações"
      : "Automação, Qualidade e BI";
    const inicio = ss[0].inicio;
    const fim = ss[ss.length - 1].fim;
    const reuniao = ss.length === 1 ? ss[0].reuniao : "Quintas semanais";
    aoa.push([fase, sprintRange, titulo, inicio, fim, reuniao, valoresFase[fase]]);
  }
  aoa.push([]);
  aoa.push(["LEGENDA", "", "", "", "", "", ""]);
  aoa.push(["Status:", "A Fazer | Em Andamento | Concluído", "", "", "", "", ""]);
  aoa.push(["Responsáveis:", "ARCadia Capital | Cliente | Ambas", "", "", "", "", ""]);
  return aoa;
}

function buildAbaTarefas(titulo: string, sprints: SprintTemplate[]) {
  const aoa: any[][] = [];
  aoa.push([`CRONOGRAMA — ${titulo.toUpperCase()}`]);
  aoa.push([]);
  for (const s of sprints) {
    const header = s.inicio
      ? `  Sprint ${s.numero} — ${s.titulo}   |   ${s.inicio} a ${s.fim}   |   Reunião: ${s.reuniao} (Quinta-feira)`
      : `  Sprint ${s.numero} — ${s.titulo}   |   (datas a preencher)`;
    aoa.push([header]);
    aoa.push(ABA_HEADERS);
    for (const t of s.tarefas) {
      aoa.push([t.modulo, t.tarefa, t.responsavel, t.entregavel, STATUS_DEFAULT, "", ""]);
    }
    aoa.push([]);
  }
  return aoa;
}

function buildCalendario(opts: CronogramaTemplateOptions, sprints: SprintTemplate[], dataInicio: Date) {
  const total = opts.numeroReunioes || 20;
  const aoa: any[][] = [];
  aoa.push(["CALENDÁRIO DE REUNIÕES — TODA QUINTA-FEIRA"]);
  aoa.push([`Participantes: ${opts.parceiroNome || "ARCadia Capital"} + Equipe ${opts.clienteNome || "Cliente"}`]);
  aoa.push([]);
  aoa.push(["Nº", "Data (Quinta)", "Sprint", "Pauta Principal", "Fase", "Observações"]);
  const linhas = calendarioReunioes(dataInicio, sprints, total);
  aoa.push(...linhas);
  return aoa;
}

function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws["!cols"] = widths.map((w) => ({ wch: w }));
}

/** Gera o buffer .xlsx do cronograma template */
export function gerarCronogramaTemplate(opts: CronogramaTemplateOptions = {}): Buffer {
  const dataInicio = opts.dataInicio || new Date();
  const sprints = buildSprintsTemplate();
  preencheDatas(sprints, dataInicio);

  const wb = XLSX.utils.book_new();

  // Aba 1 — Visão Geral
  const wsVisao = XLSX.utils.aoa_to_sheet(buildVisaoGeral(opts, sprints, dataInicio));
  setColWidths(wsVisao, [14, 16, 50, 14, 14, 22, 16]);
  XLSX.utils.book_append_sheet(wb, wsVisao, "Visão Geral");

  // Aba 2 — Preparação
  const wsPrep = XLSX.utils.aoa_to_sheet(buildAbaTarefas("Preparação", sprints.filter((s) => s.fase === "Preparação")));
  setColWidths(wsPrep, [22, 60, 18, 40, 16, 16, 30]);
  XLSX.utils.book_append_sheet(wb, wsPrep, "Preparação");

  // Aba 3 — N1
  const wsN1 = XLSX.utils.aoa_to_sheet(buildAbaTarefas("N1 - Base Operacional", sprints.filter((s) => s.fase === "Nível 1")));
  setColWidths(wsN1, [22, 60, 18, 40, 16, 16, 30]);
  XLSX.utils.book_append_sheet(wb, wsN1, "N1 - Base Operacional");

  // Aba 4 — N2
  const wsN2 = XLSX.utils.aoa_to_sheet(buildAbaTarefas("N2 - Projetos", sprints.filter((s) => s.fase === "Nível 2")));
  setColWidths(wsN2, [22, 60, 18, 40, 16, 16, 30]);
  XLSX.utils.book_append_sheet(wb, wsN2, "N2 - Projetos");

  // Aba 5 — N3
  const wsN3 = XLSX.utils.aoa_to_sheet(buildAbaTarefas("N3 - Automação e BI", sprints.filter((s) => s.fase === "Nível 3")));
  setColWidths(wsN3, [22, 60, 18, 40, 16, 16, 30]);
  XLSX.utils.book_append_sheet(wb, wsN3, "N3 - Automação e BI");

  // Aba 6 — Calendário
  const wsCal = XLSX.utils.aoa_to_sheet(buildCalendario(opts, sprints, dataInicio));
  setColWidths(wsCal, [6, 26, 14, 70, 14, 30]);
  XLSX.utils.book_append_sheet(wb, wsCal, "Calendário de Reuniões");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
