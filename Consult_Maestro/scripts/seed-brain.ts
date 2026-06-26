/**
 * Seed the global Knowledge Brain with curated content (categories + items).
 *
 * - All rows are global (tenant_id = NULL) so every tenant benefits.
 * - Idempotent: matches existing rows by (tenantId IS NULL, slug) for
 *   categories and (tenantId IS NULL, title) for items, so re-running won't
 *   duplicate.
 * - Embeddings are best-effort. If OPENAI_API_KEY is set and supports
 *   /embeddings, items get vectors. Otherwise the keyword fallback in
 *   searchKnowledge() takes over — no errors thrown.
 */
import { db } from "../server/db";
import { brainCategories, brainItems } from "../shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { generateEmbedding, isEmbeddingDisabled } from "../server/embeddingService";

type CatSeed = { slug: string; name: string; description: string; color: string };
type ItemSeed = {
  categorySlug: string;
  type: string;
  title: string;
  tags: string;
  content: string;
};

const CATEGORIES: CatSeed[] = [
  { slug: "metodologia-arcadia", name: "Metodologia Arcádia", description: "Princípios e fluxos do diagnóstico Arcádia.", color: "#6366f1" },
  { slug: "bmc-expandido", name: "Business Model Canvas Expandido", description: "Os 4 níveis evolutivos (Intenção, Evidência, Sistêmico, Transformação).", color: "#0ea5e9" },
  { slug: "pdca", name: "Ciclo PDCA", description: "Plan-Do-Check-Act aplicado a melhoria contínua.", color: "#10b981" },
  { slug: "swot", name: "Análise SWOT", description: "Forças, fraquezas, oportunidades e ameaças.", color: "#f59e0b" },
  { slug: "processos", name: "Mapeamento de Processos", description: "BPMN, AS-IS / TO-BE, indicadores.", color: "#a855f7" },
  { slug: "erp", name: "ERP & Aderência", description: "Avaliação de aderência funcional e gap analysis.", color: "#ef4444" },
  { slug: "licoes-aprendidas", name: "Lições Aprendidas", description: "Casos reais e armadilhas comuns.", color: "#64748b" },
];

