import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar, Plus, FileText, Download, Sparkles, ChevronLeft,
  CheckCircle2, Clock, XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

const TIPOS = [
  { value: "kickoff", label: "Kickoff" },
  { value: "acompanhamento", label: "Acompanhamento" },
  { value: "sprint_review", label: "Sprint Review" },
  { value: "retrospectiva", label: "Retrospectiva" },
  { value: "golive", label: "Go-Live" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  agendada: { label: "Agendada", variant: "default", icon: Clock },
  realizada: { label: "Realizada", variant: "secondary", icon: CheckCircle2 },
  cancelada: { label: "Cancelada", variant: "destructive", icon: XCircle },
};

interface ReuniaoLista {
  id: string;
  numero: number;
  data: string;
  tipo: string;
  sprint: string | null;
  status: string;
  ataDocUrl: string | null;
  numAcoes: number;
}

export default function HistoricoReunioes() {
  const { id: projetoId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [novaData, setNovaData] = useState(() => {
    const d = new Date(); d.setHours(10, 0, 0, 0);
    return format(d, "yyyy-MM-dd'T'HH:mm");
  });
  const [novoTipo, setNovoTipo] = useState("acompanhamento");
  const [novaSprint, setNovaSprint] = useState("");
  const [generatingAtaId, setGeneratingAtaId] = useState<string | null>(null);
  const [generatingPautaId, setGeneratingPautaId] = useState<string | null>(null);

  const { data: reunioes = [], isLoading } = useQuery<ReuniaoLista[]>({
    queryKey: ["/api/producao/projetos", projetoId, "reunioes"],
    enabled: !!projetoId,
  });

  const criarMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/producao/projetos/${projetoId}/reunioes`, {
        data: new Date(novaData).toISOString(),
        tipo: novoTipo,
        sprint: novaSprint || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", projetoId, "reunioes"] });
      toast({ title: "Reunião criada" });
      setDialogOpen(false);
      setNovaSprint("");
    },
    onError: (e: any) => toast({ title: "Erro ao criar reunião", description: e.message, variant: "destructive" }),
  });

  const gerarPautaMutation = useMutation({
    mutationFn: async (reuniaoId: string) => {
      setGeneratingPautaId(reuniaoId);
      return apiRequest("POST", `/api/producao/reunioes/${reuniaoId}/gerar-pauta`, {});
    },
    onSuccess: (_, reuniaoId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", projetoId, "reunioes"] });
      toast({ title: "Pauta gerada", description: "Abra a reunião para revisar." });
      setGeneratingPautaId(null);
      navigate(`/producao/reunioes/${reuniaoId}`);
    },
    onError: (e: any) => {
      setGeneratingPautaId(null);
      toast({ title: "Erro ao gerar pauta", description: e.message, variant: "destructive" });
    },
  });

  const gerarAtaMutation = useMutation({
    mutationFn: async (reuniaoId: string) => {
      setGeneratingAtaId(reuniaoId);
      return apiRequest("POST", `/api/producao/reunioes/${reuniaoId}/gerar-ata`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", projetoId, "reunioes"] });
      toast({ title: "Ata gerada", description: "Faça o download para revisar." });
      setGeneratingAtaId(null);
    },
    onError: (e: any) => {
      setGeneratingAtaId(null);
      toast({ title: "Erro ao gerar ata", description: e.message, variant: "destructive" });
    },
  });

  const handleDownloadAta = async (reuniaoId: string) => {
    try {
      const res = await fetch(`/api/producao/reunioes/${reuniaoId}/ata/download`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ata_reuniao.docx`; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Erro no download", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-historico-reunioes">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2" data-testid="link-voltar-projetos">
            <Link href="/producao/projetos"><ChevronLeft className="h-4 w-4 mr-1" />Voltar para projetos</Link>
          </Button>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Calendar className="h-7 w-7 text-primary" /> Reuniões do Projeto
          </h1>
          <p className="text-muted-foreground mt-1">Pautas, atas e ações decorrentes</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" data-testid="link-acoes-pendentes">
            <Link href={`/producao/projetos/${projetoId}/acoes`}>
              <CheckCircle2 className="h-4 w-4 mr-2" /> Ações pendentes
            </Link>
          </Button>
          <Button onClick={() => setDialogOpen(true)} data-testid="button-nova-reuniao">
            <Plus className="h-4 w-4 mr-2" /> Nova reunião
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : reunioes.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma reunião agendada ainda. Clique em "Nova reunião" para começar.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {reunioes.map((r) => {
            const cfg = statusConfig[r.status] || statusConfig.agendada;
            const Icon = cfg.icon;
            const tipoLabel = TIPOS.find(t => t.value === r.tipo)?.label || r.tipo;
            return (
              <Card key={r.id} data-testid={`card-reuniao-${r.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={cfg.variant} className="gap-1"><Icon className="h-3 w-3" />{cfg.label}</Badge>
                      <Badge variant="outline">{tipoLabel}</Badge>
                      {r.sprint && <Badge variant="outline" className="text-xs">{r.sprint}</Badge>}
                      {r.numAcoes > 0 && <Badge variant="secondary">{r.numAcoes} ações</Badge>}
                    </div>
                    <Link href={`/producao/reunioes/${r.id}`} className="font-medium hover:underline" data-testid={`link-reuniao-${r.id}`}>
                      Reunião #{String(r.numero).padStart(3, "0")} — {format(new Date(r.data), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
                    </Link>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    {r.status === "agendada" && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => gerarPautaMutation.mutate(r.id)}
                        disabled={generatingPautaId === r.id}
                        data-testid={`button-gerar-pauta-${r.id}`}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        {generatingPautaId === r.id ? "Gerando..." : "Gerar Pauta"}
                      </Button>
                    )}
                    {r.status === "realizada" && !r.ataDocUrl && (
                      <Button
                        size="sm" variant="outline"
                        onClick={() => gerarAtaMutation.mutate(r.id)}
                        disabled={generatingAtaId === r.id}
                        data-testid={`button-gerar-ata-${r.id}`}
                      >
                        <FileText className="h-4 w-4 mr-1" />
                        {generatingAtaId === r.id ? "Gerando..." : "Gerar Ata"}
                      </Button>
                    )}
                    {r.ataDocUrl && (
                      <Button size="sm" variant="outline" onClick={() => handleDownloadAta(r.id)} data-testid={`button-download-ata-${r.id}`}>
                        <Download className="h-4 w-4 mr-1" /> Baixar ata
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Reunião</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="data">Data e horário</Label>
              <Input id="data" type="datetime-local" value={novaData} onChange={(e) => setNovaData(e.target.value)} data-testid="input-reuniao-data" />
            </div>
            <div>
              <Label htmlFor="tipo">Tipo</Label>
              <Select value={novoTipo} onValueChange={setNovoTipo}>
                <SelectTrigger id="tipo" data-testid="select-reuniao-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="sprint">Sprint (opcional)</Label>
              <Input id="sprint" placeholder="Ex: Sprint 3 — Financeiro" value={novaSprint} onChange={(e) => setNovaSprint(e.target.value)} data-testid="input-reuniao-sprint" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => criarMutation.mutate()} disabled={criarMutation.isPending} data-testid="button-confirm-criar-reuniao">
              {criarMutation.isPending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
