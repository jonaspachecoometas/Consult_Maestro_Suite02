// Sprint 1 — IT-01 (rename), IT-02 (CAJU tipo), IT-03 (saldo + extrato CAJU)
// Carteiras / Benefícios: lista contas tipo='carteira' com saldo, pendentes e gasto do mês.
// Subtipo: CAJU, Flash, Benefício, Dinheiro, Outro.
// Extrato inline ao selecionar uma carteira.

import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Plus, Wallet, ChevronDown, ChevronUp, TrendingDown, AlertCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CarteiraResumo {
  id: string; apelido: string | null; banco: string;
  responsavelId: string | null; saldoAtual: number; pendentes: number; totalGastoMes: number;
}

interface LancamentoExtrato {
  id: string; tipo: string; descricao: string; favorecido?: string;
  valor: string; data_vencimento: string; data_pagamento?: string; status: string;
}

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d?: string) => d ? new Date(d).toLocaleDateString("pt-BR") : "—";

const SUBTIPOS = [
  { value: "CAJU",      label: "CAJU" },
  { value: "Flash",     label: "Flash" },
  { value: "Benefício", label: "Benefício" },
  { value: "Dinheiro",  label: "Dinheiro" },
  { value: "Outro",     label: "Outro" },
];

const SUBTIPO_COLOR: Record<string, string> = {
  CAJU: "bg-orange-100 text-orange-700",
  Flash: "bg-yellow-100 text-yellow-700",
  "Benefício": "bg-blue-100 text-blue-700",
  Dinheiro: "bg-green-100 text-green-700",
  Outro: "bg-gray-100 text-gray-600",
};

