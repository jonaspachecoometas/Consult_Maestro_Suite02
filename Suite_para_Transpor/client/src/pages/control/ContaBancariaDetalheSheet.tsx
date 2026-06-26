// CTL-CONC-01 — Detalhe de Conta Bancária com conciliação OFX/XLSX
import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowDownCircle, ArrowUpCircle, Upload, FileText,
  Receipt, Settings, AlertCircle, CheckCircle2, TriangleAlert,
} from "lucide-react";

type ContaBancaria = {
  id: string; banco: string; agencia?: string | null; conta?: string | null;
  tipo: string; saldoInicial: string; saldoAtual: string; planoContaId?: string | null;
};
type PlanoConta = { id: string; codigo: string; descricao: string; permiteLancamento: boolean };

interface Transacao {
  idx: number;
  data: string;       // YYYY-MM-DD
  descricao: string;
  valor: number;      // sempre positivo
  tipo: "entrada" | "saida";
  documento?: string;
  saldo?: number | null;
  planoContaId?: string | null;
  selecionado: boolean;
}

interface ExtratoData {
  conta: { id: string; banco: string; saldoInicial: string; saldoAtual: string };
  movimentacoes: Array<{
    id: string; data: string; tipo: "entrada" | "saida"; origem: string;
    descricao: string; valor: string; saldoApos?: string | null;
  }>;
  totalEntradas: number; totalSaidas: number;
}

const fmtBRL = (v: string | number) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d?: string | null) => {
  if (!d) return "-";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

// ──────── OFX PARSER ────────
function parseOfx(text: string): Transacao[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const result: Transacao[] = [];
  blocks.forEach((b, idx) => {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}>([^<\n\r]+)`, "i"));
      return m ? m[1].trim() : "";
    };
    const dt = get("DTPOSTED").slice(0, 8);
    if (dt.length !== 8) return;
    const y = dt.slice(0, 4), mo = dt.slice(4, 6), d = dt.slice(6, 8);
    const data = `${y}-${mo}-${d}`;
    const amt = parseFloat(get("TRNAMT").replace(",", ".")) || 0;
    const desc = get("MEMO") || get("NAME") || get("TRNTYPE") || "Sem descrição";
    const doc = get("FITID");
    result.push({
      idx, data, descricao: desc, valor: Math.abs(amt),
      tipo: amt >= 0 ? "entrada" : "saida",
      documento: doc || undefined, planoContaId: null, selecionado: true,
    });
  });
  return result;
}

// ──────── XLSX PARSER ────────
async function parseXlsx(file: File): Promise<Transacao[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // Encontrar linha de cabeçalho (procura "Data" na col 0)
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const cell = String(rows[i][0] ?? "").toLowerCase().trim();
    if (cell === "data") { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  // Detectar índices de colunas pelo cabeçalho
  const hdr = rows[headerIdx].map((c: any) => String(c ?? "").toLowerCase());
  const iData = hdr.findIndex((h: string) => h === "data");
  const iDesc = hdr.findIndex((h: string) => h.includes("lançamento") || h.includes("lancamento") || h.includes("histórico") || h.includes("historico"));
  const iValor = hdr.findIndex((h: string) => h.includes("valor"));
  const iCred = hdr.findIndex((h: string) => h.includes("crédit") || h.includes("credit"));
  const iDeb = hdr.findIndex((h: string) => h.includes("débit") || h.includes("debit"));
  const iSaldo = hdr.findIndex((h: string) => h.includes("saldo"));

  const result: Transacao[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[iData]) continue;

    // Normalizar data
    let data = "";
    const rawDate = row[iData];
    if (typeof rawDate === "number") {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(rawDate);
      if (d) data = `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;
    } else {
      const s = String(rawDate).trim();
      // DD/MM/YYYY
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) data = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    }
    if (!data) continue;

    let valor = 0, tipo: "entrada" | "saida" = "saida";

    if (iValor >= 0) {
      const raw = parseFloat(String(row[iValor] ?? "").replace(",", ".")) || 0;
      valor = Math.abs(raw);
      tipo = raw >= 0 ? "entrada" : "saida";
    } else if (iCred >= 0 || iDeb >= 0) {
      const cred = parseFloat(String(row[iCred] ?? "").replace(",", ".")) || 0;
      const deb = parseFloat(String(row[iDeb] ?? "").replace(",", ".")) || 0;
      if (cred > 0) { valor = cred; tipo = "entrada"; }
      else if (deb > 0) { valor = deb; tipo = "saida"; }
    }

    if (valor === 0) continue;

    const desc = String(row[iDesc] ?? "").trim() || "Sem descrição";
    // Pular "SALDO ANTERIOR"
    if (desc.toUpperCase().includes("SALDO ANTERIOR")) continue;

    const saldo = iSaldo >= 0 ? (parseFloat(String(row[iSaldo] ?? "").replace(",", ".")) || null) : null;

    result.push({
      idx: result.length, data, descricao: desc, valor, tipo,
      saldo, planoContaId: null, selecionado: true,
    });
  }
  return result;
}

