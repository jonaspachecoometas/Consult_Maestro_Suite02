import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, ChevronLeft, Filter, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface AcaoPendente {
  id: string;
  descricao: string;
  responsavel: string | null;
  prazo: string | null;
  status: string;
  reuniaoId: string;
  reuniaoNumero: number;
  reuniaoData: string;
}

export default function AcoesReunioes() {
  const { id: projetoId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [filtroResp, setFiltroResp] = useState("");

  const { data: acoes = [], isLoading } = useQuery<AcaoPendente[]>({
    queryKey: ["/api/producao/projetos", projetoId, "acoes-pendentes"],
    enabled: !!projetoId,
  });

  const concluirMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("PUT", `/api/producao/acoes/${id}`, { status: "concluida" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", projetoId, "acoes-pendentes"] });
      toast({ title: "Ação concluída" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const filtradas = useMemo(() => {
    if (!filtroResp.trim()) return acoes;
    const q = filtroResp.trim().toLowerCase();
    return acoes.filter(a =>
      (a.responsavel || "").toLowerCase().includes(q) ||
      a.descricao.toLowerCase().includes(q),
    );
  }, [acoes, filtroResp]);

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-acoes-reunioes">
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link href={`/producao/projetos/${projetoId}/reunioes`}>
            <ChevronLeft className="h-4 w-4 mr-1" /> Voltar para reuniões
          </Link>
        </Button>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <CheckCircle2 className="h-7 w-7 text-primary" /> Ações Pendentes
        </h1>
        <p className="text-muted-foreground mt-1">Pendências das últimas 3 reuniões do projeto</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filtrar por responsável ou descrição..."
          className="pl-9"
          value={filtroResp}
          onChange={(e) => setFiltroResp(e.target.value)}
          data-testid="input-filtro-acoes"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtradas.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma ação pendente.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtradas.map((a) => {
            const isVencida = a.prazo && new Date(a.prazo) < new Date();
            return (
              <Card key={a.id} data-testid={`acao-pendente-${a.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{a.descricao}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                      <Link href={`/producao/reunioes/${a.reuniaoId}`} className="hover:underline">
                        <Badge variant="outline">Reunião #{String(a.reuniaoNumero).padStart(3, "0")}</Badge>
                      </Link>
                      {a.responsavel && <span>👤 {a.responsavel}</span>}
                      {a.prazo && (
                        <span className={isVencida ? "text-destructive font-medium" : ""}>
                          📅 {format(new Date(a.prazo), "dd/MM/yyyy", { locale: ptBR })}
                          {isVencida && " (vencida)"}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => concluirMutation.mutate(a.id)}
                    disabled={concluirMutation.isPending}
                    data-testid={`button-concluir-${a.id}`}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Concluir
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