export default function Carteiras() {
  const [location] = useLocation();
  const clienteId = location.split('/').filter(Boolean)[1] ?? '';
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ banco: "CAJU", apelido: "", responsavel: "", saldoInicial: "0" });
  const [extratoAberto, setExtratoAberto] = useState<string | null>(null);

  const q = useQuery<{ carteiras: CarteiraResumo[] }>({
    queryKey: ["/api/control/clientes", clienteId, "carteiras"],
  });

  const qExtrato = useQuery<{ lancamentos: LancamentoExtrato[]; total: number }>({
    queryKey: ["/api/control/carteiras", extratoAberto, "extrato"],
    queryFn: () => apiRequest("GET", `/api/control/carteiras/${extratoAberto}/extrato?limit=30`).then(r => r.json()),
    enabled: !!extratoAberto,
  });

  const criar = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/control/clientes/${clienteId}/contas-bancarias`, {
        banco: form.banco,
        apelido: form.apelido || null,
        tipo: "carteira",
        saldoInicial: form.saldoInicial,
        ativo: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "carteiras"] });
      toast({ title: "Carteira criada" });
      setOpen(false);
      setForm({ banco: "CAJU", apelido: "", responsavel: "", saldoInicial: "0" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  function toggleExtrato(id: string) {
    setExtratoAberto(prev => prev === id ? null : id);
  }

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-4">
        <Link href={`/control/${clienteId}`}>
          <Button variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        </Link>
        <h1 className="text-2xl font-bold flex-1" data-testid="text-page-title">
          Carteiras / Benefícios
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-nova-carteira">
              <Plus className="h-4 w-4 mr-1" /> Nova Carteira
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova Carteira / Benefício</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Tipo de Benefício</Label>
                <Select value={form.banco} onValueChange={v => setForm(f => ({ ...f, banco: v }))}>
                  <SelectTrigger data-testid="select-tipo-beneficio">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBTIPOS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Apelido / Colaborador</Label>
                <Input
                  value={form.apelido}
                  onChange={e => setForm(f => ({ ...f, apelido: e.target.value }))}
                  placeholder="Ex.: CAJU - Amanda"
                  data-testid="input-apelido"
                />
              </div>
              <div>
                <Label>Saldo Inicial (R$)</Label>
                <Input
                  type="number" step="0.01"
                  value={form.saldoInicial}
                  onChange={e => setForm(f => ({ ...f, saldoInicial: e.target.value }))}
                  data-testid="input-saldo-inicial"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => criar.mutate()}
                disabled={criar.isPending || !form.banco}
                data-testid="button-confirmar-criar"
              >
                Criar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {q.isLoading ? <Skeleton className="h-32" /> : (
        <div className="space-y-3">
          {(q.data?.carteiras ?? []).length === 0 && (
            <Card>
              <CardContent className="text-center py-8 text-muted-foreground">
                Nenhuma carteira cadastrada. Crie uma para gerenciar carteiras de benefícios (CAJU, Flash, etc.).
              </CardContent>
            </Card>
          )}

          {(q.data?.carteiras ?? []).map(c => {
            const isOpen = extratoAberto === c.id;
            const subtipoColor = SUBTIPO_COLOR[c.banco] ?? SUBTIPO_COLOR["Outro"];
            return (
              <div key={c.id}>
                <Card
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  data-testid={`card-carteira-${c.id}`}
                >
                  <CardHeader className="pb-2 flex flex-row items-center gap-2">
                    <Wallet className="h-5 w-5 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{c.apelido || c.banco}</CardTitle>
                        <Badge className={`text-xs ${subtipoColor}`}>{c.banco}</Badge>
                      </div>
                      {c.apelido && <p className="text-xs text-muted-foreground mt-0.5">{c.banco}</p>}
                    </div>
                    {c.pendentes > 0 && (
                      <Badge variant="secondary" data-testid={`badge-pendentes-${c.id}`}>
                        <AlertCircle className="h-3 w-3 mr-1" />{c.pendentes} pendente(s)
                      </Badge>
                    )}
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0"
                      onClick={() => toggleExtrato(c.id)}
                      data-testid={`btn-extrato-${c.id}`}
                    >
                      {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Saldo atual</span>
                      <span className={`font-mono font-semibold ${c.saldoAtual < 0 ? "text-destructive" : ""}`} data-testid={`text-saldo-${c.id}`}>
                        {fmt(c.saldoAtual)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" /> Gasto no mês
                      </span>
                      <span className="font-mono" data-testid={`text-gasto-${c.id}`}>
                        {fmt(c.totalGastoMes)}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* EXTRATO INLINE (IT-03) */}
                {isOpen && (
                  <Card className="border-t-0 rounded-t-none border-primary/30">
                    <CardContent className="pt-3 pb-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        Extrato — últimos lançamentos
                      </p>
                      {qExtrato.isLoading ? (
                        <Skeleton className="h-20" />
                      ) : !qExtrato.data?.lancamentos?.length ? (
                        <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-xs">Data</TableHead>
                                <TableHead className="text-xs">Descrição</TableHead>
                                <TableHead className="text-xs">Favorecido</TableHead>
                                <TableHead className="text-xs text-right">Valor</TableHead>
                                <TableHead className="text-xs">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {qExtrato.data.lancamentos.map(l => (
                                <TableRow key={l.id}>
                                  <TableCell className="text-xs">{fmtDate(l.data_vencimento)}</TableCell>
                                  <TableCell className="text-xs max-w-[200px] truncate">{l.descricao || "—"}</TableCell>
                                  <TableCell className="text-xs">{l.favorecido || "—"}</TableCell>
                                  <TableCell className={`text-xs text-right font-mono ${l.tipo === "pagar" ? "text-red-600" : "text-green-600"}`}>
                                    {l.tipo === "pagar" ? "-" : "+"}{fmt(Math.abs(parseFloat(l.valor || "0")))}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={l.status === "pago" ? "default" : l.status === "cancelado" ? "secondary" : "outline"}
                                      className="text-xs"
                                    >
                                      {l.status}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {qExtrato.data.total > 30 && (
                            <p className="text-xs text-muted-foreground text-center mt-2">
                              Exibindo 30 de {qExtrato.data.total} lançamentos
                            </p>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