// ──────── COMPONENTE PRINCIPAL ────────
interface Props {
  conta: ContaBancaria;
  clienteId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const NONE = "__none__";

export function ContaBancariaDetalheSheet({ conta, clienteId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<"extrato" | "importar" | "config">("extrato");
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [planosFilter, setPlanosFilter] = useState<string>(NONE);

  // Config tab
  const [cfgBanco, setCfgBanco] = useState(conta.banco);
  const [cfgAgencia, setCfgAgencia] = useState(conta.agencia ?? "");
  const [cfgConta, setCfgConta] = useState(conta.conta ?? "");
  const [cfgTipo, setCfgTipo] = useState(conta.tipo);
  const [cfgPlano, setCfgPlano] = useState<string>(conta.planoContaId ?? NONE);

  const { data: extratoData, isLoading: loadingExtrato } = useQuery<ExtratoData>({
    queryKey: ["/api/control/contas-bancarias", conta.id, "extrato"],
    enabled: open && tab === "extrato",
  });

  const { data: planos = [] } = useQuery<PlanoConta[]>({
    queryKey: ["/api/control/planos-contas"],
    enabled: open,
  });
  const planosAtivos = planos.filter(p => p.permiteLancamento);

  const importarMut = useMutation({
    mutationFn: async (selecionadas: Transacao[]) => {
      const res = await apiRequest("POST", `/api/control/contas-bancarias/${conta.id}/importar-extrato`, {
        clienteId,
        transacoes: selecionadas.map(t => ({
          data: t.data, descricao: t.descricao, valor: t.valor,
          tipo: t.tipo, planoContaId: t.planoContaId || null, documento: t.documento || null,
        })),
      });
      return await res.json();
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/control/contas-bancarias", conta.id, "extrato"] });
      qc.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "lancamentos"] });
      qc.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "overview"] });
      toast({
        title: "Extrato importado",
        description: `${r.criados} lançamento(s) criado(s)${r.duplicados > 0 ? ` · ${r.duplicados} duplicado(s) ignorado(s)` : ""}`,
      });
      setTransacoes([]); setFileName(null); setTab("extrato");
    },
    onError: (e: any) => toast({ title: "Erro ao importar", description: e?.message, variant: "destructive" }),
  });

  const saveCfgMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/control/contas-bancarias/${conta.id}`, {
        banco: cfgBanco, agencia: cfgAgencia || null, conta: cfgConta || null,
        tipo: cfgTipo, planoContaId: cfgPlano === NONE ? null : cfgPlano,
      });
      return await res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"] });
      toast({ title: "Conta atualizada" });
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message, variant: "destructive" }),
  });

  const handleFile = useCallback(async (file: File) => {
    setParseError(null); setFileName(file.name);
    try {
      let result: Transacao[];
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "ofx" || ext === "ofc") {
        const text = await file.text();
        result = parseOfx(text);
      } else if (ext === "xlsx" || ext === "xls") {
        result = await parseXlsx(file);
      } else {
        setParseError("Formato não suportado. Use .ofx ou .xlsx");
        return;
      }
      if (result.length === 0) { setParseError("Nenhuma transação encontrada no arquivo."); return; }
      setTransacoes(result);
    } catch (e: any) {
      setParseError(e?.message ?? "Erro ao processar arquivo");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const selecionadas = transacoes.filter(t => t.selecionado);
  const totalSel = selecionadas.reduce((s, t) => s + (t.tipo === "entrada" ? t.valor : -t.valor), 0);
  const allChecked = transacoes.length > 0 && transacoes.every(t => t.selecionado);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-4xl flex flex-col p-0 gap-0">
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <SheetTitle className="text-base flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            {conta.banco}
            {(conta.agencia || conta.conta) && (
              <span className="text-muted-foreground font-normal text-sm">
                Ag {conta.agencia || "-"} / Cc {conta.conta || "-"}
              </span>
            )}
            <Badge variant="outline" className="ml-auto">{conta.tipo}</Badge>
          </SheetTitle>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-5 mt-3 mb-0 shrink-0 w-auto justify-start">
            <TabsTrigger value="extrato"><Receipt className="h-3.5 w-3.5 mr-1" />Extrato</TabsTrigger>
            <TabsTrigger value="importar"><Upload className="h-3.5 w-3.5 mr-1" />Importar OFX / XLSX</TabsTrigger>
            <TabsTrigger value="config"><Settings className="h-3.5 w-3.5 mr-1" />Configurações</TabsTrigger>
          </TabsList>

          {/* ── Extrato ── */}
          <TabsContent value="extrato" className="flex-1 min-h-0 p-5 overflow-auto space-y-4 mt-0">
            {loadingExtrato ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Carregando...</div>
            ) : !extratoData ? null : (
              <>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Saldo inicial",  val: extratoData.conta.saldoInicial, color: "" },
                    { label: "Entradas",       val: extratoData.totalEntradas,      color: "text-green-600" },
                    { label: "Saídas",         val: extratoData.totalSaidas,        color: "text-red-600" },
                    { label: "Saldo atual",    val: extratoData.conta.saldoAtual,   color: "font-bold" },
                  ].map(({ label, val, color }) => (
                    <Card key={label}><CardContent className="p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className={`text-lg font-semibold ${color}`}>{fmtBRL(val)}</div>
                    </CardContent></Card>
                  ))}
                </div>
                <ScrollArea className="h-[calc(100vh-360px)] border rounded-md">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-24">Data</TableHead>
                        <TableHead className="w-20">Tipo</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-24">Origem</TableHead>
                        <TableHead className="text-right w-32">Valor</TableHead>
                        <TableHead className="text-right w-32">Saldo após</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extratoData.movimentacoes.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                          Nenhuma movimentação. Importe um extrato para iniciar.
                        </TableCell></TableRow>
                      ) : extratoData.movimentacoes.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-sm">{fmtDate(m.data)}</TableCell>
                          <TableCell>
                            {m.tipo === "entrada" ? (
                              <Badge variant="outline" className="border-green-500 text-green-600 text-xs">
                                <ArrowDownCircle className="h-3 w-3 mr-1" />Entrada
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-red-500 text-red-600 text-xs">
                                <ArrowUpCircle className="h-3 w-3 mr-1" />Saída
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{m.descricao}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-xs">{m.origem}</Badge></TableCell>
                          <TableCell className={`text-right font-medium text-sm ${m.tipo === "entrada" ? "text-green-600" : "text-red-600"}`}>
                            {m.tipo === "entrada" ? "+" : "−"} {fmtBRL(m.valor)}
                          </TableCell>
                          <TableCell className="text-right text-sm">{m.saldoApos ? fmtBRL(m.saldoApos) : "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </>
            )}
          </TabsContent>

          {/* ── Importar ── */}
          <TabsContent value="importar" className="flex-1 min-h-0 p-5 overflow-auto space-y-4 mt-0">
            {transacoes.length === 0 ? (
              <div
                className="border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">Arraste ou clique para importar</p>
                <p className="text-sm text-muted-foreground mt-1">Suporta OFX (Open Financial Exchange) e XLSX (planilha bancária)</p>
                {parseError && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4" /> {parseError}
                  </div>
                )}
                <input
                  ref={fileRef} type="file" className="hidden"
                  accept=".ofx,.ofc,.xlsx,.xls"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {/* Cabeçalho */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{fileName}</span>
                  </div>
                  <Badge variant="secondary">{transacoes.length} transações</Badge>
                  <Badge variant={selecionadas.length > 0 ? "default" : "outline"}>
                    {selecionadas.length} selecionada(s)
                  </Badge>
                  <span className={`text-sm font-medium ml-auto ${totalSel >= 0 ? "text-green-600" : "text-red-600"}`}>
                    Líquido: {fmtBRL(totalSel)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => { setTransacoes([]); setFileName(null); }}>
                    Trocar arquivo
                  </Button>
                </div>

                {/* Plano de contas global para aplicar a todos */}
                <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Plano padrão para todos:</Label>
                  <Select value={planosFilter} onValueChange={(v) => {
                    setPlanosFilter(v);
                    setTransacoes(prev => prev.map(t => ({ ...t, planoContaId: v === NONE ? null : v })));
                  }}>
                    <SelectTrigger className="h-7 text-xs w-72"><SelectValue placeholder="— selecionar —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Categorizar individualmente —</SelectItem>
                      {planosAtivos.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.codigo} — {p.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Tabela preview */}
                <ScrollArea className="h-[calc(100vh-420px)] border rounded-md">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={(v) => setTransacoes(prev => prev.map(t => ({ ...t, selecionado: !!v })))}
                          />
                        </TableHead>
                        <TableHead className="w-24">Data</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="w-20">Tipo</TableHead>
                        <TableHead className="text-right w-28">Valor</TableHead>
                        <TableHead className="w-56">Plano de Contas</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transacoes.map((t, i) => (
                        <TableRow key={i} className={t.selecionado ? "" : "opacity-40"}>
                          <TableCell>
                            <Checkbox
                              checked={t.selecionado}
                              onCheckedChange={(v) => setTransacoes(prev =>
                                prev.map((x, xi) => xi === i ? { ...x, selecionado: !!v } : x)
                              )}
                            />
                          </TableCell>
                          <TableCell className="text-sm">{fmtDate(t.data)}</TableCell>
                          <TableCell className="text-sm max-w-xs truncate">{t.descricao}</TableCell>
                          <TableCell>
                            {t.tipo === "entrada" ? (
                              <Badge variant="outline" className="border-green-500 text-green-600 text-xs">
                                <ArrowDownCircle className="h-3 w-3 mr-1" />Entrada
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-red-500 text-red-600 text-xs">
                                <ArrowUpCircle className="h-3 w-3 mr-1" />Saída
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className={`text-right text-sm font-medium ${t.tipo === "entrada" ? "text-green-600" : "text-red-600"}`}>
                            {t.tipo === "entrada" ? "+" : "−"} {fmtBRL(t.valor)}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={t.planoContaId ?? NONE}
                              onValueChange={(v) => setTransacoes(prev =>
                                prev.map((x, xi) => xi === i ? { ...x, planoContaId: v === NONE ? null : v } : x)
                              )}
                            >
                              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NONE}>—</SelectItem>
                                {planosAtivos.map(p => (
                                  <SelectItem key={p.id} value={p.id}>{p.codigo} — {p.descricao}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>

                {/* Botão importar */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Duplicatas serão detectadas e ignoradas automaticamente
                  </span>
                  <Button
                    onClick={() => importarMut.mutate(selecionadas)}
                    disabled={selecionadas.length === 0 || importarMut.isPending}
                  >
                    {importarMut.isPending ? (
                      "Importando..."
                    ) : (
                      <><CheckCircle2 className="h-4 w-4 mr-1" />Importar {selecionadas.length} lançamento(s)</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Configurações ── */}
          <TabsContent value="config" className="flex-1 min-h-0 p-5 overflow-auto mt-0">
            <div className="max-w-lg space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Banco / Instituição</Label>
                  <Input value={cfgBanco} onChange={e => setCfgBanco(e.target.value)} data-testid="input-cfg-banco" />
                </div>
                <div>
                  <Label>Agência</Label>
                  <Input value={cfgAgencia} onChange={e => setCfgAgencia(e.target.value)} data-testid="input-cfg-agencia" />
                </div>
                <div>
                  <Label>Conta</Label>
                  <Input value={cfgConta} onChange={e => setCfgConta(e.target.value)} data-testid="input-cfg-conta" />
                </div>
                <div className="col-span-2">
                  <Label>Tipo</Label>
                  <Select value={cfgTipo} onValueChange={setCfgTipo}>
                    <SelectTrigger data-testid="select-cfg-tipo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cc">Conta Corrente</SelectItem>
                      <SelectItem value="poupanca">Poupança</SelectItem>
                      <SelectItem value="caixa">Caixa</SelectItem>
                      <SelectItem value="carteira">Carteira Digital</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Plano de contas padrão (para conciliação)</Label>
                  <p className="text-xs text-muted-foreground mb-1">
                    Ao importar extratos, este plano será sugerido automaticamente em todas as linhas.
                  </p>
                  <Select value={cfgPlano} onValueChange={setCfgPlano}>
                    <SelectTrigger data-testid="select-cfg-plano"><SelectValue placeholder="— Nenhum —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— Nenhum —</SelectItem>
                      {planosAtivos.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.codigo} — {p.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {conta.planoContaId && cfgPlano !== NONE && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-2">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  Plano padrão atual: <strong>{planosAtivos.find(p => p.id === conta.planoContaId)?.descricao ?? conta.planoContaId}</strong>
                </div>
              )}

              <Button onClick={() => saveCfgMut.mutate()} disabled={saveCfgMut.isPending || !cfgBanco.trim()} data-testid="button-salvar-cfg-conta">
                {saveCfgMut.isPending ? "Salvando..." : "Salvar configurações"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