const ITEMS: ItemSeed[] = [
  // ── Metodologia Arcádia ──────────────────────────────────────
  {
    categorySlug: "metodologia-arcadia",
    type: "metodologia",
    title: "Visão geral da Metodologia Arcádia",
    tags: "metodologia, diagnostico, fases, arcadia",
    content: `A Metodologia Arcádia organiza um diagnóstico empresarial em quatro fases evolutivas:

1. INTENÇÃO — Captura a estratégia declarada: missão, visão, objetivos e modelo de negócio pretendido. Use o Canvas em modo "Intenção" para registrar hipóteses.
2. EVIDÊNCIA — Coleta dados reais (entrevistas, indicadores, processos AS-IS) para confrontar a Intenção. Diferenças entre Intenção e Evidência viram pontos de SWOT.
3. SISTÊMICO — Conecta processos, pessoas e tecnologia. Identifica gargalos, retrabalhos e dependências entre áreas. Resulta em mapas de processos críticos e matriz de aderência ERP.
4. TRANSFORMAÇÃO — Plano de ação priorizado (PDCA) com responsáveis, prazos e KPIs. Define o roadmap de mudança.

Critérios de avanço: só passe para a próxima fase quando a anterior estiver com pelo menos 70% dos blocos preenchidos e validados pelo cliente.`,
  },
  {
    categorySlug: "metodologia-arcadia",
    type: "best_practice",
    title: "Como conduzir a primeira reunião de diagnóstico",
    tags: "kickoff, entrevista, diagnostico",
    content: `Roteiro recomendado (60–90 min):

1. Contextualização (10 min) — Apresentar a metodologia em uma página, alinhar expectativas e cronograma.
2. Cadeia de valor (15 min) — Pedir ao cliente que descreva o "fluxo principal" do negócio: do primeiro contato com o cliente final até a entrega/recebimento.
3. Dores percebidas (20 min) — Pergunta aberta: "se você pudesse resolver 3 problemas hoje, quais seriam?". Anotar literal.
4. Indicadores existentes (15 min) — Quais números a empresa olha hoje? Periodicidade? Confiança?
5. Tecnologia atual (10 min) — Sistemas em uso, integrações, satisfação por sistema (1–5).
6. Próximos passos (10 min) — Definir entrevistados, acessos e data da próxima reunião.

Saídas obrigatórias: Canvas-Intenção preenchido em pelo menos 5 de 9 blocos, lista de entrevistados, e calendário das próximas 2 reuniões.`,
  },

  // ── BMC Expandido ────────────────────────────────────────────
  {
    categorySlug: "bmc-expandido",
    type: "metodologia",
    title: "Os 9 blocos do Canvas Expandido",
    tags: "canvas, bmc, blocos",
    content: `O BMC Expandido da Arcádia mantém os 9 blocos clássicos de Osterwalder, mas cada bloco é preenchido em 4 níveis (Intenção → Evidência → Sistêmico → Transformação):

1. Segmentos de clientes — Para quem criamos valor?
2. Proposta de valor — Que problemas resolvemos? Que valor entregamos?
3. Canais — Como alcançamos e entregamos aos clientes?
4. Relacionamento com clientes — Que tipo de relação cada segmento espera?
5. Fontes de receita — Por qual valor o cliente está disposto a pagar?
6. Recursos-chave — Quais ativos físicos, humanos, intelectuais e financeiros são necessários?
7. Atividades-chave — O que precisamos fazer bem para entregar a proposta?
8. Parcerias-chave — Quem são fornecedores e parceiros estratégicos?
9. Estrutura de custos — Quais são os custos mais importantes?

Regra prática: marque um bloco como "completo" só quando os 4 níveis tiverem pelo menos uma frase declarativa, com dado/fato (não opinião) no nível Evidência.`,
  },
  {
    categorySlug: "bmc-expandido",
    type: "best_practice",
    title: "Quando o cliente não consegue preencher um bloco",
    tags: "canvas, facilitacao, bloqueio",
    content: `Sinal claro de que esse bloco é um ponto cego estratégico. Não force o preenchimento. Em vez disso:

- Marque o bloco como "Hipótese a validar" no nível Intenção.
- Adicione uma tarefa de pesquisa no plano (entrevista com cliente real, análise de dados internos, benchmark).
- Mova para Evidência só quando houver pelo menos 2 fontes independentes.

Blocos que mais costumam ficar vazios em PMEs brasileiras: Segmentos de clientes (a empresa "atende todo mundo") e Estrutura de custos (custos fixos confundidos com variáveis). Esses dois sozinhos explicam ~60% dos casos de margem corroída.`,
  },

  // ── PDCA ─────────────────────────────────────────────────────
  {
    categorySlug: "pdca",
    type: "metodologia",
    title: "PDCA aplicado ao diagnóstico Arcádia",
    tags: "pdca, melhoria-continua, plano-de-acao",
    content: `Cada item identificado no Canvas, SWOT, Processos ou ERP que demande ação vira um item PDCA:

PLAN — Definir o problema (1 frase), causa-raiz hipotética, meta mensurável, responsável, prazo. Use a regra dos 5 Porquês para chegar à causa.
DO — Executar o que foi planejado. Registrar o que foi efetivamente feito (pode divergir do plano). Anexar evidências.
CHECK — Comparar resultado vs meta. Quantificar (número, %). Se atingiu, padronizar (Act). Se não, voltar ao Plan.
ACT — Padronizar a melhoria (procedimento, treinamento, automação) OU registrar o aprendizado e replanejar.

Ciclo curto é melhor: prefira 5 PDCAs de 2 semanas a 1 PDCA de 10 semanas. Quanto menor o ciclo, mais rápido o aprendizado.`,
  },
  {
    categorySlug: "pdca",
    type: "template",
    title: "Template de item PDCA bem escrito",
    tags: "pdca, template, exemplo",
    content: `Exemplo correto:

PLAN
- Problema: Conversão de propostas em pedidos caiu de 38% para 22% no Q1.
- Causa-raiz hipótese: Tempo médio de resposta ao lead subiu de 4h para 28h após saída de 2 vendedores.
- Meta: Voltar a 35% de conversão até 30/06, com tempo médio de resposta ≤ 6h.
- Responsável: Mariana (Comercial).
- Prazo: 60 dias.

DO
- Contratado SDR temporário (15/04).
- Implementado SLA de resposta no CRM (20/04).
- Treinamento da equipe em qualificação (05/05).

CHECK
- Conversão em junho: 31% (meta era 35%).
- Tempo médio: 5h (meta era ≤ 6h, atingida).

ACT
- Padronizar SLA de 6h no playbook comercial.
- Próximo PDCA: investigar perda de conversão entre qualificação e fechamento (gap restante de 4 pp).`,
  },

  // ── SWOT ─────────────────────────────────────────────────────
  {
    categorySlug: "swot",
    type: "metodologia",
    title: "SWOT geral vs SWOT setorial",
    tags: "swot, analise, setorial",
    content: `SWOT GERAL — Visão consolidada da empresa toda. Use para o diagnóstico inicial e para reuniões de diretoria. Limite a 5 itens por quadrante (forças, fraquezas, oportunidades, ameaças) — mais que isso vira lista de afazeres.

SWOT SETORIAL — Uma matriz por área (Comercial, Operações, Financeiro, RH, TI...). Permite priorização local sem perder a visão sistêmica. É aqui que aparecem as fraquezas operacionais que viram processos AS-IS para mapear.

Regra de cruzamento (matriz TOWS):
- Forças × Oportunidades → estratégias OFENSIVAS (crescer, atacar).
- Forças × Ameaças → estratégias DEFENSIVAS (proteger).
- Fraquezas × Oportunidades → estratégias de MELHORIA (corrigir para aproveitar).
- Fraquezas × Ameaças → estratégias de SOBREVIVÊNCIA (evitar exposição).

Cada cruzamento que vira ação concreta deve abrir um item PDCA.`,
  },
  {
    categorySlug: "swot",
    type: "best_practice",
    title: "Como pontuar prioridade e impacto na SWOT",
    tags: "swot, priorizacao, scoring",
    content: `Use uma matriz simples 1–5 para cada item:

- IMPACTO: o quanto este item afeta o resultado se for trabalhado/ignorado (1 = marginal, 5 = vital).
- URGÊNCIA: janela de tempo (1 = pode esperar 12+ meses, 5 = perda iminente).
- FACILIDADE: quão tratável é hoje (1 = depende de mudanças estruturais, 5 = ação rápida).

Score = (Impacto × Urgência) + Facilidade. Range: 2 a 30.

Priorize para PDCA tudo com score ≥ 18. Itens 12–17 viram backlog. Abaixo de 12, registre e revise no próximo ciclo.

Cuidado clássico: equipes tendem a inflar Urgência. Ancore com pergunta objetiva: "se nada for feito, qual é a perda em R$ ou em clientes nos próximos 6 meses?"`,
  },

  // ── Processos ────────────────────────────────────────────────
  {
    categorySlug: "processos",
    type: "metodologia",
    title: "AS-IS vs TO-BE: quando documentar cada um",
    tags: "processos, as-is, to-be, bpmn",
    content: `AS-IS — Documente sempre que: (a) o processo será automatizado, (b) há retrabalho ou erro frequente, (c) há disputa entre áreas sobre responsabilidade, (d) é candidato a auditoria/compliance. NÃO documente AS-IS de processo que será descontinuado.

TO-BE — Só vale a pena depois de: (a) AS-IS validado por quem executa, (b) causas-raiz dos problemas mapeadas, (c) decisão clara sobre tecnologia/sistema que suportará o novo fluxo.

Notação recomendada: BPMN 2.0 simplificado — apenas tarefas, gateways exclusivos (XOR), eventos de início/fim e raias por papel. Ignore subprocessos colapsados na primeira versão. Cada processo deve caber em uma página A4 paisagem; se não couber, quebre em sub-processos.

Indicadores mínimos por processo: lead time, taxa de retrabalho, custo unitário, satisfação do cliente interno (1-5).`,
  },
  {
    categorySlug: "processos",
    type: "best_practice",
    title: "Sinais de que um processo precisa ser priorizado",
    tags: "processos, priorizacao, gargalos",
    content: `Priorize o redesenho de processos que apresentem ao menos 2 destes sintomas:

- Aparece em mais de uma SWOT setorial como fraqueza.
- Tem retrabalho > 15%.
- Lead time real > 3× o lead time prometido ao cliente.
- Depende de planilha/email para passar tarefa entre áreas.
- Tem mais de 2 gateways de aprovação manual.
- O gestor não sabe responder "quantas vezes esse processo rodou no último mês".

Processos com 4+ desses sintomas tipicamente geram ROI > 3x em projetos de automação ou redesenho.`,
  },

  // ── ERP ──────────────────────────────────────────────────────
  {
    categorySlug: "erp",
    type: "metodologia",
    title: "Avaliação de aderência funcional ERP",
    tags: "erp, aderencia, gap, requisitos",
    content: `Para cada requisito funcional, classifique a aderência do ERP candidato/atual em uma de 5 categorias:

- ATENDE TOTALMENTE — Funcionalidade nativa, sem customização.
- ATENDE PARCIALMENTE — Nativa, mas exige parametrização não-trivial.
- ATENDE COM CUSTOMIZAÇÃO — Possível via desenvolvimento contratado.
- ATENDE COM TERCEIRO — Exige sistema satélite + integração.
- NÃO ATENDE — Não há solução viável dentro do ERP.

Pesos típicos por criticidade: requisito CRÍTICO (peso 5), IMPORTANTE (3), DESEJÁVEL (1).

Score de aderência = Σ(peso × valor_aderência) / Σ(peso × 100). Valores de aderência: total=100, parcial=70, custom=40, terceiro=30, não atende=0.

Regra de bolso: ERP com aderência < 70% em requisitos CRÍTICOS NUNCA deve ser escolhido só por preço — o gap vira projeto.`,
  },
  {
    categorySlug: "erp",
    type: "licao_aprendida",
    title: "Cuidado com customizações ocultas",
    tags: "erp, customizacao, riscos",
    content: `Customizações são a principal causa de estouro de orçamento e atraso em projetos de ERP. Sinais de alerta durante a avaliação:

- Fornecedor diz "fazemos isso facilmente" sem mostrar tela funcionando.
- O requisito exige integração com sistema legado sem API documentada.
- A regra de negócio depende de cálculo específico do setor (fiscal, regulatório).
- O requisito é "relatório customizado" — em geral indica que o modelo de dados padrão não suporta a visão pedida.

Boa prática: cada requisito classificado como "atende com customização" deve ter estimativa de horas e prazo formalizada por escrito ANTES da assinatura do contrato. Se o fornecedor não consegue estimar, o risco é seu.`,
  },

  // ── Lições Aprendidas ────────────────────────────────────────
  {
    categorySlug: "licoes-aprendidas",
    type: "licao_aprendida",
    title: "PME que confunde faturamento com lucro",
    tags: "financeiro, lucro, pme, armadilha",
    content: `Padrão observado em ~40% dos diagnósticos em empresas com faturamento até R$ 20M/ano:

O dono acompanha faturamento mensal e saldo bancário, mas não tem DRE gerencial. Quando a margem aperta, o sintoma é "falta de caixa" — e a reação é tomar capital de giro caro, mascarando o problema real (margem baixa por mix errado de produtos, ou custo fixo elevado).

Diagnóstico recomendado: forçar a reconstrução da DRE dos últimos 12 meses por linha de produto/serviço. Quase sempre aparece um produto "âncora" que parece importante por volume mas tem margem negativa quando rateado o custo fixo.

Ação típica: descontinuar ou reprecificar o produto perdedor, redirecionar esforço comercial. Resultado típico em 90 dias: margem líquida sobe 3–7 pontos percentuais sem aumento de receita.`,
  },
  {
    categorySlug: "licoes-aprendidas",
    type: "licao_aprendida",
    title: "Diagnóstico que fica engavetado",
    tags: "implementacao, gestao-mudanca, falha",
    content: `Diagnósticos excelentes que viram PDF de gaveta têm padrões em comum:

1. Foram entregues como "produto final" em vez de iniciar um ciclo. Diagnóstico bom NUNCA é fim — é início de PDCAs.
2. Nenhum item tinha responsável NOMEADO da empresa-cliente (só "departamento" ou "diretoria").
3. Não houve definição de cadência de revisão (quinzenal/mensal) com o sponsor.
4. O sponsor era da TI ou do RH, não do CEO/sócio. Mudança estrutural sem patrocínio do topo morre.
5. Faltou conectar cada ação a um indicador que o sponsor já acompanha.

Antídoto: encerrar o diagnóstico com uma reunião de "kickoff de execução" — não de entrega. Deixar 5 PDCAs prontos para começar na próxima semana, com responsável e data da primeira revisão agendada.`,
  },
  {
    categorySlug: "licoes-aprendidas",
    type: "best_practice",
    title: "Como reportar progresso ao cliente sem perder o estratégico",
    tags: "comunicacao, reporting, cliente",
    content: `Estrutura de relatório quinzenal de 1 página recomendada:

1. SEMÁFORO (3 linhas): status geral do projeto (verde/amarelo/vermelho), principal conquista, principal risco.
2. PDCAS DA QUINZENA: lista com status (Plan/Do/Check/Act), responsável, próximo marco.
3. INDICADORES-CHAVE: 3 números que o sponsor escolheu acompanhar — valor atual, meta, tendência (seta).
4. DECISÕES PENDENTES: 1–3 perguntas objetivas para o sponsor responder na próxima reunião.
5. PRÓXIMOS PASSOS: 3 entregas com data.

Evite: anexos volumosos, jargão de consultoria, slides decorativos. Se cabe em uma página, é lido. Se não cabe, vira gaveta.`,
  },
];

