import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SuperAgentChat } from "./SuperAgentChat";

export function SuperAgentEmbed({ projectId }: { projectId: string }) {
  return (
    <Card data-testid="card-super-agent-embed">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Super Agente — escopo deste projeto
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SuperAgentChat projectId={projectId} compact heightClass="h-96" />
      </CardContent>
    </Card>
  );
}
