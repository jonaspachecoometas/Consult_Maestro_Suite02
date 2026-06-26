/**
 * Task #47 — Task → Provider Cascade
 *
 * Define, para cada taskType conhecido, a ordem de tentativas de provider que
 * o orquestrador deve seguir. A cascata padrão é cloud-primário → cloud-secundário
 * → ollama local como último recurso. Tarefas sensíveis (sensitivity='secret')
 * forçam apenas Ollama. Tarefas marcadas data_sensitive priorizam Ollama acima
 * dos clouds.
 */
import type { AiProvider } from "../aiConfigService";

export type Sensitivity = "public" | "internal" | "data_sensitive" | "secret";

export interface CascadePolicy {
  /** Cascata padrão (sensitivity 'public' / 'internal'). Tier 1, 2, 3, ... */
  defaultChain: AiProvider[];
  /** Override quando sensitivity = 'data_sensitive': prepend ollama. */
  dataSensitiveChain?: AiProvider[];
  /** Override quando sensitivity = 'secret': APENAS ollama (nada vai para cloud). */
  secretChain?: AiProvider[];
  /**
   * Override declarativo de modelo por (taskType, provider). Quando presente,
   * o orquestrador usa este modelo em vez do default do tenant. Permite, por
   * exemplo, mapear `bi:sql_agent` para `claude-3-5-sonnet` (não o haiku) sem
   * mexer em config de tenant.
   */
  models?: Partial<Record<AiProvider, string>>;
}

const DEFAULT_CLOUD_CHAIN: AiProvider[] = ["anthropic", "gemini", "ollama"];
const CHEAP_CHAIN: AiProvider[] = ["gemini", "kimi", "ollama"]; // tarefas leves
const REASONING_CHAIN: AiProvider[] = ["anthropic", "gemini", "ollama"];
const CODING_CHAIN: AiProvider[] = ["anthropic", "kimi", "gemini", "ollama"];

/**
 * Mapa de taskType → política. taskTypes desconhecidos caem no DEFAULT_POLICY.
 * Mantemos a lista pequena e curada — agentService taskType strings já seguem
 * o padrão `agent:<name>` ou `<module>:<action>`.
 */
// Modelos default por provider para tarefas de raciocínio pesado vs leves.
// Mantemos centralizado aqui para que `models` seja apenas override quando
// faz diferença (ex.: BI SQL agent precisa de sonnet, não haiku).
// NOTA: nomes Anthropic alinhados com o Replit Modelfarm (Vertex AI), que só
// aceita os IDs versionados v4+ (claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001).
// Os aliases "*-latest" funcionam apenas no api.anthropic.com, NÃO no Modelfarm.
const REASONING_MODELS: Partial<Record<AiProvider, string>> = {
  anthropic: "claude-sonnet-4-5-20250929",
  gemini: "gemini-1.5-pro-latest",
  kimi: "moonshot-v1-32k",
  ollama: "llama3.1:8b",
};
const CHEAP_MODELS: Partial<Record<AiProvider, string>> = {
  anthropic: "claude-haiku-4-5-20251001",
  gemini: "gemini-1.5-flash-latest",
  kimi: "moonshot-v1-8k",
  ollama: "llama3.1:8b",
};
const CODING_MODELS: Partial<Record<AiProvider, string>> = {
  anthropic: "claude-sonnet-4-5-20250929",
  gemini: "gemini-1.5-pro-latest",
  kimi: "moonshot-v1-32k",
  ollama: "qwen2.5-coder:7b",
};

