// Sprint C11 — G15 Wizard de Setup Guiado.
// 5 passos com progresso persistido em localStorage por clienteId.

import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, SkipForward, CheckCircle2, PartyPopper, Download } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STEPS = ["Contas Bancárias", "Saldo Inicial", "Plano de Contas", "Centros de Custo", "Primeiro Lançamento"];

export default function SetupWizard() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const key = `setup_wizard_:${clienteId}`;
  const [step, setStep] = useState(0);
  const [contaCriada, setContaCriada] = useState<{ id: string; banco: string } | null>(null);
  const [saldo, setSaldo] = useState("0");
  const [contaForm, setContaForm] = useState({ banco: "", agencia: "", conta: "", apelido: "" });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.step === "number") setStep(s.step);
      }
    } catch { /* ignore */ }
  }, [key]);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ step })); } catch { /* ignore */ }
  }, [step, key]);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const skip = () => next();
  const finalizar = () => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    toast({ title: "Setup concluído!", description: "Cliente pronto para operar." });
    navigate(`/control/${clienteId}`);
  };

  const criarConta = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/control/contas-bancarias", {
        clienteId,
        banco: contaForm.banco || "Conta Principal",
        agencia: contaForm.agencia || null,
        conta: contaForm.conta || null,
        apelido: contaForm.apelido || null,
        tipo: "cc",
        saldoInicial: "0",
        ativo: true,
      });
    },
    onSuccess: async (r: any) => {
      const data = await r.json?.();
      const id = data?.id ?? data?.conta?.id;
      setContaCriada({ id, banco: contaForm.apelido || contaForm.banco });
      toast({ title: "Conta criada" });
      queryClient.invalidateQueries({ queryKey: ["/api/control/clientes", clienteId, "contas-bancarias"] });
      next();
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const definirSaldo = useMutation({
    mutationFn: async () => {
      if (!contaCriada) return null;
      return apiRequest("POST", `/api/control/contas-bancarias/${contaCriada.id}/saldo-inicial`, {
        valor: saldo, data: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: () => { toast({ title: "Saldo registrado" }); next(); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const baixarTemplate = (tipo: string) => {
    window.location.href = `/api/control/templates/${tipo}`;
  };

  const progresso = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/control/${clienteId}`}>
          <Button variant="ghost" size="sm" data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
        </Link>
        <h1 className="text-2xl font-bold flex-1" data-testid="text-page-title">Setup do Cliente</h1>
      </div>

      <div>
        <div className="flex justify-between mb-2 text-sm">
          <span>Passo {step + 1} de {STEPS.length}: <strong>{STEPS[step]}</strong></span>
          <span className="text-muted-foreground" data-testid="text-progresso">{Math.round(progresso)}%</span>
        </div>
        <Progress value={progresso} data-testid="progress-wizard" />
        <div className="flex gap-1 mt-2">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 text-xs text-center p-1 rounded ${i < step ? "text-green-600" : i === step ? "font-semibold" : "text-muted-foreground"}`}>
              {i < step ? <CheckCircle2 className="h-3 w-3 inline mr-1" /> : null}{s}
            </div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{STEPS[step]}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <p className="text-sm text-muted-foreground">Cadastre a primeira conta bancária. Outras podem ser adicionadas depois.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Banco *</Label><Input value={contaForm.banco} onChange={(e) => setContaForm((f) => ({ ...f, banco: e.target.value }))} data-testid="input-banco" /></div>
                <div><Label>Apelido</Label><Input value={contaForm.apelido} onChange={(e) => setContaForm((f) => ({ ...f, apelido: e.target.value }))} placeholder="Ex.: Itaú Principal" data-testid="input-apelido" /></div>
                <div><Label>Agência</Label><Input value={contaForm.agencia} onChange={(e) => setContaForm((f) => ({ ...f, agencia: e.target.value }))} data-testid="input-agencia" /></div>
                <div><Label>Conta</Label><Input value={contaForm.conta} onChange={(e) => setContaForm((f) => ({ ...f, conta: e.target.value }))} data-testid="input-conta" /></div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => criarConta.mutate()} disabled={!contaForm.banco || criarConta.isPending} data-testid="button-criar-conta"><ArrowRight className="h-4 w-4 mr-1" /> Criar e Avançar</Button>
                <Button variant="outline" onClick={skip} data-testid="button-skip-1"><SkipForward className="h-4 w-4 mr-1" /> Pular</Button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="text-sm text-muted-foreground">Informe o saldo inicial da conta {contaCriada?.banco ?? "criada"}.</p>
              <div><Label>Saldo Inicial (R$)</Label><Input type="number" step="0.01" value={saldo} onChange={(e) => setSaldo(e.target.value)} data-testid="input-saldo" /></div>
              <div className="flex gap-2">
                <Button onClick={() => contaCriada ? definirSaldo.mutate() : next()} disabled={definirSaldo.isPending} data-testid="button-salvar-saldo"><ArrowRight className="h-4 w-4 mr-1" /> Salvar e Avançar</Button>
                <Button variant="outline" onClick={skip} data-testid="button-skip-2"><SkipForward className="h-4 w-4 mr-1" /> Pular</Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm text-muted-foreground">Configure o plano de contas. Use o template CSV ou crie depois manualmente.</p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={() => baixarTemplate("plano_contas")} data-testid="button-template-plano"><Download className="h-4 w-4 mr-1" /> Template Plano de Contas</Button>
                <Link href={`/control/${clienteId}?tab=plano-contas`}><Button variant="outline" data-testid="button-abrir-plano">Abrir Plano de Contas</Button></Link>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={next} data-testid="button-next-3"><ArrowRight className="h-4 w-4 mr-1" /> Continuar</Button>
                <Button variant="outline" onClick={skip} data-testid="button-skip-3"><SkipForward className="h-4 w-4 mr-1" /> Pular</Button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">Cadastre os centros de custo via CSV ou diretamente na tela específica.</p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={() => baixarTemplate("centros_custo")} data-testid="button-template-cc"><Download className="h-4 w-4 mr-1" /> Template CCs</Button>
                <Link href={`/control/${clienteId}/centros-custo`}><Button variant="outline" data-testid="button-abrir-cc">Abrir Centros de Custo</Button></Link>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={next} data-testid="button-next-4"><ArrowRight className="h-4 w-4 mr-1" /> Continuar</Button>
                <Button variant="outline" onClick={skip} data-testid="button-skip-4"><SkipForward className="h-4 w-4 mr-1" /> Pular</Button>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <div className="flex items-center gap-2 text-green-600">
                <PartyPopper className="h-6 w-6" />
                <span className="text-lg font-semibold">Setup quase concluído!</span>
              </div>
              <p className="text-sm">Você pode lançar a primeira movimentação agora ou ir direto para o Dashboard.</p>
              <div className="flex gap-2">
                <Link href={`/control/${clienteId}?tab=lancamentos`}><Button variant="outline" data-testid="button-primeiro-lanc">Lançar movimentação</Button></Link>
                <Button onClick={finalizar} data-testid="button-finalizar"><CheckCircle2 className="h-4 w-4 mr-1" /> Finalizar e ir ao Dashboard</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
