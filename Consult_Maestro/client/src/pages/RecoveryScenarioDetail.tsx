import { useState, useMemo, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ArrowLeft, Loader2, FileText, CheckCircle2, XCircle, Plus, Trash2,
  Calculator, Send, Download, Pencil, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { RecoveryScenario, RecoveryProposal, RecoveryCreditor } from "@shared/schema";

const STATUS_CENARIO: Record<string, { label: string; cor: string }> = {
  rascunho: { label: "Rascunho", cor: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  em_analise: { label: "Em análise", cor: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100" },
  aprovado_interno: { label: "Aprovado internamente", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  enviado_credores: { label: "Enviado aos credores", cor: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100" },
  aceito_credores: { label: "Aceito por credores", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  homologado: { label: "Homologado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" },
  rejeitado: { label: "Rejeitado", cor: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100" },
};

const TIPO_CENARIO = [
  { value: "parcelamento", label: "Parcelamento" },
  { value: "desconto_a_vista", label: "Desconto à vista" },
  { value: "conversao_cotas", label: "Conversão em cotas" },
  { value: "cessao_ativos", label: "Cessão de ativos" },
  { value: "hibrido", label: "Híbrido" },
  { value: "entrada_reduzida", label: "Entrada reduzida" },
];

const STATUS_PROPOSTA: Record<string, { label: string; cor: string }> = {
  rascunho: { label: "Rascunho", cor: "bg-slate-100 text-slate-800" },
  enviada: { label: "Enviada", cor: "bg-blue-100 text-blue-800" },
  aceita: { label: "Aceita", cor: "bg-emerald-100 text-emerald-800" },
  recusada: { label: "Recusada", cor: "bg-rose-100 text-rose-800" },
  contraproposta: { label: "Contraproposta", cor: "bg-amber-100 text-amber-800" },
  homologada: { label: "Homologada", cor: "bg-emerald-100 text-emerald-800" },
  cancelada: { label: "Cancelada", cor: "bg-slate-100 text-slate-600" },
};

function formatBRL(v: any): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function formatPct(v: any, dec = 4): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(dec)}%`;
}

type ScenarioWithProposals = RecoveryScenario & { proposals: RecoveryProposal[] };

export default function RecoveryScenarioDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id!;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const sc = useQuery<ScenarioWithProposals>({
    queryKey: ["/api/recovery/scenarios", id],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/scenarios/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Cenário não encontrado");
      return r.json();
    },
  });

  const approve = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/recovery/scenarios/${id}/approve`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes"] });
      toast({ title: "Cenário aprovado internamente" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async (reason: string) => (await apiRequest("POST", `/api/recovery/scenarios/${id}/reject`, { reason })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", id] });
      toast({ title: "Cenário rejeitado" });
    },
  });

  const homologate = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/recovery/scenarios/${id}/homologate`)).json(),
    onSuccess: (resp: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes"] });
      toast({ title: "Cenário homologado", description: `${resp.installmentsCreated} parcela(s) geradas para ${resp.creditorsAffected} credor(es).` });
    },
    onError: (e: any) => toast({ title: "Erro ao homologar", description: e?.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/recovery/scenarios/${id}`)),
    onSuccess: () => {
      const procId = sc.data?.processId;
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", procId, "scenarios"] });
      toast({ title: "Cenário excluído" });
      navigate(procId ? `/recovery/${procId}` : "/recovery");
    },
  });

  if (sc.isLoading) {
    return <div className="container mx-auto p-6 space-y-4">
      <Skeleton className="h-8 w-1/3" /><Skeleton className="h-32 w-full" />
    </div>;
  }
  if (!sc.data) {
    return <div className="container mx-auto p-6"><p>Cenário não encontrado.</p></div>;
  }
  const scenario = sc.data;
  const editable = scenario.status === "rascunho" || scenario.status === "em_analise";

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-scenario-detail">
      <div className="flex items-center gap-2">
        <Link href={`/recovery/${scenario.processId}`}>
          <Button variant="ghost" size="sm" data-testid="button-voltar-processo">
            <ArrowLeft className="h-4 w-4 mr-2" />Voltar para o processo
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Calculator className="h-5 w-5 text-primary" />
                <h1 className="text-2xl font-heading font-bold" data-testid="text-cenario-nome">{scenario.nome}</h1>
              </div>
              {scenario.descricao && <p className="text-sm text-muted-foreground">{scenario.descricao}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className={STATUS_CENARIO[scenario.status]?.cor}>
                  {STATUS_CENARIO[scenario.status]?.label ?? scenario.status}
                </Badge>
                <Badge variant="outline">{TIPO_CENARIO.find(t => t.value === scenario.tipoCenario)?.label ?? scenario.tipoCenario}</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {editable && (
                <Button onClick={() => approve.mutate()} disabled={approve.isPending} data-testid="button-aprovar-cenario">
                  {approve.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  Aprovar
                </Button>
              )}
              {editable && (
                <RejectDialog onConfirm={(r) => reject.mutate(r)} pending={reject.isPending} />
              )}
              {(scenario.status === "aprovado_interno" || scenario.status === "aceito_credores" || scenario.status === "enviado_credores") && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="default" data-testid="button-homologar-cenario">
                      {homologate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Homologar e gerar parcelas
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Homologar cenário?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esta ação gera as parcelas do acordo e atualiza o processo, credores e propostas para os status finais. Não pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => homologate.mutate()} data-testid="button-confirm-homologar">
                        Homologar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {(scenario.status === "rascunho" || scenario.status === "em_analise" || scenario.status === "rejeitado") && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="icon" data-testid="button-excluir-cenario">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir cenário?</AlertDialogTitle>
                      <AlertDialogDescription>Esta ação remove o cenário e suas propostas. Não pode ser desfeita.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Excluir
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {/* KPIs simulação */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
            <MiniKPI label="Valor original" value={formatBRL(scenario.valorTotalDivida)} testId="kpi-valor-original" />
            <MiniKPI label="Valor proposto" value={formatBRL(scenario.valorTotalProposto)} testId="kpi-valor-proposto" />
            <MiniKPI label="CET (a.m.)" value={scenario.cetMensal != null ? formatPct(scenario.cetMensal) : "—"} testId="kpi-cet-mensal" highlight />
            <MiniKPI label="Viabilidade" value={scenario.viabilityScore != null ? `${(Number(scenario.viabilityScore) * 100).toFixed(0)}%` : "—"} testId="kpi-viability" />
          </div>
          {scenario.rejectedReason && (
            <div className="mt-4 p-3 border border-rose-200 bg-rose-50 dark:bg-rose-950 dark:border-rose-900 rounded-md text-sm">
              <strong>Motivo rejeição:</strong> {scenario.rejectedReason}
            </div>
          )}
        </CardContent>
      </Card>

      <CETSimulator scenario={scenario} editable={editable} />

      <PropostasPanel scenario={scenario} />
    </div>
  );
}

function MiniKPI({ label, value, testId, highlight }: { label: string; value: string; testId?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`} data-testid={testId}>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

function RejectDialog({ onConfirm, pending }: { onConfirm: (r: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-rejeitar-cenario"><XCircle className="h-4 w-4 mr-2" />Rejeitar</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Rejeitar cenário</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Motivo</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} data-testid="input-reject-reason" />
        </div>
        <DialogFooter>
          <Button onClick={() => { onConfirm(reason); setOpen(false); }} disabled={pending} data-testid="button-confirmar-rejeicao">
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// SIMULADOR CET — recalcula em tempo real (debounced) via /simulate
// =============================================================================
function CETSimulator({ scenario, editable }: { scenario: RecoveryScenario; editable: boolean }) {
  const { toast } = useToast();
  const [valorTotalDivida, setValorTotalDivida] = useState(String(scenario.valorTotalDivida));
  const [valorTotalProposto, setValorTotalProposto] = useState(String(scenario.valorTotalProposto));
  const [numParcelas, setNumParcelas] = useState(String(scenario.numParcelas ?? 1));
  const [intervaloDias, setIntervaloDias] = useState(String(scenario.intervaloDias ?? 30));
  const [carenciaMeses, setCarenciaMeses] = useState(String(scenario.carenciaMeses ?? 0));
  const [hasReducedInitial, setHasReducedInitial] = useState(Boolean(scenario.hasReducedInitial));
  const [reducedCount, setReducedCount] = useState(String(scenario.reducedCount ?? 0));
  const [reducedAmount, setReducedAmount] = useState(String(scenario.reducedAmount ?? 0));
  const [normalAmount, setNormalAmount] = useState(String(scenario.normalAmount ?? 0));
  const [primeiraParcelaData, setPrimeiraParcelaData] = useState(scenario.primeiraParcelaData ?? "");
  const [tipoCenario, setTipoCenario] = useState(scenario.tipoCenario);
  const [preview, setPreview] = useState<any>(scenario.cetMensal != null ? {
    cetMensal: Number(scenario.cetMensal),
    cetAnual: Number(scenario.cetAnual ?? 0),
    totalPagoNominal: Number(scenario.totalPagoNominal ?? 0),
    totalJurosPagos: Number(scenario.totalJurosPagos ?? 0),
    viabilityScore: Number(scenario.viabilityScore ?? 0),
    converged: true,
    cashFlowImpact: scenario.cashFlowImpact ?? [],
  } : null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const params = useMemo(() => ({
    valorTotalDivida: Number(valorTotalDivida),
    valorTotalProposto: Number(valorTotalProposto),
    numParcelas: Number(numParcelas),
    intervaloDias: Number(intervaloDias),
    carenciaMeses: Number(carenciaMeses),
    hasReducedInitial,
    reducedCount: Number(reducedCount),
    reducedAmount: Number(reducedAmount),
    normalAmount: Number(normalAmount),
    primeiraParcelaData: primeiraParcelaData || undefined,
    tipoCenario,
  }), [valorTotalDivida, valorTotalProposto, numParcelas, intervaloDias, carenciaMeses, hasReducedInitial, reducedCount, reducedAmount, normalAmount, primeiraParcelaData, tipoCenario]);

  // Debounce de 400ms — preview sem persistir
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!params.valorTotalDivida || !params.numParcelas) { setPreview(null); return; }
      setPreviewLoading(true);
      try {
        const r = await apiRequest("POST", `/api/recovery/scenarios/${scenario.id}/simulate`, params);
        const data = await r.json();
        setPreview(data);
      } catch (e) { /* silencia preview */ }
      finally { setPreviewLoading(false); }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valorTotalDivida, valorTotalProposto, numParcelas, intervaloDias, carenciaMeses, hasReducedInitial, reducedCount, reducedAmount, normalAmount, primeiraParcelaData, tipoCenario]);

  const persist = useMutation({
    mutationFn: async () => {
      // PATCH com novos parâmetros + simulate persist
      await apiRequest("PATCH", `/api/recovery/scenarios/${scenario.id}`, params);
      return (await apiRequest("POST", `/api/recovery/scenarios/${scenario.id}/simulate`, { ...params, persist: true })).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", scenario.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", scenario.processId, "scenarios"] });
      toast({ title: "Cenário salvo" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="card-simulator">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-4 w-4" /> Simulador CET / TIR
        </CardTitle>
        <CardDescription>
          Ajuste os parâmetros — preview recalculado automaticamente.
          {!editable && <span className="text-amber-600"> · Cenário em status final, edição bloqueada.</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Tipo de cenário">
            <Select value={tipoCenario} onValueChange={setTipoCenario} disabled={!editable}>
              <SelectTrigger data-testid="select-tipo-cenario"><SelectValue /></SelectTrigger>
              <SelectContent>{TIPO_CENARIO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Valor total da dívida">
            <Input type="number" step="0.01" disabled={!editable} value={valorTotalDivida} onChange={(e) => setValorTotalDivida(e.target.value)} data-testid="input-valor-divida" />
          </Field>
          <Field label="Valor total proposto">
            <Input type="number" step="0.01" disabled={!editable} value={valorTotalProposto} onChange={(e) => setValorTotalProposto(e.target.value)} data-testid="input-valor-proposto" />
          </Field>
          <Field label="Nº de parcelas">
            <Input type="number" min="1" disabled={!editable} value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} data-testid="input-num-parcelas" />
          </Field>
          <Field label="Intervalo (dias)">
            <Input type="number" min="1" disabled={!editable} value={intervaloDias} onChange={(e) => setIntervaloDias(e.target.value)} data-testid="input-intervalo" />
          </Field>
          <Field label="Carência (meses)">
            <Input type="number" min="0" disabled={!editable} value={carenciaMeses} onChange={(e) => setCarenciaMeses(e.target.value)} data-testid="input-carencia" />
          </Field>
          <Field label="Primeira parcela">
            <Input type="date" disabled={!editable} value={primeiraParcelaData} onChange={(e) => setPrimeiraParcelaData(e.target.value)} data-testid="input-primeira-parcela" />
          </Field>
          <Field label="Valor parcela normal">
            <Input type="number" step="0.01" disabled={!editable} value={normalAmount} onChange={(e) => setNormalAmount(e.target.value)} data-testid="input-normal-amount" />
          </Field>
          <Field label="">
            <div className="flex items-center justify-between border rounded-md px-3 py-2 h-10">
              <Label htmlFor="reduced-toggle" className="text-sm cursor-pointer">Parcelas reduzidas iniciais</Label>
              <Switch id="reduced-toggle" checked={hasReducedInitial} disabled={!editable} onCheckedChange={setHasReducedInitial} data-testid="switch-reduced" />
            </div>
          </Field>
          {hasReducedInitial && (
            <>
              <Field label="Qtd. reduzidas">
                <Input type="number" min="0" disabled={!editable} value={reducedCount} onChange={(e) => setReducedCount(e.target.value)} data-testid="input-reduced-count" />
              </Field>
              <Field label="Valor reduzido">
                <Input type="number" step="0.01" disabled={!editable} value={reducedAmount} onChange={(e) => setReducedAmount(e.target.value)} data-testid="input-reduced-amount" />
              </Field>
            </>
          )}
        </div>

        {/* Resultado do preview */}
        <div className="border rounded-md p-4 bg-muted/30 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              Resultado da simulação
              {previewLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            </h3>
            {editable && (
              <Button onClick={() => persist.mutate()} disabled={persist.isPending} size="sm" data-testid="button-salvar-cenario">
                {persist.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Salvar cenário
              </Button>
            )}
          </div>
          {!preview ? (
            <p className="text-sm text-muted-foreground">Informe valor da dívida e número de parcelas para simular.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MiniKPI label="CET mensal" value={formatPct(preview.cetMensal)} testId="preview-cet-mensal" highlight />
                <MiniKPI label="CET anual" value={formatPct(preview.cetAnual, 2)} testId="preview-cet-anual" />
                <MiniKPI label="Total nominal" value={formatBRL(preview.totalPagoNominal)} testId="preview-total" />
                <MiniKPI label="Juros pagos" value={formatBRL(preview.totalJurosPagos)} testId="preview-juros" />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Score viabilidade: </span>
                  <strong>{(Number(preview.viabilityScore || 0) * 100).toFixed(0)}%</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Convergência: </span>
                  <strong className={preview.converged ? "text-emerald-600" : "text-amber-600"}>
                    {preview.converged ? "OK" : "parcial"}
                  </strong>
                </div>
              </div>
              {preview.cashFlowImpact && preview.cashFlowImpact.length > 0 && (
                <div>
                  <Label className="text-xs uppercase">Impacto no fluxo (acumulado)</Label>
                  <div className="mt-2 max-h-40 overflow-y-auto border rounded">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Mês</TableHead>
                          <TableHead className="text-right">Mensal</TableHead>
                          <TableHead className="text-right">Acumulado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.cashFlowImpact.slice(0, 24).map((m: any) => (
                          <TableRow key={m.month}>
                            <TableCell>{m.month}</TableCell>
                            <TableCell className="text-right">{formatBRL(m.amount)}</TableCell>
                            <TableCell className="text-right font-medium">{formatBRL(m.cumulative)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {preview.cashFlowImpact.length > 24 && (
                      <div className="text-xs text-muted-foreground p-2">… {preview.cashFlowImpact.length - 24} mês(es) a mais</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      {label && <Label className="text-xs uppercase">{label}</Label>}
      {children}
    </div>
  );
}

// =============================================================================
// PROPOSTAS — uma por credor dentro do cenário
// =============================================================================
function PropostasPanel({ scenario }: { scenario: ScenarioWithProposals }) {
  const [novaOpen, setNovaOpen] = useState(false);
  const { toast } = useToast();

  const credoresQuery = useQuery<RecoveryCreditor[]>({
    queryKey: ["/api/recovery/processes", scenario.processId, "creditors"],
    queryFn: async () => {
      const r = await fetch(`/api/recovery/processes/${scenario.processId}/creditors`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao carregar credores");
      return r.json();
    },
  });

  const sendProposal = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/recovery/proposals/${id}/send`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", scenario.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/processes", scenario.processId, "creditors"] });
      toast({ title: "Proposta enviada" });
    },
  });

  const deleteProposal = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/recovery/proposals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", scenario.id] });
      toast({ title: "Proposta excluída" });
    },
  });

  const downloadPdf = async (proposalId: string, filename: string) => {
    try {
      const r = await fetch(`/api/recovery/proposals/${proposalId}/pdf`, { credentials: "include" });
      if (!r.ok) throw new Error("Falha ao gerar PDF");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Erro ao baixar PDF", description: e?.message, variant: "destructive" });
    }
  };

  const credorMap = new Map(credoresQuery.data?.map(c => [c.id, c]) ?? []);

  return (
    <Card data-testid="card-propostas">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Propostas por credor</CardTitle>
            <CardDescription>{scenario.proposals.length} proposta(s)</CardDescription>
          </div>
          <Dialog open={novaOpen} onOpenChange={setNovaOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-nova-proposta" disabled={!credoresQuery.data?.length}>
                <Plus className="h-4 w-4 mr-2" />Nova proposta
              </Button>
            </DialogTrigger>
            <NovaPropostaDialog scenario={scenario} credores={credoresQuery.data ?? []} onClose={() => setNovaOpen(false)} />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {scenario.proposals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p>Nenhuma proposta cadastrada.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead className="text-right">Original</TableHead>
                <TableHead className="text-right">Proposto</TableHead>
                <TableHead className="text-right">Parcelas</TableHead>
                <TableHead className="text-right">CET a.m.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-44"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenario.proposals.map((p) => {
                const cr = credorMap.get(p.creditorId);
                const filename = `proposta-${cr?.credorNome.replace(/\s+/g, "_") ?? "credor"}-${p.id.slice(0, 8)}.pdf`;
                return (
                  <TableRow key={p.id} data-testid={`row-proposta-${p.id}`}>
                    <TableCell className="font-medium">{cr?.credorNome ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(p.valorOriginal)}</TableCell>
                    <TableCell className="text-right">{formatBRL(p.valorProposto)}</TableCell>
                    <TableCell className="text-right">{p.numParcelas}x</TableCell>
                    <TableCell className="text-right">{p.cetMensal != null ? formatPct(p.cetMensal) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={STATUS_PROPOSTA[p.status]?.cor}>{STATUS_PROPOSTA[p.status]?.label ?? p.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button size="icon" variant="outline" title="Baixar PDF" onClick={() => downloadPdf(p.id, filename)} data-testid={`button-pdf-${p.id}`}>
                        <Download className="h-4 w-4" />
                      </Button>
                      {p.status === "rascunho" && (
                        <Button size="icon" variant="outline" title="Enviar" onClick={() => sendProposal.mutate(p.id)} data-testid={`button-enviar-${p.id}`}>
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                      {(p.status === "rascunho" || p.status === "cancelada") && (
                        <Button size="icon" variant="outline" title="Excluir" onClick={() => deleteProposal.mutate(p.id)} data-testid={`button-excluir-proposta-${p.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function NovaPropostaDialog({ scenario, credores, onClose }: { scenario: RecoveryScenario; credores: RecoveryCreditor[]; onClose: () => void }) {
  const { toast } = useToast();
  const [creditorId, setCreditorId] = useState("");
  const [valorProposto, setValorProposto] = useState("");
  const [numParcelas, setNumParcelas] = useState(String(scenario.numParcelas ?? 1));
  const [intervaloDias, setIntervaloDias] = useState(String(scenario.intervaloDias ?? 30));
  const [carenciaMeses, setCarenciaMeses] = useState(String(scenario.carenciaMeses ?? 0));
  const [primeiraParcelaData, setPrimeiraParcelaData] = useState(scenario.primeiraParcelaData ?? "");
  const [taxaPropostaMensal, setTaxaPropostaMensal] = useState("");
  const [justificativa, setJustificativa] = useState("");

  const cr = credores.find(c => c.id === creditorId);
  const valorOriginalDefault = cr ? Number(cr.valorAtualizado || cr.valorOriginal) : 0;

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        creditorId,
        valorOriginal: valorOriginalDefault,
        valorProposto: Number(valorProposto),
        numParcelas: Number(numParcelas),
        intervaloDias: Number(intervaloDias),
        carenciaMeses: Number(carenciaMeses),
        primeiraParcelaData: primeiraParcelaData || undefined,
        justificativa: justificativa.trim() || undefined,
      };
      if (taxaPropostaMensal) body.taxaPropostaMensal = Number(taxaPropostaMensal);
      return (await apiRequest("POST", `/api/recovery/scenarios/${scenario.id}/proposals`, body)).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recovery/scenarios", scenario.id] });
      toast({ title: "Proposta criada" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <DialogContent data-testid="dialog-nova-proposta">
      <DialogHeader>
        <DialogTitle>Nova proposta</DialogTitle>
        <DialogDescription>Proposta concreta para um credor específico.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <Field label="Credor *">
          <Select value={creditorId} onValueChange={setCreditorId}>
            <SelectTrigger data-testid="select-creditor"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {credores.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.credorNome} — {formatBRL(c.valorAtualizado || c.valorOriginal)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {cr && <p className="text-xs text-muted-foreground">Valor original (auto): <strong>{formatBRL(valorOriginalDefault)}</strong></p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor proposto *">
            <Input type="number" step="0.01" value={valorProposto} onChange={(e) => setValorProposto(e.target.value)} data-testid="input-prop-valor" />
          </Field>
          <Field label="Nº parcelas">
            <Input type="number" min="1" value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} data-testid="input-prop-parcelas" />
          </Field>
          <Field label="Intervalo (dias)">
            <Input type="number" min="1" value={intervaloDias} onChange={(e) => setIntervaloDias(e.target.value)} data-testid="input-prop-intervalo" />
          </Field>
          <Field label="Carência (meses)">
            <Input type="number" min="0" value={carenciaMeses} onChange={(e) => setCarenciaMeses(e.target.value)} data-testid="input-prop-carencia" />
          </Field>
          <Field label="Primeira parcela">
            <Input type="date" value={primeiraParcelaData} onChange={(e) => setPrimeiraParcelaData(e.target.value)} data-testid="input-prop-primeira" />
          </Field>
          <Field label="Taxa informada (a.m. decimal)">
            <Input type="number" step="0.0001" value={taxaPropostaMensal} onChange={(e) => setTaxaPropostaMensal(e.target.value)} data-testid="input-prop-taxa" placeholder="0.015" />
          </Field>
        </div>
        <Field label="Justificativa">
          <Textarea rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} data-testid="input-prop-justificativa" />
        </Field>
      </div>
      <DialogFooter>
        <Button onClick={() => create.mutate()} disabled={!creditorId || !valorProposto || create.isPending} data-testid="button-criar-proposta">
          {create.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Criar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
