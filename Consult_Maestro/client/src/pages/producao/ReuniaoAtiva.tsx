import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ChevronLeft, Save, Sparkles, FileText, Download, Plus, Trash2, Clock,
  CheckCircle2, XCircle, Play, Square, Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface PautaItem {
  titulo: string;
  descricao?: string;
  ordem?: number;
  tempoMin?: number;
}
interface Acao {
  id: string;
  descricao: string;
  responsavel: string | null;
  prazo: string | null;
  status: string;
}
interface ReuniaoDetalhe {
  reuniao: {
    id: string;
    projetoId: string;
    numero: number;
    data: string;
    tipo: string;
    sprint: string | null;
    pautaJson: PautaItem[] | null;
    anotacoes: string | null;
    ataDocUrl: string | null;
    participantes: Array<{ nome: string; papel?: string }> | null;
    status: string;
  };
  acoes: Acao[];
}

export default function ReuniaoAtiva() {
  const { id: reuniaoId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [anotacoes, setAnotacoes] = useState("");
  const [participantesText, setParticipantesText] = useState("");
  const [novaAcao, setNovaAcao] = useState({ descricao: "", responsavel: "", prazo: "" });
  const [activePautaIdx, setActivePautaIdx] = useState<number | null>(null);
  const [timerStart, setTimerStart] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const { data, isLoading } = useQuery<ReuniaoDetalhe>({
    queryKey: ["/api/producao/reunioes", reuniaoId],
    enabled: !!reuniaoId,
  });

  useEffect(() => {
    if (data?.reuniao) {
      setAnotacoes(data.reuniao.anotacoes || "");
      const ps = data.reuniao.participantes || [];
      setParticipantesText(ps.map(p => p.papel ? `${p.nome} (${p.papel})` : p.nome).join("\n"));
    }
  }, [data?.reuniao?.id]);

  useEffect(() => {
    if (timerStart === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timerStart]);

  const salvarMutation = useMutation({
    mutationFn: async (patch: any) => apiRequest("PUT", `/api/producao/reunioes/${reuniaoId}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/producao/projetos", data?.reuniao.projetoId, "reunioes"] });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const handleSalvar = () => {
    const participantes = participantesText.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
      const m = line.match(/^(.+?)\s*\((.+)\)$/);
      return m ? { nome: m[1].trim(), papel: m[2].trim() } : { nome: line };
    });
    salvarMutation.mutate({ anotacoes, participantes });
    toast({ title: "Salvo" });
  };

  const gerarPautaMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/producao/reunioes/${reuniaoId}/gerar-pauta`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      toast({ title: "Pauta gerada" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const gerarAtaMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/producao/reunioes/${reuniaoId}/gerar-ata`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      toast({ title: "Ata gerada", description: "Faça o download abaixo." });
    },
    onError: (e: any) => toast({ title: "Erro ao gerar ata", description: e.message, variant: "destructive" }),
  });

  const adicionarAcaoMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/producao/reunioes/${reuniaoId}/acoes`, {
      descricao: novaAcao.descricao,
      responsavel: novaAcao.responsavel || null,
      prazo: novaAcao.prazo ? new Date(novaAcao.prazo).toISOString() : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      setNovaAcao({ descricao: "", responsavel: "", prazo: "" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleAcaoMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      apiRequest("PUT", `/api/producao/acoes/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      if (data?.reuniao.projetoId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/producao/projetos", data.reuniao.projetoId, "acoes-pendentes"],
        });
      }
    },
  });

  const encerrarMutation = useMutation({
    mutationFn: async () => {
      const participantes = participantesText.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
        const m = line.match(/^(.+?)\s*\((.+)\)$/);
        return m ? { nome: m[1].trim(), papel: m[2].trim() } : { nome: line };
      });
      return apiRequest("PUT", `/api/producao/reunioes/${reuniaoId}`, { status: "realizada", anotacoes, participantes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/producao/reunioes", reuniaoId] });
      toast({ title: "Reunião encerrada", description: "Você já pode gerar a ata." });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const handleDownloadAta = async () => {
    try {
      const res = await fetch(`/api/producao/reunioes/${reuniaoId}/ata/download`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `ata.docx`; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Erro no download", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading || !data) {
    return <div className="container mx-auto p-6"><Skeleton className="h-12 w-1/2 mb-4" /><Skeleton className="h-64 w-full" /></div>;
  }
  const r = data.reuniao;
  const pauta = r.pautaJson || [];
  const isEncerrada = r.status === "realizada";
  const elapsedSec = timerStart ? Math.floor((now - timerStart) / 1000) : 0;
  const elapsedFmt = `${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(elapsedSec % 60).padStart(2, "0")}`;

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-reuniao-ativa">
      <div className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link href={`/producao/projetos/${r.projetoId}/reunioes`}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Voltar para reuniões
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            Reunião #{String(r.numero).padStart(3, "0")} — {r.tipo}
          </h1>
          <p className="text-muted-foreground">
            {format(new Date(r.data), "dd 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}
            {r.sprint && <> · {r.sprint}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={isEncerrada ? "secondary" : "default"} className="text-sm">
            {isEncerrada ? "Realizada" : "Em andamento"}
          </Badge>
          {!isEncerrada && (
            <Button onClick={() => encerrarMutation.mutate()} disabled={encerrarMutation.isPending} data-testid="button-encerrar-reuniao">
              <Square className="h-4 w-4 mr-2" /> Encerrar reunião
            </Button>
          )}
          {isEncerrada && !r.ataDocUrl && (
            <Button onClick={() => gerarAtaMutation.mutate()} disabled={gerarAtaMutation.isPending} data-testid="button-gerar-ata">
              <FileText className="h-4 w-4 mr-2" />
              {gerarAtaMutation.isPending ? "Gerando ata..." : "Gerar Ata"}
            </Button>
          )}
          {r.ataDocUrl && (
            <Button onClick={handleDownloadAta} variant="outline" data-testid="button-download-ata-detalhe">
              <Download className="h-4 w-4 mr-2" /> Baixar ata
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Pauta */}
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Pauta</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => gerarPautaMutation.mutate()} disabled={gerarPautaMutation.isPending} data-testid="button-regerar-pauta">
              <Sparkles className="h-4 w-4 mr-1" /> {pauta.length === 0 ? "Gerar" : "Regerar"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {pauta.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nenhuma pauta. Clique em Gerar.</p>
            ) : (
              pauta.map((item, i) => (
                <div
                  key={i}
                  className={`p-2 rounded border cursor-pointer transition ${activePautaIdx === i ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                  onClick={() => { setActivePautaIdx(i); setTimerStart(Date.now()); }}
                  data-testid={`pauta-item-${i}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm">{i + 1}. {item.titulo}</p>
                    {item.tempoMin && <Badge variant="outline" className="text-xs">{item.tempoMin} min</Badge>}
                  </div>
                  {item.descricao && <p className="text-xs text-muted-foreground mt-1">{item.descricao}</p>}
                  {activePautaIdx === i && timerStart && (
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <Clock className="h-3 w-3" />
                      <span className="font-mono">{elapsedFmt}</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setTimerStart(null); setActivePautaIdx(null); }}>
                        Parar
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Anotações + Participantes */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> Anotações e participantes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="participantes">Participantes (uma linha por pessoa, opcional: <code>Nome (Papel)</code>)</Label>
              <Textarea
                id="participantes"
                rows={3}
                value={participantesText}
                onChange={(e) => setParticipantesText(e.target.value)}
                placeholder="João Silva (Diretor)&#10;Maria Pinto (Analista)"
                disabled={isEncerrada}
                data-testid="textarea-participantes"
              />
            </div>
            <div>
              <Label htmlFor="anotacoes">Anotações da reunião</Label>
              <Textarea
                id="anotacoes"
                rows={10}
                value={anotacoes}
                onChange={(e) => setAnotacoes(e.target.value)}
                placeholder="Decisões, pontos discutidos, comentários..."
                disabled={isEncerrada}
                data-testid="textarea-anotacoes"
              />
            </div>
            {!isEncerrada && (
              <Button onClick={handleSalvar} disabled={salvarMutation.isPending} data-testid="button-salvar-anotacoes">
                <Save className="h-4 w-4 mr-2" /> {salvarMutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ações */}
      <Card>
        <CardHeader><CardTitle className="text-base">Ações decorrentes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!isEncerrada && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
              <div className="md:col-span-6">
                <Label htmlFor="acao-desc">Descrição</Label>
                <Input id="acao-desc" value={novaAcao.descricao} onChange={(e) => setNovaAcao({ ...novaAcao, descricao: e.target.value })} placeholder="O que precisa ser feito?" data-testid="input-acao-descricao" />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="acao-resp">Responsável</Label>
                <Input id="acao-resp" value={novaAcao.responsavel} onChange={(e) => setNovaAcao({ ...novaAcao, responsavel: e.target.value })} placeholder="Nome" data-testid="input-acao-responsavel" />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="acao-prazo">Prazo</Label>
                <Input id="acao-prazo" type="date" value={novaAcao.prazo} onChange={(e) => setNovaAcao({ ...novaAcao, prazo: e.target.value })} data-testid="input-acao-prazo" />
              </div>
              <div className="md:col-span-1">
                <Button onClick={() => adicionarAcaoMutation.mutate()} disabled={!novaAcao.descricao || adicionarAcaoMutation.isPending} className="w-full" data-testid="button-add-acao">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <Separator />
          {data.acoes.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nenhuma ação registrada.</p>
          ) : (
            <div className="space-y-2">
              {data.acoes.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 border rounded gap-3" data-testid={`acao-${a.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm ${a.status === "concluida" ? "line-through text-muted-foreground" : ""}`}>{a.descricao}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                      {a.responsavel && <span>👤 {a.responsavel}</span>}
                      {a.prazo && <span>📅 {format(new Date(a.prazo), "dd/MM/yyyy")}</span>}
                    </div>
                  </div>
                  <Button
                    size="sm" variant={a.status === "concluida" ? "default" : "outline"}
                    onClick={() => toggleAcaoMutation.mutate({ id: a.id, status: a.status === "concluida" ? "pendente" : "concluida" })}
                    data-testid={`button-toggle-acao-${a.id}`}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