const POLICY: Record<string, CascadePolicy> = {
  // ─── Agentes do AGENT_REGISTRY ───
  "agent:diagnostic_canvas": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "agent:process_recommendation": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "agent:swot_analysis": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "agent:erp_gap_analysis": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "agent:generic": { defaultChain: DEFAULT_CLOUD_CHAIN, models: CHEAP_MODELS },

  // ─── Super agente / chat geral ───
  "super_agent": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },

  // ─── Módulo Societário (documentos do cliente: dados sensíveis) ───
  "societario:agent": { defaultChain: REASONING_CHAIN, dataSensitiveChain: ["ollama", "anthropic", "gemini"], models: REASONING_MODELS },
  "societario:pipeline": { defaultChain: DEFAULT_CLOUD_CHAIN, models: CHEAP_MODELS },

  // ─── Recovery (negociação com credores: confidencial) ───
  "recovery:agent": { defaultChain: REASONING_CHAIN, dataSensitiveChain: ["ollama", "anthropic", "gemini"], models: REASONING_MODELS },

  // ─── Control (financeiro do cliente: dados sensíveis) ───
  "control:fleuriet": { defaultChain: REASONING_CHAIN, dataSensitiveChain: ["ollama", "anthropic", "gemini"], models: REASONING_MODELS },
  "control:nfe_categorizacao": { defaultChain: CHEAP_CHAIN, models: CHEAP_MODELS },

  // ─── Dev Center pipeline ───
  "devcenter:architect": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "devcenter:developer": { defaultChain: CODING_CHAIN, models: CODING_MODELS },
  "devcenter:qa": { defaultChain: CODING_CHAIN, models: CODING_MODELS },
  "ide:pipeline": { defaultChain: CODING_CHAIN, models: CODING_MODELS },
  "module_planner:analyze": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },

  // ─── Prompt Engineering Studio ───
  // O usuário escolhe explicitamente o modelo no UI (override por tester),
  // mas mantemos cascata p/ auditoria + fallback de provider.
  "prompt_studio:test": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "prompt_studio:optimize": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },

  // ─── Produção / Scrum ───
  "scrum:plan_from_doc": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },
  "scrum:task_chat": { defaultChain: DEFAULT_CLOUD_CHAIN, models: CHEAP_MODELS },

  // ─── Super Agent: tool-loop é Anthropic-SDK-específico (tools API) ───
  // Cascata reduzida a anthropic-only: se anthropic estiver down, o super
  // agente fica indisponível (correto — não dá pra rodar tools no Gemini).
  // Mantemos no orquestrador apenas para AUDITORIA (llm_decisions).
  "super_agent:tools": { defaultChain: ["anthropic"], models: REASONING_MODELS },

  // ─── Societário: gerar minutas (texto puro) ───
  "societario:gerar_minuta": { defaultChain: REASONING_CHAIN, dataSensitiveChain: ["ollama", "anthropic"], models: REASONING_MODELS },
  // OCR de PDF/imagem: usa Claude PDF beta + vision; outros providers não
  // suportam o mesmo formato. Anthropic-only (auditado).
  "societario:ocr": { defaultChain: ["anthropic"], models: { anthropic: "claude-sonnet-4-5-20250929" } },

  // ─── BI ───
  "bi:sql_agent": { defaultChain: CODING_CHAIN, models: CODING_MODELS },
  "bi:dashboard_generator": { defaultChain: REASONING_CHAIN, models: REASONING_MODELS },

  // ─── Embeddings (tratado fora do orquestrador hoje, mas mapeado para futuro) ───
  "embedding": { defaultChain: ["gemini", "ollama"] },
};

const DEFAULT_POLICY: CascadePolicy = { defaultChain: DEFAULT_CLOUD_CHAIN };

/** Resolve a cascata para um par (taskType, sensitivity). */
export function getCascade(taskType: string, sensitivity: Sensitivity = "internal"): AiProvider[] {
  const pol = POLICY[taskType] ?? DEFAULT_POLICY;
  if (sensitivity === "secret") return pol.secretChain ?? ["ollama"];
  // data_sensitive é estrito como `secret`: NUNCA cai para cloud, mesmo se
  // Ollama falhar. Auditor (architect Task #47) apontou risco de vazamento
  // de PII se permitirmos fallback para cloud em prompts marcados como
  // sensíveis. Política: dados sensíveis ficam locais ou não rodam.
  if (sensitivity === "data_sensitive") return ["ollama"];
  return pol.defaultChain;
}

/**
 * Resolve o modelo declarado para (taskType, provider). Retorna null quando
 * a política não fixa um modelo, deixando o caller usar o default do tenant.
 */
export function getDeclaredModel(taskType: string, provider: AiProvider): string | null {
  const pol = POLICY[taskType];
  return pol?.models?.[provider] ?? null;
}

/** Lista todos os taskTypes registrados (usado pelo dashboard admin). */
export function listKnownTaskTypes(): string[] {
  return Object.keys(POLICY).sort();
}
