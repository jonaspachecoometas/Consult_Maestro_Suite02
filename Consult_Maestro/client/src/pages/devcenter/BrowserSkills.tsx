import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Archive, Code2, Loader2, Play } from "lucide-react";
import type { BrowserSkill } from "@shared/schema";

export default function BrowserSkills() {
  const { toast } = useToast();
  const [stepsOf, setStepsOf] = useState<BrowserSkill | null>(null);

  const { data: skills = [], isLoading } = useQuery<BrowserSkill[]>({
    queryKey: ["/api/browser/skills"],
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/browser/skills/${id}/archive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/browser/skills"] });
      toast({ title: "Skill arquivada" });
    },
    onError: (e: any) => toast({ title: "Falha ao arquivar", description: e?.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/browser/skills/${id}/test`),
    onSuccess: async (res: Response) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/browser/skills"] });
      toast({
        title: data?.ok ? "Skill executada com sucesso" : "Skill falhou",
        description: `${data?.steps?.length ?? 0} passo(s) executado(s)`,
        variant: data?.ok ? "default" : "destructive",
      });
    },
    onError: (e: any) => toast({ title: "Falha ao testar", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full p-4 gap-4" data-testid="page-browser-skills">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-title">Browser Skills</h1>
        <p className="text-sm text-muted-foreground">
          Sequências de ações de browser reutilizáveis, salvas pelos agentes e executáveis
          manualmente ou por agendamento.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skills salvas</CardTitle>
          <CardDescription>{skills.length} skill(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center" data-testid="text-empty">
              Nenhuma skill ainda. O agente cria skills com a ferramenta browser_save_skill ao
              concluir uma tarefa com sucesso.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Sistema alvo</TableHead>
                  <TableHead className="text-right">Usos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((s) => (
                  <TableRow key={s.id} data-testid={`row-skill-${s.id}`}>
                    <TableCell>
                      <div className="font-medium" data-testid={`text-skill-name-${s.id}`}>{s.title}</div>
                      <div className="text-xs text-muted-foreground">{s.name}</div>
                    </TableCell>
                    <TableCell className="text-sm">{s.systemSlug || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums" data-testid={`text-skill-uses-${s.id}`}>
                      {s.useCount ?? 0}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"}>
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStepsOf(s)}
                          data-testid={`button-steps-${s.id}`}
                        >
                          <Code2 className="h-4 w-4 mr-1" /> Ver passos
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={testMut.isPending}
                          onClick={() => testMut.mutate(s.id)}
                          data-testid={`button-test-${s.id}`}
                        >
                          {testMut.isPending && testMut.variables === s.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4 mr-1" />
                          )}
                          Testar agora
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={s.status !== "active" || archiveMut.isPending}
                          onClick={() => archiveMut.mutate(s.id)}
                          data-testid={`button-archive-${s.id}`}
                        >
                          <Archive className="h-4 w-4 mr-1" /> Arquivar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!stepsOf} onOpenChange={(o) => !o && setStepsOf(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{stepsOf?.title}</DialogTitle>
            <DialogDescription>{stepsOf?.description || "Passos da skill"}</DialogDescription>
          </DialogHeader>
          <pre
            className="text-xs bg-muted rounded-md p-4 overflow-auto max-h-[60vh]"
            data-testid="text-steps-json"
          >
            {JSON.stringify(stepsOf?.steps ?? [], null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
