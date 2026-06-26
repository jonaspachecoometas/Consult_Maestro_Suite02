import { useQuery } from "@tanstack/react-query";

export interface AgentDefinitionRow {
  id: string;
  tenantId: string | null;
  parentDefinitionId: string | null;
  name: string;
  description: string | null;
  slug: string;
  systemPrompt: string;
  contextModules: string[] | null;
  visibleIn: string[] | null;
  maxTokens: number;
  isActive: number;
  createdBy: string | null;
  allowedTools?: string[] | null;
  linkedCredentialIds?: string[] | null;
  enabledSkillNames?: string[] | null;
  llmModelOverride?: string | null;
  requiredApprovals?: string[] | null;
  allowedRoles?: string[] | null;
  automationTriggers?: Array<{ id?: string; label: string; cron: string; skillName: string; active: boolean }> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefinitionVersionRow {
  id: string;
  agentDefinitionId: string;
  versionNumber: number;
  snapshot: AgentDefinitionRow;
  changeNote: string | null;
  changedBy: string | null;
  changedAt: string;
}

/**
 * Lists agent definitions visible in a given screen.
 * Pass `visibleIn` (e.g. "canvas", "pdca") to filter; omit to get all.
 */
export function useAgentDefinitions(visibleIn?: string) {
  return useQuery<AgentDefinitionRow[]>({
    queryKey: ["/api/agent-definitions", visibleIn ?? "__all__"],
    queryFn: async () => {
      const res = await fetch("/api/agent-definitions", { credentials: "include" });
      if (!res.ok) return [];
      const all = (await res.json()) as AgentDefinitionRow[];
      if (!visibleIn) return all.filter((a) => a.isActive === 1);
      return all.filter(
        (a) =>
          a.isActive === 1 &&
          (a.visibleIn?.includes("all") || a.visibleIn?.includes(visibleIn)),
      );
    },
  });
}