async function upsertCategory(seed: CatSeed): Promise<string> {
  const existing = await db
    .select()
    .from(brainCategories)
    .where(and(isNull(brainCategories.tenantId), eq(brainCategories.slug, seed.slug)));
  if (existing.length > 0) {
    return existing[0].id;
  }
  const [row] = await db
    .insert(brainCategories)
    .values({
      tenantId: null,
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      color: seed.color,
    })
    .returning();
  return row.id;
}

async function upsertItem(seed: ItemSeed, categoryId: string): Promise<{ created: boolean; id: string }> {
  const existing = await db
    .select()
    .from(brainItems)
    .where(and(isNull(brainItems.tenantId), eq(brainItems.title, seed.title)));
  if (existing.length > 0) {
    return { created: false, id: existing[0].id };
  }
  const [row] = await db
    .insert(brainItems)
    .values({
      tenantId: null,
      categoryId,
      type: seed.type,
      title: seed.title,
      content: seed.content,
      tags: seed.tags,
    })
    .returning();
  return { created: true, id: row.id };
}

async function tryEmbed(id: string, text: string): Promise<boolean> {
  if (isEmbeddingDisabled()) return false;
  try {
    const emb = await generateEmbedding(text);
    await db
      .update(brainItems)
      .set({
        embedding: emb.vector as any,
        embeddingProvider: emb.provider,
        embeddingDim: emb.dim,
      })
      .where(eq(brainItems.id, id));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("[seed-brain] Starting global Knowledge Brain seed...");

  const slugToId = new Map<string, string>();
  for (const cat of CATEGORIES) {
    const id = await upsertCategory(cat);
    slugToId.set(cat.slug, id);
    console.log(`  category  ${cat.slug.padEnd(22)} -> ${id}`);
  }

  let createdCount = 0;
  let skippedCount = 0;
  let embeddedCount = 0;
  for (const item of ITEMS) {
    const catId = slugToId.get(item.categorySlug);
    if (!catId) {
      console.warn(`  skip item "${item.title}" — unknown category ${item.categorySlug}`);
      continue;
    }
    const { created, id } = await upsertItem(item, catId);
    if (created) createdCount++;
    else skippedCount++;
    const embedText = `${item.title}\n\n${item.content}\n\nTags: ${item.tags}`;
    const ok = await tryEmbed(id, embedText);
    if (ok) embeddedCount++;
    console.log(
      `  item ${created ? "NEW" : "old"}  ${ok ? "[embedded]" : "[keyword] "}  ${item.title.slice(0, 60)}`,
    );
  }

  console.log(
    `[seed-brain] Done. categories=${CATEGORIES.length}, items_new=${createdCount}, items_existing=${skippedCount}, embedded=${embeddedCount}/${ITEMS.length}`,
  );
  if (embeddedCount === 0) {
    console.log(
      "[seed-brain] NOTE: No embeddings generated. The system will use keyword fallback for search. " +
        "Set OPENAI_API_KEY (direct, not the proxy) and POST /api/brain/reindex to enable semantic search.",
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-brain] FAILED:", err);
  process.exit(1);
});
