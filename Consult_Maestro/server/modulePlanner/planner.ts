// Dev Center — Fase 2: Module Planner.
// Agente especializado que recebe descrição em PT do que o usuário quer
// construir + snapshot do código atual do Consult e devolve plano técnico
// estruturado (tabelas/endpoints/páginas/agentes/dependências/módulo similar).
//
// Task #48: usa runWithOrchestration (cascata anthropic→gemini→ollama via
// taskCascade `module_planner:analyze`). recordAiUsage + audit em
// llm_decisions agora ficam centralizados no orquestrador.

import { z } from "zod";
import { runWithOrchestration, callChatLLM } from "../agentService";
import { readConsultContext } from "../devCenter";

// ───────────────────────────────────────────────────────────────────────────
// Contrato JSON do plano (espelhado em modulePlans.planJson)
// ───────────────────────────────────────────────────────────────────────────
export const moduleTableColumnSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().min(1).max(80), // 'varchar', 'uuid', 'jsonb', 'integer', etc.
  notes: z.string().max(300).optional(),
});

export const moduleTableSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600),
  columns: z.array(moduleTableColumnSchema).min(1).max(40),
  relations: z.array(z.string().max(200)).max(20).optional(),
});

export const moduleEndpointSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1).max(200),
  description: z.string().max(400),
});

export const modulePageSchema = z.object({
  route: z.string().min(1).max(200),
  name: z.string().min(1).max(120),
  description: z.string().max(400),
});

export const moduleAgentSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(400),
  skills: z.array(z.string().max(120)).max(20),
});

export const moduleDependencySchema = z.object({
  module: z.string().min(1).max(80),
  reason: z.string().max(400),
});

export const modulePlanContractSchema = z.object({
  summary: z.string().min(1).max(2000),
  tables: z.array(moduleTableSchema).max(40),
  endpoints: z.array(moduleEndpointSchema).max(80),
  pages: z.array(modulePageSchema).max(40),
  agents: z.array(moduleAgentSchema).max(20),
  dependencies: z.array(moduleDependencySchema).max(40),
  similarModule: z
    .object({
      name: z.string().max(120),
      route: z.string().max(200),
      reason: z.string().max(400),
    })
    .nullable(),
});

export type ModulePlanContract = z.infer<typeof modulePlanContractSchema>;

