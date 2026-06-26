import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Cpu, Building2 } from "lucide-react";

type Source = "tenant" | "platform" | string | null | undefined;
type Provider = "anthropic" | "gemini" | "kimi" | "ollama" | string | null | undefined;

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  kimi: "Kimi",
  ollama: "Ollama",
};

interface Props {
  source?: Source;
  provider?: Provider;
  model?: string | null;
  className?: string;
}

export function LlmSourceBadge({ source, provider, model, className }: Props) {
  if (!source && !provider) return null;

  const isTenant = source === "tenant";
  const providerLabel = provider ? (PROVIDER_LABELS[provider] ?? provider) : null;
  const shortModel = model?.replace(/^claude-/, "").replace(/-\d{8}$/, "") ?? null;

  const label = isTenant ? "Sua LLM" : "LLM Arcádia";
  const tooltip = isTenant
    ? `Usando sua chave de API (${providerLabel ?? "?"})`
    : `Usando o pool da plataforma Arcádia (${providerLabel ?? "?"}) — tokens contabilizados na plataforma`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-[10px] h-5 gap-1 cursor-default select-none ${
            isTenant ? "border-green-500/40 text-green-700" : "border-amber-500/40 text-amber-700"
          } ${className ?? ""}`}
          data-testid={`badge-llm-source-${isTenant ? "tenant" : "platform"}`}
        >
          {isTenant ? <Building2 className="h-2.5 w-2.5" /> : <Cpu className="h-2.5 w-2.5" />}
          {label}
          {providerLabel && <span className="opacity-70">· {shortModel ?? providerLabel}</span>}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs max-w-[240px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
