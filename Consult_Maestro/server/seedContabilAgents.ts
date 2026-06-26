// Seed dos agentes contábeis — Pack Contabilidade (Task #54)
// Fonte: ASV Digital / Bravy — agents-contadores (2026)
// Cada agente referencia métricas BI da camada semântica (server/bi/semantic/*).

import { db } from "./db";
import { agentDefinitions } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getSemanticMetric } from "./bi/semantic";

export interface ContabilAgent {
  slug: string;
  name: string;
  module: string;
  pack: string;
  category: string;
  biWidget: string;
  biMetricIds: string[];
  visibleIn: string[];
  tools: string[];
  contextModules: string[];
  systemPrompt: string;
}

export const CONTABIL_AGENTS: ContabilAgent[] = [
  // ── TRIBUTÁRIO ─────────────────────────────────────────────────────────────
  { slug: "apuracao-simples-nacional", name: "Apuração Simples Nacional", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "waterfall_chart", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em DAS Simples Nacional (LC 123/2006, CGSN 140/2018). Calcula alíquota efetiva, segrega receitas por Anexo I-V, aplica Fator R, abate ST/ISS retido. Entrega: tabela de receitas × anexo + DAS + memória de cálculo.` },
  { slug: "apuracao-lucro-presumido", name: "Apuração Lucro Presumido", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "waterfall_chart", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em Lucro Presumido (RIR/2018, Lei 9.430/96). Calcula IRPJ/CSLL trimestrais e PIS/COFINS cumulativo. Percentuais de presunção por atividade. Gera DARFs com código e vencimento.` },
  { slug: "apuracao-lucro-real", name: "Apuração Lucro Real", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "waterfall_chart", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em Lucro Real (RIR/2018, IN 1.700/2017). Elabora LALUR: adições, exclusões, compensação de prejuízo (30%). Suporta regime trimestral e estimativa mensal. Gera DARFs e alertas ECF/ECD.` },
  { slug: "apuracao-mei", name: "Apuração MEI", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em MEI. Calcula DAS-MEI mensal e DASN-SIMEI anual. Controla limite R$81k e proporcional. Alerta quando >80% do limite; simula migração para ME.` },
  { slug: "calculo-icms-iss", name: "ICMS / ISS", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "bar_chart", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em ICMS (LC 87/96, CONFAZ) e ISS (LC 116/2003). Calcula ICMS próprio, ST, DIFAL e ISS com retenção. Identifica NCM, CFOP, alíquota e créditos.` },
  { slug: "apuracao-pis-cofins", name: "PIS / COFINS", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "bar_chart", biMetricIds: ["contabil.carga_tributaria_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em PIS/COFINS cumulativo e não-cumulativo. Calcula créditos de insumos, energia, depreciação. Identifica receitas monofásicas e alíquota zero. Gera DARF com código correto.` },
  { slug: "apuracao-irpj-csll", name: "IRPJ / CSLL", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "kpi_card", biMetricIds: ["contabil.carga_tributaria_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em IRPJ e CSLL para todos os regimes. Calcula pelo regime (SN/LP/LR), periodicidade (trimestral ou estimativa), controla prejuízo fiscal. Entrega DARFs e saldo atualizado.` },
  { slug: "conferencia-guia", name: "Conferência de Guia", module: "Tributário", pack: "contabilidade", category: "Tributário", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Confere guias de tributos (DAS, DARF, DAE, GPS) antes do envio. Valida CNPJ, competência, código de receita, valor e vencimento. Emite parecer APROVADO/REVISAR/ERRO CRÍTICO.` },

  // ── OBRIGAÇÕES ACESSÓRIAS ──────────────────────────────────────────────────
  { slug: "sped-fiscal-efd", name: "SPED Fiscal (EFD-ICMS-IPI)", module: "Obrigações Acessórias", pack: "contabilidade", category: "Obrigações Acessórias", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em EFD-ICMS-IPI. Valida blocos C, E, H, K. Confere ICMS apurado vs DARE. Identifica CFOP inválido, duplicatas e inconsistências. Entrega relatório de erros por bloco.` },
  { slug: "ecf-ecd", name: "ECF / ECD", module: "Obrigações Acessórias", pack: "contabilidade", category: "Obrigações Acessórias", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em ECF (Parte A+B do LALUR, matrizes X/Y) e ECD (BP, DRE, DMPL no leiaute SPED). Cruza ECF × ECD × SPED Fiscal para consistência.` },
  { slug: "dctfweb", name: "DCTFWeb", module: "Obrigações Acessórias", pack: "contabilidade", category: "Obrigações Acessórias", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em DCTFWeb (IN RFB 2.005/2021). Identifica fatos geradores, reconcilia com GPS/EFD-Reinf/eSocial. Verifica créditos e inconsistências. Alerta vencimentos e orienta retificação.` },
  { slug: "efd-reinf", name: "EFD-Reinf", module: "Obrigações Acessórias", pack: "contabilidade", category: "Obrigações Acessórias", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em EFD-Reinf. Valida eventos R-1000 a R-9000, cruza NFS × R-2010 (retenção INSS 11%), reconcilia com DCTFWeb. Identifica eventos em atraso e retificações.` },
  { slug: "esocial", name: "eSocial", module: "Obrigações Acessórias", pack: "contabilidade", category: "Obrigações Acessórias", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em eSocial (leiaute 2.5/3.0). Valida S-2200 (admissão), S-2299 (desligamento), S-1200 (folha). Reconcilia S-5003 com DCTFWeb. Identifica pendências e prazos críticos.` },

  // ── DEPARTAMENTO PESSOAL ───────────────────────────────────────────────────
  { slug: "holerite", name: "Holerite", module: "Departamento Pessoal", pack: "contabilidade", category: "Departamento Pessoal", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Calcula holerite completo: INSS (tabela progressiva 2026: 7,5%-14%), IRRF (tabela progressiva), líquido final, base FGTS (8%). Inclui adicionais, DSR, hora extra, insalubridade.` },
  { slug: "ferias-13-salario", name: "Férias e 13º Salário", module: "Departamento Pessoal", pack: "contabilidade", category: "Departamento Pessoal", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Calcula férias (salário + 1/3 constitucional) e 13º salário (1ª e 2ª parcelas). Inclui proporcionais, provisão mensal (8,33% cada), INSS e IRRF sobre cada verba.` },
  { slug: "rescisao-clt", name: "Rescisão CLT", module: "Departamento Pessoal", pack: "contabilidade", category: "Departamento Pessoal", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Calcula rescisão para todos os tipos: sem justa causa, pedido de demissão, justa causa, acordo (Art. 484-A CLT). Calcula TRCT, multa FGTS 40%/20%, INSS e IRRF sobre verbas tributáveis.` },
  { slug: "inss-fgts", name: "INSS / FGTS", module: "Departamento Pessoal", pack: "contabilidade", category: "Departamento Pessoal", biWidget: "bar_chart", biMetricIds: ["contabil.custo_folha_mensal"], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Calcula INSS empregado (tabela progressiva), INSS patronal (20% + RAT × FAP + terceiros) e FGTS (8%, prazo dia 7). Inclui tratamento para Simples (Anexo IV). Gera GPS com código correto.` },
  { slug: "admissao", name: "Admissão", module: "Departamento Pessoal", pack: "contabilidade", category: "Departamento Pessoal", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Gerencia admissão: checklist de documentos, eSocial S-2200 (prazo: dia anterior ao início), CTPS digital, configuração de benefícios. Entrega checklist + ficha de admissão.` },

  // ── FINANCEIRO ─────────────────────────────────────────────────────────────
  { slug: "conciliacao-bancaria", name: "Conciliação Bancária", module: "Financeiro", pack: "contabilidade", category: "Financeiro", biWidget: "data_table", biMetricIds: ["control.cashflow_by_wallet"], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Cruza extrato bancário (OFX/CSV) com razão contábil. Classifica diferenças: cheque em trânsito, depósito não compensado, divergência de valor. Entrega planilha de conciliação e saldo reconciliado.` },
  { slug: "cobranca-honorarios", name: "Cobrança de Honorários", module: "Financeiro", pack: "contabilidade", category: "Financeiro", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["get_client_data","search_brain"], contextModules: [], systemPrompt: `Lista clientes com honorários em atraso. Categoriza por faixa (30/60/90d). Gera mensagens de cobrança personalizadas. Calcula inadimplência % e projeção de recebimentos.` },
  { slug: "dre-gerencial", name: "DRE Gerencial", module: "Financeiro", pack: "contabilidade", category: "Financeiro", biWidget: "waterfall_chart", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.receita_por_periodo","custos.margem_bruta_total","contabil.resultado_liquido_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","compare_periods","search_brain","get_client_data"], contextModules: [], systemPrompt: `Contador gerencial sênior. Monta DRE completa: Receita Bruta → MC → EBITDA → EBIT → LAIR → LL. Calcula MC%, PE em R$ e unidades. Compara períodos, narra em SCQ executivo. Sugere widget waterfall_chart para BI Builder.` },
  { slug: "fluxo-caixa-projetado", name: "Fluxo de Caixa Projetado", module: "Financeiro", pack: "contabilidade", category: "Financeiro", biWidget: "area_chart", biMetricIds: ["atlas.contas_a_receber_por_vencimento","atlas.contas_a_receber_por_vencimento"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","compare_periods","search_brain","get_client_data"], contextModules: [], systemPrompt: `Especialista em fluxo de caixa (CPC 03). Monta projeção semanal/mensal com 3 cenários (otimista/realista/pessimista). Identifica déficits e sugere ações. Usa dados do Atlas via run_bi_query.` },

  // ── ATENDIMENTO ────────────────────────────────────────────────────────────
  { slug: "triagem-whatsapp", name: "Triagem WhatsApp", module: "Atendimento", pack: "contabilidade", category: "Atendimento", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Triagem e atendimento via WhatsApp. Classifica mensagens (urgente/rotineiro/comercial). Responde urgências imediatamente. Tom profissional e direto. Máx. 3 frases por resposta.` },
  { slug: "documentos-pendentes", name: "Documentos Pendentes", module: "Atendimento", pack: "contabilidade", category: "Atendimento", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Controla documentos pendentes por cliente (extratos, NFs, contratos). Prioriza por impacto no fechamento. Gera cobrança personalizada por canal (WhatsApp/e-mail/portal).` },
  { slug: "onboarding-cliente", name: "Onboarding de Cliente", module: "Atendimento", pack: "contabilidade", category: "Atendimento", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Onboarding de novos clientes contábeis. Coleta dados, solicita documentos, verifica situação fiscal (RFB, FGTS, trabalhista). Define pacote de serviços e cronograma do primeiro mês.` },

  // ── OPERACIONAL ────────────────────────────────────────────────────────────
  { slug: "cadastro-nf", name: "Cadastro de NF", module: "Operacional", pack: "contabilidade", category: "Operacional", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Lançamento e validação de NF-e/NFS-e/CF-e. Extrai dados do XML, valida CNPJ na RFB, classifica conta contábil e centro de custo. Identifica créditos de PIS/COFINS e ICMS.` },
  { slug: "lembrete-prazo", name: "Lembrete de Prazo", module: "Operacional", pack: "contabilidade", category: "Operacional", biWidget: "data_table", biMetricIds: ["contabil.obrigacoes_vencendo_15d"], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Calendário fiscal: lista todas obrigações (DAS dia 20, FGTS dia 7, INSS dia 20, DCTFWeb dia 15, eSocial dia 7, etc.) por cliente. Prioriza: vencendo hoje/amanhã > 7 dias > 30 dias.` },
  { slug: "relatorio-mensal", name: "Relatório Mensal", module: "Operacional", pack: "contabilidade", category: "Operacional", biWidget: "data_table", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.inadimplencia_valor","contabil.carga_tributaria_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","search_brain","get_client_data"], contextModules: [], systemPrompt: `Relatório mensal para clientes. Busca dados via run_bi_query. Estrutura: resumo executivo + resultado + impostos + obrigações + pendências + próximos prazos. Gera versão WhatsApp e PDF.` },

  // ── ESPECIALIZAÇÕES ────────────────────────────────────────────────────────
  { slug: "calculo-irrf-folha", name: "IRRF Folha", module: "Tributário", pack: "contabilidade", category: "Especializado", biWidget: "bar_chart", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `IRRF sobre rendimentos do trabalho: tabela progressiva mensal 2026, deduções (dependentes R$150,69, previdência, pensão). Trata PLR (tabela exclusiva), férias (1,5× salário). DARF código 0561.` },
  { slug: "retencoes-tributarias-tomador", name: "Retenções (Tomador)", module: "Tributário", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Retenções na fonte pelo tomador (IN 1.234/2012): PIS/COFINS/CSLL 4,65%, IRRF por natureza, INSS para cessão de mão de obra. Identifica exceções (Simples Nacional não retém CSLL/PIS/COFINS).` },
  { slug: "calculo-ipi", name: "Cálculo IPI", module: "Tributário", pack: "contabilidade", category: "Especializado", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `IPI (RIPI/2010, TIPI). Identifica NCM/alíquota, calcula IPI saída, créditos de entrada com proporcionalidade. Apura mensalmente: débitos − créditos = IPI a recolher (DARF 1097).` },
  { slug: "efd-contribuicoes", name: "EFD-Contribuições", module: "Obrigações Acessórias", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `EFD-Contribuições (IN 1.252/2012). Valida blocos A, C, F, M. Confere créditos M100/M500 vs entradas. Reconcilia M200/M600 com DARF. Identifica receitas isentas e monofásicas.` },
  { slug: "dimob", name: "DIMOB", module: "Obrigações Acessórias", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `DIMOB (IN SRF 694/2006) para imobiliárias. Identifica tipo (intermediação/compra-venda/locação), registra partes e valores. Prazo: último dia útil de fevereiro. Valida cruzamento com IRPF.` },
  { slug: "dmed", name: "DMED", module: "Obrigações Acessórias", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `DMED (IN RFB 985/2009) para prestadores de serviços médicos/saúde. Por paciente: CPF, valor por tipo (consulta/exame/internação/plano). Prazo: fevereiro. Valida dedução IRPF dos pacientes.` },
  { slug: "folha-pagamento-mensal", name: "Folha de Pagamento Mensal", module: "Departamento Pessoal", pack: "contabilidade", category: "Especializado", biWidget: "bar_chart", biMetricIds: ["contabil.custo_folha_mensal","contabil.custo_folha_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","search_brain","get_client_data"], contextModules: [], systemPrompt: `Processa folha completa: holerites individuais, encargos patronais (INSS+RAT+FGTS), GPS, GFIP, DCTFWeb, S-1200. Consolida custo total e provisões (férias 8,33% + 13º 8,33%). Lançamentos contábeis.` },
  { slug: "plano-contas-cpc", name: "Plano de Contas CPC", module: "Contabilidade", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Estrutura plano de contas conforme CPC 26 e ITG 1000. Mapeia ao referencial analítico da RFB para SPED/ECD. Entrega CSV com código, nome, natureza (D/C), grupo CPC.` },
  { slug: "lancamentos-contabeis-padrao", name: "Lançamentos Contábeis Padrão", module: "Contabilidade", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Lançamentos pelo método das partidas dobradas (NBC TG). Identifica D/C para operações comuns: venda, compra, folha, impostos, depreciação. Valida débitos = créditos. Classifica por competência.` },
  { slug: "conciliacao-cartoes", name: "Conciliação Cartões", module: "Financeiro", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Conciliação de recebimentos via cartão (Cielo, Rede, Stone). Cruza por NSU: valor bruto, MDR, antecipação. Valida prazo de recebimento por bandeira. Identifica chargebacks e cancelamentos.` },
  { slug: "conciliacao-fornecedores", name: "Conciliação Fornecedores", module: "Financeiro", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Concilia razão de fornecedores × extrato do fornecedor × NF de entrada. Identifica NF não lançada, pagamento sem baixa, duplicidade. Calcula saldo devedor, vencimentos e créditos tributários.` },
  { slug: "conciliacao-clientes", name: "Conciliação Clientes", module: "Financeiro", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: ["atlas.inadimplencia_valor"], visibleIn: ["all"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Concilia contas a receber. Aging list (0-30d/31-60d/61-90d/>90d). Calcula inadimplência %. Para >60d: provisão PDD (NBC TG 01). Entrega aging + PDD calculada.` },
  { slug: "fechamento-mensal", name: "Fechamento Mensal", module: "Contabilidade", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.receita_por_periodo","contabil.resultado_liquido_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","search_brain","get_client_data"], contextModules: [], systemPrompt: `Checklist de fechamento mensal: NFs lançadas, folha processada, depreciação calculada, impostos conferidos, conciliação bancária, provisões atualizadas, estoque. Gera balancete de verificação e DRE parcial.` },
  { slug: "balancete-analise", name: "Balancete — Análise", module: "Contabilidade", pack: "contabilidade", category: "Especializado", biWidget: "waterfall_chart", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.receita_por_periodo","contabil.comparativo_trimestral"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","compare_periods","search_brain","get_client_data"], contextModules: [], systemPrompt: `Analisa balancete contábil: variações por conta vs período anterior, anomalias de saldo, contas inativas. Calcula indicadores (liquidez corrente, endividamento, margem). Compara com benchmark setorial.` },
  { slug: "ativo-imobilizado-depreciacao", name: "Ativo Imobilizado / Depreciação", module: "Contabilidade", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Gestão de imobilizado e intangível (CPC 27, CPC 04). Calcula depreciação linear por taxa fiscal (veículos 20%, TI 20%, máquinas 10%, edificações 4%). Identifica bens totalmente depreciados em uso.` },
  { slug: "analise-tributaria-regime", name: "Análise de Regime Tributário", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "bar_chart", biMetricIds: ["atlas.receita_por_periodo","contabil.resultado_liquido_mensal","contabil.carga_tributaria_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","compare_periods","search_brain","get_client_data"], contextModules: [], systemPrompt: `Planejamento tributário: simula SN/LP/LR para a mesma empresa. Compara cargas via run_bi_query. Considera obrigações acessórias. Recomenda regime ótimo com memória de cálculo e prazo de opção.` },
  { slug: "recuperacao-creditos-pis-cofins", name: "Recuperação Créditos PIS/COFINS", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Identifica créditos PIS/COFINS não aproveitados nos últimos 5 anos. Verifica jurisprudência (RE 841.979/STF sobre insumos). Calcula crédito + Selic. Orienta PER/DCOMP e avalia risco de autuação.` },
  { slug: "revisao-fiscal-cruzamento-sped", name: "Revisão Fiscal / SPED", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "data_table", biMetricIds: [], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Cruzamento de obrigações SPED: EFD-ICMS × EFD-Contribuições × ECF × ECD × NF-e. Identifica inconsistências de base, NF sem SPED, crédito sem entrada. Classifica risco: autuação/inconsistência/ajuste.` },
  { slug: "malha-fina-pf-diagnostico", name: "Malha Fina PF", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Diagnóstico de IRPF retido em malha: identifica pendência (omissão de rendimentos, deduções acima do limite, divergência com DIRF). Prepara retificadora ou resposta à intimação. Calcula imposto + multa + Selic.` },
  { slug: "malha-fina-pj-diagnostico", name: "Malha Fina PJ", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "data_table", biMetricIds: ["contabil.carga_tributaria_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Diagnóstico de risco de fiscalização PJ: variação de receita anormal, margem abaixo do setor, dedução fora do padrão, créditos PIS/COFINS anormais. Simula visão do auditor. Prioriza por valor em risco.` },
  { slug: "due-diligence-contabil", name: "Due Diligence Contábil", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "data_table", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.receita_por_periodo","atlas.inadimplencia_valor","contabil.resultado_liquido_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","search_brain","get_client_data"], contextModules: [], systemPrompt: `Due diligence contábil para M&A. Análise histórica de DRE/BP 3 anos. Qualidade do resultado (recorrente vs não-recorrente, EBITDA normalizado). Contingências passivas. Capital de giro. Entrega QoE e semáforo de riscos.` },
  { slug: "valuation-pme", name: "Valuation PME", module: "Consultoria", pack: "contabilidade", category: "Análise Estratégica", biWidget: "waterfall_chart", biMetricIds: ["contabil.resultado_liquido_mensal","atlas.receita_por_periodo","custos.margem_bruta_total","contabil.resultado_liquido_mensal"], visibleIn: ["all","reports"], tools: ["run_bi_query","list_bi_metrics","compare_periods","search_brain","get_client_data"], contextModules: [], systemPrompt: `Valuation de PME (Damodaran/múltiplos setoriais). Calcula 3 metodologias: múltiplos de EBITDA, lucros descontados (LLD/WACC), PL ajustado. Reconcilia valores. Entrega laudo com faixa otimista-base-pessimista.` },
  { slug: "irpf-declaracao-completa", name: "IRPF — Declaração Completa", module: "Tributário", pack: "contabilidade", category: "Especializado", biWidget: "kpi_card", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `IRPF completo (Lei 7.713/88, RIR/2018). Coleta rendimentos, deduções, bens, dívidas. Compara modelo completo × simplificado. Calcula base tributável, imposto e restituição/saldo devedor.` },
  { slug: "abertura-empresa-cnpj", name: "Abertura de Empresa / CNPJ", module: "Societário", pack: "contabilidade", category: "Societário", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Abertura de empresas via REDESIM. Define tipo societário, CNAEs, capital social, regime tributário inicial. Checklist de documentos. Cronograma: Junta Comercial → CNPJ → Alvará → IE/IM.` },
  { slug: "alteracao-contratual", name: "Alteração Contratual", module: "Societário", pack: "contabilidade", category: "Societário", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Alterações societárias (Código Civil, DREI). Prepara minuta consolidada. Checklist: ata, registro na Junta, atualização CNPJ/Alvará/IE. Identifica impactos tributários da mudança de CNAE.` },
  { slug: "encerramento-empresa-baixa", name: "Encerramento / Baixa", module: "Societário", pack: "contabilidade", category: "Societário", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Baixa de empresa (IN RFB 2.119/2022, Código Civil). Checklist: quitação de débitos (CND federal/estadual/municipal, CRF, CNDT), últimas declarações, balanço de encerramento, ata de dissolução.` },
  { slug: "parcelamento-receita-federal", name: "Parcelamento Receita Federal", module: "Consultoria", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Parcelamento de débitos tributários federais (Lei 10.522/2002, PERT). Simula modalidades: 60 prestações × programas especiais. Calcula entrada mínima, redução de multa/juros, parcela mensal vs fluxo de caixa.` },
  { slug: "resposta-fiscalizacao-intimacao", name: "Resposta a Fiscalização", module: "Consultoria", pack: "contabilidade", category: "Especializado", biWidget: "data_table", biMetricIds: [], visibleIn: ["all"], tools: ["search_brain","get_client_data"], contextModules: [], systemPrompt: `Contencioso tributário (PAF, Decreto 70.235/72). Analisa intimação, identifica prazo e objeto. Para auto de infração: elabora impugnação com jurisprudência (CARF/STJ/STF). Para documentos: monta dossiê.` },
  { slug: "reforma-tributaria-cbs-ibs", name: "Reforma Tributária CBS/IBS", module: "Tributário", pack: "contabilidade", category: "Especializado", biWidget: "bar_chart", biMetricIds: ["contabil.carga_tributaria_mensal","atlas.receita_por_periodo"], visibleIn: ["all","reports"], tools: ["run_bi_query","search_brain","get_client_data"], contextModules: [], systemPrompt: `Reforma Tributária (EC 132/2023, PLP 68/2024). Explica transição 2026-2032. Simula impacto: carga atual (PIS/COFINS/ISS/ICMS) × CBS+IBS futura. Identifica cashback, listas reduzidas, regimes diferenciados.` },
];

function buildDescription(a: ContabilAgent): string {
  const tools = a.tools.length ? a.tools.join(", ") : "—";
  return `Agente Contábil · módulo: ${a.module} · categoria: ${a.category} · tools previstas: ${tools}`;
}

function arrEq(x: string[] | null | undefined, y: string[]): boolean {
  if (!Array.isArray(x)) return y.length === 0;
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

export async function seedContabilAgentsIfNeeded(): Promise<void> {
  // 1) Valida refs biMetricIds contra catálogo semântico — log warn p/ ids ausentes.
  const missing = new Set<string>();
  for (const a of CONTABIL_AGENTS) {
    for (const id of a.biMetricIds) {
      if (!getSemanticMetric(id)) missing.add(id);
    }
  }
  if (missing.size > 0) {
    console.warn(
      `[seed:contabil] aviso — ${missing.size} biMetricId(s) referenciados não existem no catálogo: ${Array.from(missing).sort().join(", ")}`,
    );
  }

  const inserted: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const a of CONTABIL_AGENTS) {
    const existing = await db
      .select()
      .from(agentDefinitions)
      .where(and(isNull(agentDefinitions.tenantId), eq(agentDefinitions.slug, a.slug)))
      .limit(1);

    const desc = buildDescription(a);

    if (existing.length === 0) {
      await db.insert(agentDefinitions).values({
        tenantId: null,
        name: a.name,
        slug: a.slug,
        description: desc,
        systemPrompt: a.systemPrompt,
        contextModules: a.contextModules,
        visibleIn: a.visibleIn,
        maxTokens: 4000,
        isActive: 1,
        createdBy: null,
        pack: a.pack,
        category: a.category,
        biWidget: a.biWidget,
        biMetricIds: a.biMetricIds,
      });
      inserted.push(a.slug);
      continue;
    }

    const cur = existing[0];
    const differs =
      (cur.systemPrompt || "") !== a.systemPrompt ||
      (cur.name || "") !== a.name ||
      (cur.description || "") !== desc ||
      (cur.pack || "") !== a.pack ||
      (cur.category || "") !== a.category ||
      (cur.biWidget || "") !== a.biWidget ||
      !arrEq(cur.visibleIn, a.visibleIn) ||
      !arrEq(cur.contextModules, a.contextModules) ||
      !arrEq(cur.biMetricIds, a.biMetricIds);

    if (differs) {
      await db
        .update(agentDefinitions)
        .set({
          name: a.name,
          description: desc,
          systemPrompt: a.systemPrompt,
          visibleIn: a.visibleIn,
          contextModules: a.contextModules,
          pack: a.pack,
          category: a.category,
          biWidget: a.biWidget,
          biMetricIds: a.biMetricIds,
          updatedAt: new Date(),
        })
        .where(eq(agentDefinitions.id, cur.id));
      updated.push(a.slug);
    } else {
      unchanged.push(a.slug);
    }
  }

  console.log(
    `[seed:contabil] inserted=${inserted.length} updated=${updated.length} unchanged=${unchanged.length} total=${CONTABIL_AGENTS.length}`,
  );
}