// ───────────────────────────────────────────────────────────────────────────
// System prompt (PT-BR, JSON-only)
// ───────────────────────────────────────────────────────────────────────────
const PLANNER_SYSTEM = `<System>
Você é o **Planejador de Módulos do Arcádia Consult**.

Recebe (a) uma descrição em português do que o usuário quer construir e
(b) um snapshot do código atual do Arcádia (replit.md, shared/schema.ts,
server/routes.ts, client/src/App.tsx, etc.). Sua função é traduzir o
desejo em um **plano técnico estruturado** que outro agente (Arquiteto)
poderá transformar em código.

Você NÃO escreve código. Você descreve o que precisa ser construído com
nomes claros e descrições curtas, respeitando os padrões do Consult.
</System>

<Instructions>
1. Leia o contexto. Identifique módulos existentes que já cobrem parte do
   pedido. Se um módulo similar já existe, preencha \`similarModule\` com
   nome + rota + razão e mantenha o restante do plano enxuto (apenas o que
   precisa ser ESTENDIDO).
2. Liste tabelas novas com colunas principais. Toda tabela de negócio tem
   \`tenant_id varchar\`, \`id varchar primary key\` (uuid) e timestamps
   \`created_at\`/\`updated_at\` — você pode omitir essas colunas óbvias.
3. Liste endpoints REST sob \`/api/...\` com método + caminho + descrição
   de uma linha. Toda rota protegida usa \`isAuthenticated + tenantContext
   + requireTenant\` (assumido — não precisa repetir).
4. Liste páginas React com rota \`/...\` e propósito de uma linha.
5. Sugira agentes especializados QUANDO o módulo se beneficia (ex: agente
   que valida documentos, sugere decisões, gera relatórios). Se não
   couber, devolva array vazio.
6. Liste dependências com módulos existentes do Consult (Control, CRM,
   Societário, Recovery, Produção, Cadastro de Pessoas, etc.) — somente
   o que for realmente integrado.
</Instructions>

<Constraints>
- Não invente módulos que não existem no contexto.
- Não proponha alterações em \`shared/schema.ts\` direto — descreva a
  TABELA NOVA; o consultor revisa antes do Arquiteto codar.
- Use português (pt-BR) em todos os campos textuais.
- Nomes de tabela em snake_case; nomes de página em PascalCase.
- Rotas sob \`/api/<modulo>\` para endpoints e \`/<modulo>\` para páginas.
- Seja conservador: prefira reusar tabelas/endpoints existentes a criar novos.
</Constraints>

<Output>
RESPONDA APENAS COM JSON VÁLIDO. Sem markdown, sem texto antes/depois.
Schema:
{
  "summary": "Resumo executivo em 2-4 frases.",
  "tables": [
    {
      "name": "snake_case_nome",
      "description": "Para que serve.",
      "columns": [{ "name": "coluna", "type": "varchar|uuid|integer|jsonb|...", "notes": "opcional" }],
      "relations": ["FK para outra_tabela.coluna"] // opcional
    }
  ],
  "endpoints": [{ "method": "GET|POST|...", "path": "/api/...", "description": "..." }],
  "pages": [{ "route": "/...", "name": "PascalCase", "description": "..." }],
  "agents": [{ "name": "...", "role": "...", "skills": ["..."] }],
  "dependencies": [{ "module": "Control|CRM|Societário|...", "reason": "..." }],
  "similarModule": { "name": "...", "route": "/...", "reason": "..." } | null
}
</Output>`;

const MAX_TOKENS_PLANNER = 6000;
const MAX_CONTEXT_CHARS = 14000;

function buildPlannerUser(description: string, contextSnippet: string, title?: string | null): string {
  const ctx = contextSnippet.length > MAX_CONTEXT_CHARS
    ? contextSnippet.slice(0, MAX_CONTEXT_CHARS) + "\n... (truncado)"
    : contextSnippet;
  const titleLine = title?.trim() ? `**Título sugerido pelo usuário:** ${title.trim()}\n\n` : "";
  return `${titleLine}**Descrição (em PT, fornecida pelo usuário):**\n${description.trim()}\n\n---\n\n**Contexto do código atual do Arcádia Consult:**\n${ctx}\n\n---\n\nGere o plano técnico em JSON conforme o schema do <Output>.`;
}

