import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInputBR } from "@/components/ui/date-input-br";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Split } from "lucide-react";
import { RateioCcDialog } from "@/components/control/RateioCcDialog";

interface Lancamento {
  id: string;
  tipo: "pagar" | "receber";
  descricao: string;
  favorecido?: string | null;
  documento?: string | null;
  valor: string;
  dataEmissao?: string | null;
  dataVencimento: string;
  dataPagamento?: string | null;
  status: string;
  planoContaId?: string | null;
  centroCustoId?: string | null;
  contaBancariaId?: string | null;
  tipoDocumentoId?: string | null;
  observacoes?: string | null;
}

interface PlanoConta { id: string; codigo: string; descricao: string; permiteLancamento: boolean; }
interface CentroCusto { id: string; codigo: string; nome: string; ativo: boolean; }
interface ContaBancaria { id: string; banco: string; agencia?: string | null; conta?: string | null; ativo: boolean; }
interface TipoDoc { id: string; nome: string; }

interface Props {
  lancamento: Lancamento;
  clienteId: string;
}

const NONE = "__none__";

export function EditLancamentoDialog({ lancamento, clienteId }: Props) {
  const [open, setOpen] = useState(false);
  const [rateioOpen, setRateioOpen] = useState(false);
  const [form, setForm] = useState<Partial<Lancamento>>({});
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => { if (open) setForm({ ...lancamento }); }, [open, lancamento]);

  const { data: planos = [] } = useQuery<PlanoConta[]>({ queryKey: ["/api/control/planos-contas"], enabled: open });
  const { data: centros = [] } = useQuery<CentroCusto[]>({ queryKey: ["/api/control/clientes", clienteId, "centros-custo"], enabled: open });
  const { data: contas = [] } = useQuery<ContaBancaria[]>({ queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"], enabled: open });
  const { data: tiposDoc = [] } = useQuery<TipoDoc[]>({ queryKey: ["/api/control/tipos-documento"], enabled: open });

  const salvar = useMutation({
    mutationFn: async () => {
      const payload: any = {
        tipo: form.tipo,
        descricao: form.descricao,
        favorecido: form.favorecido || null,
        documento: form.documento || null,
        valor: form.valor,
        dataEmissao: form.dataEmissao || null,
        dataVencimento: form.dataVencimento,
        dataPagamento: form.dataPagamento || null,
        status: form.status,
        planoContaId: form.planoContaId || null,
        centroCustoId: form.centroCustoId || null,
        contaBancariaId: form.contaBancariaId || null,
        tipoDocumentoId: form.tipoDocumentoId || null,
        observacoes: form.observacoes || null,
      };
      const r = await apiRequest("PATCH", `/api/control/lancamentos/${lancamento.id}`, payload);
      return await r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "lancamentos"] });
      qc.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "overview"] });
      toast({ title: "Lançamento atualizado" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Erro ao salvar", description: e?.message ?? "Falha", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`button-editar-${lancamento.id}`}>
        <Pencil className="h-4 w-4" />
      </Button>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input
              value={form.descricao ?? ""}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              data-testid="input-edit-descricao"
            />
          </div>

          <div>
            <Label>Tipo</Label>
            <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as any })}>
              <SelectTrigger data-testid="select-edit-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pagar">Pagar</SelectItem>
                <SelectItem value="receber">Receber</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger data-testid="select-edit-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="previsto">Previsto</SelectItem>
                <SelectItem value="aprovado">Aprovado</SelectItem>
                <SelectItem value="pago">Pago</SelectItem>
                <SelectItem value="vencido">Vencido</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
                <SelectItem value="inadimplente">Inadimplente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Favorecido</Label>
            <Input
              value={form.favorecido ?? ""}
              onChange={(e) => setForm({ ...form, favorecido: e.target.value })}
              data-testid="input-edit-favorecido"
            />
          </div>

          <div>
            <Label>Documento</Label>
            <Input
              value={form.documento ?? ""}
              onChange={(e) => setForm({ ...form, documento: e.target.value })}
              data-testid="input-edit-documento"
            />
          </div>

          <div>
            <Label>Valor</Label>
            <Input
              type="number"
              step="0.01"
              value={form.valor ?? ""}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
              data-testid="input-edit-valor"
            />
          </div>

          <div>
            <Label>Vencimento</Label>
            <DateInputBR
              value={form.dataVencimento ?? ""}
              onChange={(v) => setForm({ ...form, dataVencimento: v })}
              data-testid="input-edit-vencimento"
            />
          </div>

          <div>
            <Label>Emissão</Label>
            <DateInputBR
              value={form.dataEmissao ?? ""}
              onChange={(v) => setForm({ ...form, dataEmissao: v })}
              data-testid="input-edit-emissao"
            />
          </div>

          <div>
            <Label>Pagamento</Label>
            <DateInputBR
              value={form.dataPagamento ?? ""}
              onChange={(v) => setForm({ ...form, dataPagamento: v })}
              data-testid="input-edit-pagamento"
            />
          </div>

          <div>
            <Label>Plano de contas</Label>
            <Select
              value={form.planoContaId ?? NONE}
              onValueChange={(v) => setForm({ ...form, planoContaId: v === NONE ? null : v })}
            >
              <SelectTrigger data-testid="select-edit-plano"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {planos.filter((p) => p.permiteLancamento).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.codigo} — {p.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Centro de custo</Label>
            <Select
              value={form.centroCustoId ?? NONE}
              onValueChange={(v) => setForm({ ...form, centroCustoId: v === NONE ? null : v })}
            >
              <SelectTrigger data-testid="select-edit-centro"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {centros.filter((c) => c.ativo).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Tipo de documento</Label>
            <Select
              value={form.tipoDocumentoId ?? NONE}
              onValueChange={(v) => setForm({ ...form, tipoDocumentoId: v === NONE ? null : v })}
            >
              <SelectTrigger data-testid="select-edit-tipo-doc"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {tiposDoc.map((t) => (<SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Conta bancária</Label>
            <Select
              value={form.contaBancariaId ?? NONE}
              onValueChange={(v) => setForm({ ...form, contaBancariaId: v === NONE ? null : v })}
            >
              <SelectTrigger data-testid="select-edit-banco"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {contas.filter((c) => c.ativo).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.banco}{c.agencia ? ` • Ag ${c.agencia}` : ""}{c.conta ? ` • CC ${c.conta}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea
              rows={3}
              value={form.observacoes ?? ""}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              data-testid="input-edit-observacoes"
            />
          </div>
        </div>

        <DialogFooter className="flex flex-row justify-between sm:justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setRateioOpen(true)}
            data-testid="button-edit-abrir-rateio"
            className="gap-1"
          >
            <Split className="h-4 w-4" /> Rateio CC
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-edit-cancelar">Cancelar</Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="button-edit-salvar">
              {salvar.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <RateioCcDialog
        open={rateioOpen}
        onOpenChange={setRateioOpen}
        lancamentoId={lancamento.id}
        clienteId={clienteId}
        valorTotal={Number(form.valor ?? lancamento.valor ?? 0)}
      />
    </Dialog>
  );
}
