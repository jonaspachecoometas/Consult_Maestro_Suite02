// Catálogo de modelos Claude disponíveis para o pipeline do Dev Center.
// Cada fase (Architect/Developer/QA) pode usar um modelo diferente, configurado
// pelo tenant em "Configurações avançadas". Ver Sprint 3C do plano mestre.

export interface IdeModelOption {
  id: string;          // valor enviado à API Anthropic
  label: string;       // exibido na UI (PT-BR)
  tier: "opus" | "sonnet" | "haiku";
  description: string; // dica curta
  recommendedFor: Array<"architect" | "developer" | "qa">;
}

export const IDE_MODEL_CATALOG: IdeModelOption[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    tier: "opus",
    description: "Raciocínio profundo. Melhor para arquitetura complexa.",
    recommendedFor: ["architect"],
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6 (padrão)",
    tier: "sonnet",
    description: "Equilíbrio entre custo, qualidade e velocidade.",
    recommendedFor: ["architect", "developer", "qa"],
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    tier: "haiku",
    description: "Rápido e econômico. Ideal para QA e correções pontuais.",
    recommendedFor: ["qa"],
  },
];

const ALLOWED = new Set(IDE_MODEL_CATALOG.map((m) => m.id));

export function isAllowedModel(model: string | null | undefined): boolean {
  if (!model) return false;
  return ALLOWED.has(model);
}

export function getDefaultModelForPhase(phase: "architect" | "developer" | "qa"): string {
  // Default conservador: Sonnet em todas as fases (mesma escolha do agentService).
  return "claude-sonnet-4-5";
}