function stripJsonFence(s: string): string {
  let t = (s || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first > 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

function safeReviver(key: string, value: any) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  return value;
}

export interface AnalyzeInput {
  description: string;
  title?: string | null;
  tenantId: string;
  userId?: string | null;
}

export interface AnalyzeOutput {
  plan: ModulePlanContract;
  source: "tenant" | "platform";
  model: string;
  tokensInput: number;
  tokensOutput: number;
}

/** Chama o Planner LLM e devolve um plano validado contra o contrato. */
export async function analyzeModule(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const desc = (input.description || "").trim();
  if (desc.length < 10) {
    throw new Error("Descrição muito curta (mínimo 10 caracteres).");
  }
  if (desc.length > 8000) {
    throw new Error("Descrição muito longa (máximo 8000 caracteres).");
  }

  const contextSnippet = await readConsultContext().catch((err) => {
    console.warn("[modulePlanner] readConsultContext falhou:", err?.message ?? err);
    return "Contexto indisponível.";
  });

  const system = PLANNER_SYSTEM;
  const user = buildPlannerUser(desc, contextSnippet, input.title ?? null);

  // Task #48 — orquestrador (REASONING_CHAIN). recordAiUsage agora é feito
  // dentro de runWithOrchestration; a auditoria fica em llm_decisions.
  const orch = await runWithOrchestration(
    "module_planner:analyze",
    input.tenantId,
    { sensitivity: "internal" },
    (cb) => callChatLLM(cb, { systemPrompt: system, userPrompt: user, maxTokens: MAX_TOKENS_PLANNER, signal: cb.signal }),
  );
  const text = orch.data;
  const model = orch.modelUsed;
  const tokensInput = orch.tokensIn;
  const tokensOutput = orch.tokensOut;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text), safeReviver);
  } catch (err: any) {
    throw new Error(`Resposta do agente não é JSON válido: ${err?.message ?? err}`);
  }

  const validation = modulePlanContractSchema.safeParse(parsed);
  if (!validation.success) {
    const detail = validation.error.errors.slice(0, 3).map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Plano fora do contrato: ${detail}`);
  }

  // Task #48 — `source` (tenant vs platform) não é mais exposto pelo
  // orquestrador (a decisão fica em llm_decisions). Mantemos a chave por
  // compatibilidade com callers, mas sempre preenchemos como "platform"
  // quando não temos a info — é informativo, não impacta cobrança.
  return {
    plan: validation.data,
    source: "platform",
    model,
    tokensInput,
    tokensOutput,
  };
}

/**
 * Serializa um plano aprovado em formato textual rico para alimentar o
 * Arquiteto da Fase 1 como `requirement` da pipeline run target='consult'.
 * O Arquiteto então traduz isso em design_doc + lista de arquivos.
 */
export function planToRequirement(title: string, plan: ModulePlanContract): string {
  const lines: string[] = [];
  lines.push(`# Plano técnico aprovado — ${title}`);
  lines.push("");
  lines.push("## Resumo");
  lines.push(plan.summary);
  lines.push("");

  if (plan.similarModule) {
    lines.push("## Módulo similar existente");
    lines.push(`- ${plan.similarModule.name} (${plan.similarModule.route}) — ${plan.similarModule.reason}`);
    lines.push("");
  }

  if (plan.tables.length > 0) {
    lines.push("## Tabelas (Drizzle / shared/schema.ts)");
    for (const t of plan.tables) {
      lines.push(`### \`${t.name}\``);
      lines.push(t.description);
      lines.push("Colunas:");
      for (const c of t.columns) {
        const notes = c.notes ? ` — ${c.notes}` : "";
        lines.push(`  - \`${c.name}\`: ${c.type}${notes}`);
      }
      if (t.relations && t.relations.length > 0) {
        lines.push("Relações:");
        for (const r of t.relations) lines.push(`  - ${r}`);
      }
      lines.push("");
    }
  }

  if (plan.endpoints.length > 0) {
    lines.push("## Endpoints REST");
    for (const e of plan.endpoints) {
      lines.push(`- \`${e.method} ${e.path}\` — ${e.description}`);
    }
    lines.push("");
  }

  if (plan.pages.length > 0) {
    lines.push("## Páginas React (client/src/pages)");
    for (const p of plan.pages) {
      lines.push(`- \`${p.route}\` — **${p.name}** — ${p.description}`);
    }
    lines.push("");
  }

  if (plan.agents.length > 0) {
    lines.push("## Agentes especializados");
    for (const a of plan.agents) {
      lines.push(`- **${a.name}** (${a.role})`);
      if (a.skills.length > 0) {
        lines.push(`  Skills: ${a.skills.map((s) => `\`${s}\``).join(", ")}`);
      }
    }
    lines.push("");
  }

  if (plan.dependencies.length > 0) {
    lines.push("## Dependências com módulos existentes");
    for (const d of plan.dependencies) {
      lines.push(`- **${d.module}** — ${d.reason}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("Gere o plano técnico de arquivos (design_doc) seguindo este escopo.");
  lines.push("Toda tabela inclui `tenant_id` + índice por tenant. Toda rota usa `isAuthenticated + tenantContext + requireTenant`. UI em pt-BR com `data-testid` em interativos. Mutations TanStack invalidam queries impactadas.");

  return lines.join("\n");
}
