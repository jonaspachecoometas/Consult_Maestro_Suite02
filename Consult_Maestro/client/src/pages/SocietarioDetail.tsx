import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft, Building2, Users, FileText, ClipboardList, ShieldCheck, History,
  Plus, Save, Trash2, CheckCircle2, AlertTriangle, Calendar as CalendarIcon, Pencil, Bot,
  Upload, Download, Paperclip, Sparkles, Eye, ExternalLink, FileSpreadsheet, Image as ImageIcon, FileType2,
  KanbanSquare, Lock, ArrowRight,
} from "lucide-react";
import { SocietarioAgentChat } from "@/components/societario/SocietarioAgentChat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import PipelineSocietario from "@/pages/societario/Pipeline";
import type {
  Sociedade, Socio, AlteracaoSocietaria, DocumentoSocietario,
  ObrigacaoSocietaria, CertificadoDigital,
} from "@shared/schema";

const REGIMES = [
  { value: "simples", label: "Simples Nacional" },
  { value: "mei", label: "MEI" },
  { value: "lucro_presumido", label: "Lucro Presumido" },
  { value: "lucro_real", label: "Lucro Real" },
  { value: "imune", label: "Imune" },
];
const NATUREZAS = [
  { value: "ltda", label: "Sociedade Limitada (LTDA)" },
  { value: "sa", label: "Sociedade Anônima (S/A)" },
  { value: "eireli", label: "EIRELI" },
  { value: "mei", label: "MEI" },
  { value: "slu", label: "Sociedade Limitada Unipessoal" },
  { value: "sociedade_simples", label: "Sociedade Simples" },
];
const STATUS_SOCIEDADE = [
  { value: "ativa", label: "Ativa" },
  { value: "em_constituicao", label: "Em constituição" },
  { value: "inativa", label: "Inativa" },
  { value: "em_baixa", label: "Em baixa" },
  { value: "baixada", label: "Baixada" },
];
const QUALIFICACOES = [
  { value: "socio", label: "Sócio" },
  { value: "administrador", label: "Administrador" },
  { value: "socio_administrador", label: "Sócio-administrador" },
  { value: "conselheiro", label: "Conselheiro" },
];
const TIPOS_ALTERACAO = [
  { value: "constituicao", label: "Constituição" },
  { value: "alteracao_contratual", label: "Alteração contratual" },
  { value: "cessao_cotas", label: "Cessão de cotas" },
  { value: "mudanca_regime", label: "Mudança de regime" },
  { value: "mudanca_endereco", label: "Mudança de endereço" },
  { value: "entrada_socio", label: "Entrada de sócio" },
  { value: "saida_socio", label: "Saída de sócio" },
  { value: "aumento_capital", label: "Aumento de capital" },
  { value: "reducao_capital", label: "Redução de capital" },
  { value: "mudanca_objeto", label: "Mudança de objeto" },
  { value: "distrato", label: "Distrato" },
];
const TIPOS_DOCUMENTO = [
  { value: "contrato_social", label: "Contrato social" },
  { value: "ata", label: "Ata" },
  { value: "distrato", label: "Distrato" },
  { value: "procuracao", label: "Procuração" },
  { value: "certidao", label: "Certidão" },
  { value: "alvara", label: "Alvará" },
  { value: "licenca", label: "Licença" },
  { value: "outro", label: "Outro" },
];
const TIPOS_OBRIGACAO = [
  { value: "certidao_negativa", label: "Certidão negativa" },
  { value: "renovacao_alvara", label: "Renovação de alvará" },
  { value: "assembleia", label: "Assembleia" },
  { value: "declaracao_anual", label: "Declaração anual" },
  { value: "renovacao_certificado", label: "Renovação de certificado" },
  { value: "livro_diario", label: "Livro diário" },
  { value: "outro", label: "Outro" },
];
const PERIODICIDADES = [
  { value: "unica", label: "Única" },
  { value: "mensal", label: "Mensal" },
  { value: "trimestral", label: "Trimestral" },
  { value: "semestral", label: "Semestral" },
  { value: "anual", label: "Anual" },
];

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  try {
    const date = typeof d === "string" ? new Date(d.includes("T") ? d : d + "T00:00:00") : d;
    return date.toLocaleDateString("pt-BR");
  } catch { return String(d); }
};
const fmtBrl = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (n == null || Number.isNaN(n)) return "R$ 0,00";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export default function SocietarioDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [tab, setTab] = useState("visao");
  const [chatOpen, setChatOpen] = useState(false);

  const { data: sociedade, isLoading } = useQuery<Sociedade>({
    queryKey: ["/api/societario/sociedades", id],
  });

  if (isLoading) {
    return <div className="container mx-auto p-6 space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }
  if (!sociedade) {
    return (
      <div className="container mx-auto p-6">
        <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="text-not-found">
          Sociedade não encontrada.
          <div className="mt-4"><Link href="/societario"><Button variant="outline" size="sm"><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button></Link></div>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-4" data-testid="page-societario-detail">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Link href="/societario"><Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold flex items-center gap-2 truncate">
              <Building2 className="h-6 w-6 shrink-0" /> {sociedade.razaoSocial}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
              {sociedade.cnpj && <span data-testid="text-cnpj">{sociedade.cnpj}</span>}
              {sociedade.nomeFantasia && <span>· {sociedade.nomeFantasia}</span>}
              <Badge variant="outline">{NATUREZAS.find((n) => n.value === sociedade.naturezaJuridica)?.label || sociedade.naturezaJuridica}</Badge>
              <Badge variant="outline">{REGIMES.find((r) => r.value === sociedade.regimeTributario)?.label || sociedade.regimeTributario}</Badge>
              <Badge>{STATUS_SOCIEDADE.find((s) => s.value === sociedade.status)?.label || sociedade.status}</Badge>
            </div>
          </div>
        </div>
        <Button variant="outline" onClick={() => setChatOpen(true)} data-testid="button-open-agent">
          <Bot className="h-4 w-4 mr-2" /> Agente Societário
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 md:grid-cols-7 w-full md:w-auto">
          <TabsTrigger value="visao" data-testid="tab-visao"><Building2 className="h-4 w-4 mr-1" />Visão geral</TabsTrigger>
          <TabsTrigger value="socios" data-testid="tab-socios"><Users className="h-4 w-4 mr-1" />Sócios</TabsTrigger>
          <TabsTrigger value="alteracoes" data-testid="tab-alteracoes"><History className="h-4 w-4 mr-1" />Alterações</TabsTrigger>
          <TabsTrigger value="documentos" data-testid="tab-documentos"><FileText className="h-4 w-4 mr-1" />Documentos</TabsTrigger>
          <TabsTrigger value="processos" data-testid="tab-processos"><KanbanSquare className="h-4 w-4 mr-1" />Processos</TabsTrigger>
          <TabsTrigger value="obrigacoes" data-testid="tab-obrigacoes"><ClipboardList className="h-4 w-4 mr-1" />Obrigações</TabsTrigger>
          <TabsTrigger value="certificados" data-testid="tab-certificados"><ShieldCheck className="h-4 w-4 mr-1" />Certificados</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-4"><VisaoGeralTab sociedade={sociedade} /></TabsContent>
        <TabsContent value="socios" className="mt-4"><SociosTab sociedadeId={sociedade.id} /></TabsContent>
        <TabsContent value="alteracoes" className="mt-4"><AlteracoesTab sociedadeId={sociedade.id} /></TabsContent>
        <TabsContent value="documentos" className="mt-4"><DocumentosTab sociedadeId={sociedade.id} /></TabsContent>
        <TabsContent value="processos" className="mt-4"><ProcessosTab sociedadeId={sociedade.id} /></TabsContent>
        <TabsContent value="obrigacoes" className="mt-4"><ObrigacoesTab sociedadeId={sociedade.id} /></TabsContent>
        <TabsContent value="certificados" className="mt-4"><CertificadosTab sociedadeId={sociedade.id} /></TabsContent>
      </Tabs>

      <SocietarioAgentChat
        open={chatOpen}
        onOpenChange={setChatOpen}
        sociedadeId={sociedade.id}
        sociedadeName={sociedade.razaoSocial}
      />
    </div>
  );
}

// ===========================================================================
// VISÃO GERAL
// ===========================================================================
function VisaoGeralTab({ sociedade }: { sociedade: Sociedade }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Sociedade>>(sociedade);

  const update = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/societario/sociedades/${sociedade.id}`, form),
    onSuccess: () => {
      toast({ title: "Sociedade atualizada" });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades"] });
      queryClient.invalidateQueries({ queryKey: ["/api/societario/sociedades", sociedade.id] });
      setEditing(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Dados cadastrais</CardTitle>
          {!editing ? (
            <Button size="sm" variant="outline" onClick={() => { setForm(sociedade); setEditing(true); }} data-testid="button-edit-sociedade"><Pencil className="h-4 w-4 mr-1" />Editar</Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button size="sm" onClick={() => update.mutate()} disabled={update.isPending} data-testid="button-save-sociedade"><Save className="h-4 w-4 mr-1" />Salvar</Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!editing ? (
            <>
              <Field label="Razão social" value={sociedade.razaoSocial} />
              <Field label="Nome fantasia" value={sociedade.nomeFantasia || "—"} />
              <Field label="CNPJ" value={sociedade.cnpj || "—"} />
              <Field label="Inscrição estadual" value={sociedade.inscricaoEstadual || "—"} />
              <Field label="Inscrição municipal" value={sociedade.inscricaoMunicipal || "—"} />
              <Field label="Capital social" value={fmtBrl(sociedade.capitalSocial)} />
              <Field label="Data de constituição" value={fmtDate(sociedade.dataConstituicao)} />
              <Field label="CNAE principal" value={sociedade.cnaePrincipal || "—"} />
            </>
          ) : (
            <>
              <FieldEdit label="Razão social *" value={form.razaoSocial || ""} onChange={(v) => setForm({ ...form, razaoSocial: v })} testId="input-razao-edit" />
              <FieldEdit label="Nome fantasia" value={form.nomeFantasia || ""} onChange={(v) => setForm({ ...form, nomeFantasia: v })} />
              <FieldEdit label="CNPJ" value={form.cnpj || ""} onChange={(v) => setForm({ ...form, cnpj: v })} />
              <FieldEdit label="Inscrição estadual" value={form.inscricaoEstadual || ""} onChange={(v) => setForm({ ...form, inscricaoEstadual: v })} />
              <FieldEdit label="Inscrição municipal" value={form.inscricaoMunicipal || ""} onChange={(v) => setForm({ ...form, inscricaoMunicipal: v })} />
              <FieldEdit label="Capital social (R$)" type="number" value={String(form.capitalSocial ?? "0")} onChange={(v) => setForm({ ...form, capitalSocial: v as any })} />
              <FieldEdit label="Data de constituição" type="date" value={(form.dataConstituicao as string) || ""} onChange={(v) => setForm({ ...form, dataConstituicao: v as any })} />
              <FieldEdit label="CNAE principal" value={form.cnaePrincipal || ""} onChange={(v) => setForm({ ...form, cnaePrincipal: v })} />
              <div className="grid grid-cols-3 gap-2">
                <SelectField label="Natureza" value={form.naturezaJuridica || "ltda"} onChange={(v) => setForm({ ...form, naturezaJuridica: v })} options={NATUREZAS} />
                <SelectField label="Regime" value={form.regimeTributario || "simples"} onChange={(v) => setForm({ ...form, regimeTributario: v })} options={REGIMES} />
                <SelectField label="Status" value={form.status || "ativa"} onChange={(v) => setForm({ ...form, status: v })} options={STATUS_SOCIEDADE} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Endereço & objeto social</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!editing ? (
            <>
              <Field label="Logradouro" value={[sociedade.enderecoLogradouro, sociedade.enderecoNumero].filter(Boolean).join(", ") || "—"} />
              <Field label="Complemento" value={sociedade.enderecoComplemento || "—"} />
              <Field label="Bairro / Cidade / UF" value={[sociedade.enderecoBairro, sociedade.enderecoCidade, sociedade.enderecoUf].filter(Boolean).join(" / ") || "—"} />
              <Field label="CEP" value={sociedade.enderecoCep || "—"} />
              <div>
                <div className="text-xs text-muted-foreground mb-1">Objeto social</div>
                <div className="whitespace-pre-wrap">{sociedade.objetoSocial || "—"}</div>
              </div>
              {sociedade.observacoes && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Observações</div>
                  <div className="whitespace-pre-wrap">{sociedade.observacoes}</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><FieldEdit label="Logradouro" value={form.enderecoLogradouro || ""} onChange={(v) => setForm({ ...form, enderecoLogradouro: v })} /></div>
                <FieldEdit label="Número" value={form.enderecoNumero || ""} onChange={(v) => setForm({ ...form, enderecoNumero: v })} />
              </div>
              <FieldEdit label="Complemento" value={form.enderecoComplemento || ""} onChange={(v) => setForm({ ...form, enderecoComplemento: v })} />
              <div className="grid grid-cols-3 gap-2">
                <FieldEdit label="Bairro" value={form.enderecoBairro || ""} onChange={(v) => setForm({ ...form, enderecoBairro: v })} />
                <FieldEdit label="Cidade" value={form.enderecoCidade || ""} onChange={(v) => setForm({ ...form, enderecoCidade: v })} />
                <FieldEdit label="UF" value={form.enderecoUf || ""} onChange={(v) => setForm({ ...form, enderecoUf: v.toUpperCase().slice(0, 2) })} />
              </div>
              <FieldEdit label="CEP" value={form.enderecoCep || ""} onChange={(v) => setForm({ ...form, enderecoCep: v })} />
              <div className="grid gap-1.5">
                <Label className="text-xs">Objeto social</Label>
                <Textarea rows={4} value={form.objetoSocial || ""} onChange={(e) => setForm({ ...form, objetoSocial: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea rows={3} value={form.observacoes || ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return <div className="grid grid-cols-[160px_1fr] gap-2"><div className="text-muted-foreground text-xs pt-0.5">{label}</div><div className="break-words">{value}</div></div>;
}
function FieldEdit({ label, value, onChange, type = "text", testId }: { label: string; value: string; onChange: (v: string) => void; type?: string; testId?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
    </div>
  );
}
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

// ===========================================================================
// SÓCIOS
// ===========================================================================
function SociosTab({ sociedadeId }: { sociedadeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Socio | null>(null);
  const empty = { nome: "", tipoPessoa: "pf", cpfCnpj: "", qualificacao: "socio", percentualParticipacao: "0", valorIntegralizado: "0", email: "", telefone: "" };
  const [form, setForm] = useState<any>(empty);

  const { data: socios = [], isLoading } = useQuery<Socio[]>({
    queryKey: [`/api/societario/sociedades/${sociedadeId}/socios`],
  });

  const totalPercent = socios.reduce((sum, s) => sum + Number(s.percentualParticipacao || 0), 0);

  const save = useMutation({
    mutationFn: async () => editing
      ? apiRequest("PATCH", `/api/societario/socios/${editing.id}`, form)
      : apiRequest("POST", `/api/societario/sociedades/${sociedadeId}/socios`, form),
    onSuccess: () => {
      toast({ title: editing ? "Sócio atualizado" : "Sócio adicionado" });
      queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/socios`] });
      setOpen(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (sid: string) => apiRequest("DELETE", `/api/societario/socios/${sid}`),
    onSuccess: () => {
      toast({ title: "Sócio removido" });
      queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/socios`] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (s: Socio) => {
    setEditing(s);
    setForm({
      nome: s.nome, tipoPessoa: s.tipoPessoa || "pf", cpfCnpj: s.cpfCnpj || "",
      qualificacao: s.qualificacao || "socio",
      percentualParticipacao: String(s.percentualParticipacao || "0"),
      valorIntegralizado: String(s.valorIntegralizado || "0"),
      email: s.email || "", telefone: s.telefone || "",
    });
    setOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Quadro societário</CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            Total de participação: <span className={totalPercent !== 100 && socios.length > 0 ? "text-amber-600 font-medium" : "font-medium"}>{totalPercent.toFixed(2)}%</span>
            {socios.length > 0 && totalPercent !== 100 && <span className="ml-2">(deve somar 100%)</span>}
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew} data-testid="button-new-socio"><Plus className="h-4 w-4 mr-1" />Novo sócio</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editing ? "Editar sócio" : "Novo sócio"}</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <FieldEdit label="Nome *" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} testId="input-socio-nome" />
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Tipo pessoa" value={form.tipoPessoa} onChange={(v) => setForm({ ...form, tipoPessoa: v })} options={[{ value: "pf", label: "Pessoa física" }, { value: "pj", label: "Pessoa jurídica" }]} />
                <FieldEdit label={form.tipoPessoa === "pj" ? "CNPJ" : "CPF"} value={form.cpfCnpj} onChange={(v) => setForm({ ...form, cpfCnpj: v })} />
                <SelectField label="Qualificação" value={form.qualificacao} onChange={(v) => setForm({ ...form, qualificacao: v })} options={QUALIFICACOES} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldEdit label="% Participação" type="number" value={form.percentualParticipacao} onChange={(v) => setForm({ ...form, percentualParticipacao: v })} />
                <FieldEdit label="Valor integralizado (R$)" type="number" value={form.valorIntegralizado} onChange={(v) => setForm({ ...form, valorIntegralizado: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldEdit label="E-mail" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                <FieldEdit label="Telefone" value={form.telefone} onChange={(v) => setForm({ ...form, telefone: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={!form.nome || save.isPending} data-testid="button-save-socio">{save.isPending ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : socios.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-socios-empty">Nenhum sócio cadastrado.</div>
        ) : (
          <div className="space-y-2">
            {socios.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-md border" data-testid={`row-socio-${s.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{s.nome}</div>
                  <div className="text-xs text-muted-foreground flex gap-3 flex-wrap mt-0.5">
                    {s.cpfCnpj && <span>{s.cpfCnpj}</span>}
                    <span>{QUALIFICACOES.find((q) => q.value === s.qualificacao)?.label || s.qualificacao}</span>
                    {s.email && <span>· {s.email}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className="font-semibold">{Number(s.percentualParticipacao || 0).toFixed(2)}%</div>
                    <div className="text-xs text-muted-foreground">{fmtBrl(s.valorIntegralizado)}</div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(s)} data-testid={`button-edit-socio-${s.id}`}><Pencil className="h-4 w-4" /></Button>
                  <ConfirmDelete onConfirm={() => remove.mutate(s.id)} testId={`button-delete-socio-${s.id}`} title="Remover sócio?" />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmDelete({ onConfirm, testId, title }: { onConfirm: () => void; testId: string; title: string }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Excluir" data-testid={testId}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ===========================================================================
// ALTERAÇÕES
// ===========================================================================
function AlteracoesTab({ sociedadeId }: { sociedadeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const empty = { tipo: "alteracao_contratual", descricao: "", dataEvento: new Date().toISOString().slice(0, 10), orgaoRegistro: "", numeroRegistro: "", status: "registrada" };
  const [form, setForm] = useState<any>(empty);

  const { data: rows = [], isLoading } = useQuery<AlteracaoSocietaria[]>({
    queryKey: [`/api/societario/sociedades/${sociedadeId}/alteracoes`],
  });

  const invalidateAlteracoes = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/alteracoes`] });
    // Painel tenant-wide e contadores na lista de /societario.
    queryClient.invalidateQueries({ queryKey: ["/api/societario/alteracoes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/societario/alteracoes/pendentes-por-sociedade"] });
    queryClient.invalidateQueries({ queryKey: ["/api/societario/dashboard"] });
  };

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/societario/sociedades/${sociedadeId}/alteracoes`, form),
    onSuccess: () => {
      toast({ title: "Alteração registrada" });
      invalidateAlteracoes();
      setOpen(false); setForm(empty);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/societario/alteracoes/${id}`),
    onSuccess: () => { toast({ title: "Alteração removida" }); invalidateAlteracoes(); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Histórico de alterações</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-alteracao"><Plus className="h-4 w-4 mr-1" />Nova alteração</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Registrar alteração societária</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Tipo *" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={TIPOS_ALTERACAO} />
                <FieldEdit label="Data do evento *" type="date" value={form.dataEvento} onChange={(v) => setForm({ ...form, dataEvento: v })} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Descrição *</Label>
                <Textarea rows={4} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descreva a alteração ocorrida..." data-testid="input-alteracao-descricao" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Órgão de registro" value={form.orgaoRegistro || "jucemg"} onChange={(v) => setForm({ ...form, orgaoRegistro: v })} options={[{ value: "jucemg", label: "JUCEMG" }, { value: "jucesp", label: "JUCESP" }, { value: "rfb", label: "Receita Federal" }, { value: "prefeitura", label: "Prefeitura" }, { value: "cartorio", label: "Cartório" }]} />
                <FieldEdit label="Nº registro" value={form.numeroRegistro} onChange={(v) => setForm({ ...form, numeroRegistro: v })} />
                <SelectField label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: "pendente", label: "Pendente" }, { value: "registrada", label: "Registrada" }, { value: "cancelada", label: "Cancelada" }]} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => create.mutate()} disabled={!form.descricao || !form.dataEvento || create.isPending} data-testid="button-save-alteracao">{create.isPending ? "Salvando..." : "Registrar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-alteracoes-empty">Nenhuma alteração registrada.</div>
        ) : (
          <div className="space-y-3">
            {rows.map((a) => (
              <div key={a.id} className="border-l-2 border-primary pl-4 py-2" data-testid={`row-alteracao-${a.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{TIPOS_ALTERACAO.find((t) => t.value === a.tipo)?.label || a.tipo}</span>
                      <Badge variant="outline" className="text-xs">{a.status}</Badge>
                      <span className="text-xs text-muted-foreground">{fmtDate(a.dataEvento)}</span>
                    </div>
                    <div className="text-sm mt-1 whitespace-pre-wrap">{a.descricao}</div>
                    {(a.orgaoRegistro || a.numeroRegistro) && (
                      <div className="text-xs text-muted-foreground mt-1">
                        {a.orgaoRegistro && <span>{a.orgaoRegistro.toUpperCase()}</span>}
                        {a.numeroRegistro && <span> · Nº {a.numeroRegistro}</span>}
                      </div>
                    )}
                  </div>
                  <ConfirmDelete onConfirm={() => remove.mutate(a.id)} testId={`button-delete-alteracao-${a.id}`} title="Remover alteração?" />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// DOCUMENTOS
// ===========================================================================
function fmtBytes(n?: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function DocumentosTab({ sociedadeId }: { sociedadeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const empty = { tipo: "contrato_social", titulo: "", descricao: "", numeroDocumento: "", dataDocumento: "", dataValidade: "", conteudoMarkdown: "" };
  const [form, setForm] = useState<any>(empty);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<DocumentoSocietario | null>(null);

  const { data: rows = [], isLoading } = useQuery<DocumentoSocietario[]>({
    queryKey: [`/api/societario/sociedades/${sociedadeId}/documentos`],
  });

  const resetAll = () => { setForm(empty); setFile(null); };

  // Cria documento. Se houver `file`, faz upload PUT na URL assinada antes
  // e envia uploadURL+meta no POST para o backend baixar e extrair texto.
  const create = useMutation({
    mutationFn: async () => {
      let payload: any = { ...form };

      if (file) {
        setUploading(true);
        // 1. Pede URL assinada de upload
        const urlRes = await apiRequest(
          "POST",
          `/api/societario/sociedades/${sociedadeId}/documentos/upload-url`,
          {},
        );
        const { uploadURL, uploadToken } = await urlRes.json();
        if (!uploadURL || !uploadToken) throw new Error("Falha ao obter URL de upload");

        // 2. PUT direto no Object Storage
        const putRes = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!putRes.ok) throw new Error(`Upload falhou (${putRes.status})`);

        // 3. Default do título com nome do arquivo se vazio
        if (!payload.titulo) payload.titulo = file.name;

        payload = {
          ...payload,
          uploadURL,
          uploadToken,
          fileName: file.name,
          fileMime: file.type || "application/octet-stream",
          fileSize: file.size,
        };
      }
      return apiRequest("POST", `/api/societario/sociedades/${sociedadeId}/documentos`, payload);
    },
    onSuccess: async (res: any) => {
      const json = await res.json().catch(() => ({}));
      const warning = json?._warning;
      toast({
        title: "Documento adicionado",
        description: warning ? `Atenção: ${warning}` : "Salvo com sucesso. O agente já pode lê-lo.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/documentos`] });
      setOpen(false); resetAll();
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
    onSettled: () => setUploading(false),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/societario/documentos/${id}`),
    onSuccess: () => { toast({ title: "Documento removido" }); queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/documentos`] }); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  // Re-extração: dispara OCR (Claude) para documentos sem texto extraído.
  // Usado quando o PDF é escaneado, a imagem precisa ser lida ou a primeira
  // tentativa de extração falhou.
  const [reextractingId, setReextractingId] = useState<string | null>(null);
  const reextract = useMutation({
    mutationFn: async (id: string) => {
      setReextractingId(id);
      const r = await apiRequest("POST", `/api/societario/documentos/${id}/reextract`, {});
      return r.json();
    },
    onSuccess: (data: any) => {
      if (data?.ok) {
        toast({ title: "Texto extraído", description: `${data.chars} caracteres lidos. O Agente já consegue consultar.` });
        queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/documentos`] });
      } else {
        toast({
          title: "Não foi possível extrair texto",
          description: data?.message || "Arquivo ilegível para OCR.",
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
    onSettled: () => setReextractingId(null),
  });

  const canSave = (!!form.titulo || !!file) && !create.isPending && !uploading;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Documentos societários</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Faça upload de PDFs, DOCX, planilhas e imagens. O texto é extraído automaticamente para o Agente Societário consultar.
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetAll(); }}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-documento"><Plus className="h-4 w-4 mr-1" />Novo documento</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Novo documento</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <SelectField label="Tipo *" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={TIPOS_DOCUMENTO} />
                <FieldEdit label="Nº documento" value={form.numeroDocumento} onChange={(v) => setForm({ ...form, numeroDocumento: v })} />
              </div>
              <FieldEdit label="Título *" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} testId="input-documento-titulo" />
              <div className="grid grid-cols-2 gap-3">
                <FieldEdit label="Data do documento" type="date" value={form.dataDocumento} onChange={(v) => setForm({ ...form, dataDocumento: v })} />
                <FieldEdit label="Data de validade" type="date" value={form.dataValidade} onChange={(v) => setForm({ ...form, dataValidade: v })} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea rows={2} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
              </div>

              {/* Upload de arquivo */}
              <div className="grid gap-1.5">
                <Label className="text-xs flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Arquivo (PDF, DOCX, XLSX, imagens — até 25 MB)</Label>
                <Input
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setFile(f);
                    if (f && !form.titulo) setForm({ ...form, titulo: f.name });
                  }}
                  data-testid="input-documento-arquivo"
                />
                {file && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2" data-testid="text-arquivo-selecionado">
                    <FileText className="h-3 w-3" />
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0">· {fmtBytes(file.size)}</span>
                    <button type="button" className="text-destructive underline" onClick={() => setFile(null)}>remover</button>
                  </div>
                )}
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Para PDF, DOCX, XLSX, CSV ou texto, o conteúdo é extraído automaticamente para o Agente Societário. Imagens são apenas anexadas para download.
                </span>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-xs">Conteúdo em texto/markdown (opcional, alternativa ao arquivo)</Label>
                <Textarea rows={4} value={form.conteudoMarkdown} onChange={(e) => setForm({ ...form, conteudoMarkdown: e.target.value })} placeholder="Cole aqui o texto integral do documento ou anotações..." />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetAll(); }}>Cancelar</Button>
              <Button onClick={() => create.mutate()} disabled={!canSave} data-testid="button-save-documento">
                {uploading ? <><Upload className="h-4 w-4 mr-1 animate-pulse" />Enviando...</> : create.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-documentos-empty">Nenhum documento cadastrado.</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((d) => {
              const hasFile = !!d.storagePath;
              const hasText = !!(d.textoExtraido || d.conteudoMarkdown);
              return (
                <div key={d.id} className="p-3 rounded-md border flex items-start gap-3" data-testid={`row-documento-${d.id}`}>
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={d.titulo}>{d.titulo}</div>
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                      <Badge variant="outline" className="text-[10px]">{TIPOS_DOCUMENTO.find((t) => t.value === d.tipo)?.label || d.tipo}</Badge>
                      {d.dataDocumento && <span>{fmtDate(d.dataDocumento)}</span>}
                      {d.dataValidade && <span className="text-amber-600">Vence: {fmtDate(d.dataValidade)}</span>}
                      {d.tamanhoBytes != null && <span>· {fmtBytes(d.tamanhoBytes)}</span>}
                      {hasText && (
                        <Badge variant="secondary" className="text-[10px] gap-1" data-testid={`badge-texto-agente-${d.id}`}>
                          <Sparkles className="h-2.5 w-2.5" /> texto p/ agente
                        </Badge>
                      )}
                      {hasFile && !hasText && (
                        <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700" data-testid={`badge-sem-texto-${d.id}`}>
                          <AlertTriangle className="h-2.5 w-2.5" /> sem texto p/ agente
                        </Badge>
                      )}
                    </div>
                    {d.descricao && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{d.descricao}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {(hasFile || hasText) && (
                      <button
                        type="button"
                        onClick={() => setPreview(d)}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-accent"
                        title="Abrir documento"
                        data-testid={`button-open-documento-${d.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                    {hasFile && !hasText && (
                      <button
                        type="button"
                        onClick={() => reextract.mutate(d.id)}
                        disabled={reextract.isPending && reextractingId === d.id}
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-accent disabled:opacity-50"
                        title="Extrair texto do arquivo (OCR para PDFs escaneados/imagens)"
                        data-testid={`button-reextract-documento-${d.id}`}
                      >
                        <Sparkles className={`h-4 w-4 ${reextract.isPending && reextractingId === d.id ? "animate-pulse" : ""}`} />
                      </button>
                    )}
                    {hasFile && (
                      <a
                        href={`/api/societario/documentos/${d.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md border hover:bg-accent"
                        title="Baixar arquivo original"
                        data-testid={`button-download-documento-${d.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    <ConfirmDelete onConfirm={() => remove.mutate(d.id)} testId={`button-delete-documento-${d.id}`} title="Remover documento?" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <DocumentoPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PREVIEW DE DOCUMENTO — escolhe renderizador conforme o mimeType original
// (mantém o arquivo intocado: PDF/imagem renderizam inline via stream privado;
// texto/markdown/json/csv lêem o conteúdo bruto; DOCX/XLSX usam o texto já
// extraído no upload — com botão claro para baixar o original).
// ---------------------------------------------------------------------------
function DocumentoPreviewDialog({ doc, onClose }: { doc: DocumentoSocietario | null; onClose: () => void }) {
  const open = !!doc;
  const mime = (doc?.mimeType || "").toLowerCase();
  const inlineUrl = doc ? `/api/societario/documentos/${doc.id}/download?inline=1` : "";
  const downloadUrl = doc ? `/api/societario/documentos/${doc.id}/download` : "";

  const isPdf = mime === "application/pdf";
  const isImage = mime.startsWith("image/");
  const isPlainText = mime.startsWith("text/") || mime === "application/json";
  const isOffice =
    mime.startsWith("application/vnd.openxmlformats-officedocument") ||
    mime === "application/msword" || mime === "application/vnd.ms-excel";

  const [textContent, setTextContent] = useState<string>("");
  const [textLoading, setTextLoading] = useState(false);

  // Carrega texto bruto quando for txt/md/json/csv. Reset ao trocar/fechar doc.
  useEffect(() => {
    if (!open || !doc?.id || !isPlainText) {
      setTextContent("");
      setTextLoading(false);
      return;
    }
    let cancelled = false;
    setTextLoading(true);
    setTextContent("");
    fetch(inlineUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (!cancelled) setTextContent(t.slice(0, 200_000)); })
      .catch((e) => { if (!cancelled) setTextContent(`[Falha ao carregar conteúdo: ${e.message}]`); })
      .finally(() => { if (!cancelled) setTextLoading(false); });
    return () => { cancelled = true; };
  }, [open, doc?.id, isPlainText, inlineUrl]);

  const titulo = doc?.titulo || "Documento";
  const subtitulo = [
    TIPOS_DOCUMENTO.find((t) => t.value === doc?.tipo)?.label || doc?.tipo,
    doc?.tamanhoBytes != null ? fmtBytes(doc.tamanhoBytes) : null,
    doc?.mimeType || null,
  ].filter(Boolean).join(" · ");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col gap-3 p-0 overflow-hidden"
        data-testid="dialog-preview-documento"
      >
        <DialogHeader className="px-6 pt-5">
          <DialogTitle className="flex items-center gap-2 truncate" title={titulo}>
            {isImage ? <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" />
              : isPdf ? <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
              : isOffice ? <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0" />
              : <FileType2 className="h-5 w-5 text-muted-foreground shrink-0" />}
            <span className="truncate">{titulo}</span>
          </DialogTitle>
          {subtitulo && <div className="text-xs text-muted-foreground">{subtitulo}</div>}
        </DialogHeader>

        <div className="flex-1 min-h-0 px-6 overflow-hidden">
          {!doc?.storagePath && doc?.conteudoMarkdown ? (
            <pre className="h-full overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono" data-testid="preview-markdown">
              {doc.conteudoMarkdown}
            </pre>
          ) : isPdf ? (
            <iframe
              src={inlineUrl}
              className="w-full h-[70vh] rounded-md border bg-white"
              title={titulo}
              data-testid="preview-pdf"
            />
          ) : isImage ? (
            <div className="h-[70vh] rounded-md border bg-muted/30 flex items-center justify-center overflow-auto">
              <img
                src={inlineUrl}
                alt={titulo}
                className="max-w-full max-h-full object-contain"
                data-testid="preview-image"
              />
            </div>
          ) : isPlainText ? (
            <pre className="h-[70vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono" data-testid="preview-text">
              {textLoading ? "Carregando…" : textContent}
            </pre>
          ) : isOffice ? (
            <div className="h-[70vh] flex flex-col gap-2">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                Pré-visualização do texto extraído. Para o layout original (formatação, tabelas, imagens) use <strong>Baixar original</strong>.
              </div>
              <pre className="flex-1 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap font-mono" data-testid="preview-office-text">
                {doc?.textoExtraido || "[Texto não pôde ser extraído deste arquivo. Baixe o original para visualizar.]"}
              </pre>
            </div>
          ) : (
            <div className="h-[40vh] flex items-center justify-center text-sm text-muted-foreground">
              Pré-visualização indisponível para este formato. Baixe o arquivo original abaixo.
            </div>
          )}
        </div>

        <DialogFooter className="px-6 pb-5 pt-2 border-t bg-background gap-2 flex-row sm:justify-between">
          <div className="text-xs text-muted-foreground self-center">
            Arquivo original preservado em armazenamento privado.
          </div>
          <div className="flex gap-2">
            {doc?.storagePath && (
              <a
                href={inlineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md border text-sm hover:bg-accent"
                data-testid="button-preview-open-tab"
              >
                <ExternalLink className="h-4 w-4" /> Abrir em nova aba
              </a>
            )}
            {doc?.storagePath && (
              <a
                href={downloadUrl}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90"
                data-testid="button-preview-download"
              >
                <Download className="h-4 w-4" /> Baixar original
              </a>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// OBRIGAÇÕES
// ===========================================================================
function ObrigacoesTab({ sociedadeId }: { sociedadeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("todas");
  const empty = { titulo: "", tipo: "certidao_negativa", descricao: "", dataVencimento: "", periodicidade: "unica", alertaDias: 15, status: "pendente" };
  const [form, setForm] = useState<any>(empty);

  const { data: rows = [], isLoading } = useQuery<ObrigacaoSocietaria[]>({
    queryKey: [`/api/societario/sociedades/${sociedadeId}/obrigacoes`, { status: statusFilter }],
    queryFn: async () => {
      const url = statusFilter === "todas"
        ? `/api/societario/sociedades/${sociedadeId}/obrigacoes`
        : `/api/societario/sociedades/${sociedadeId}/obrigacoes?status=${statusFilter}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/societario/sociedades/${sociedadeId}/obrigacoes`, form),
    onSuccess: () => {
      toast({ title: "Obrigação criada" });
      queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/obrigacoes`] });
      setOpen(false); setForm(empty);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });
  const concluir = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/societario/obrigacoes/${id}/concluir`),
    onSuccess: () => { toast({ title: "Obrigação concluída" }); queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/obrigacoes`] }); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/societario/obrigacoes/${id}`),
    onSuccess: () => { toast({ title: "Obrigação removida" }); queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/obrigacoes`] }); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Obrigações & prazos</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9" data-testid="select-obrigacoes-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="em_andamento">Em andamento</SelectItem>
              <SelectItem value="concluida">Concluídas</SelectItem>
              <SelectItem value="atrasada">Atrasadas</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-new-obrigacao"><Plus className="h-4 w-4 mr-1" />Nova</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Nova obrigação</DialogTitle></DialogHeader>
              <div className="grid gap-3 py-2">
                <FieldEdit label="Título *" value={form.titulo} onChange={(v) => setForm({ ...form, titulo: v })} testId="input-obrigacao-titulo" />
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Tipo" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={TIPOS_OBRIGACAO} />
                  <FieldEdit label="Vencimento *" type="date" value={form.dataVencimento} onChange={(v) => setForm({ ...form, dataVencimento: v })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField label="Periodicidade" value={form.periodicidade} onChange={(v) => setForm({ ...form, periodicidade: v })} options={PERIODICIDADES} />
                  <FieldEdit label="Alertar dias antes" type="number" value={String(form.alertaDias)} onChange={(v) => setForm({ ...form, alertaDias: Number(v) || 0 })} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Descrição</Label>
                  <Textarea rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={() => create.mutate()} disabled={!form.titulo || !form.dataVencimento || create.isPending} data-testid="button-save-obrigacao">{create.isPending ? "Salvando..." : "Criar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-obrigacoes-empty">Nenhuma obrigação cadastrada.</div>
        ) : (
          <div className="space-y-2">
            {rows.map((o) => {
              const venc = (o.dataVencimento as string) || "";
              const isAtrasada = o.status === "pendente" && venc && venc < today;
              const isConcluida = o.status === "concluida";
              return (
                <div key={o.id} className="flex items-center gap-3 p-3 rounded-md border" data-testid={`row-obrigacao-${o.id}`}>
                  <CalendarIcon className={`h-5 w-5 shrink-0 ${isAtrasada ? "text-destructive" : isConcluida ? "text-green-600" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium ${isConcluida ? "line-through text-muted-foreground" : ""}`}>{o.titulo}</span>
                      <Badge variant="outline" className="text-[10px]">{TIPOS_OBRIGACAO.find((t) => t.value === o.tipo)?.label || o.tipo}</Badge>
                      {isAtrasada && <Badge variant="destructive" className="text-[10px]">Atrasada</Badge>}
                      {isConcluida && <Badge className="text-[10px] bg-green-600 hover:bg-green-600">Concluída</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                      <span>Vence: {fmtDate(venc)}</span>
                      <span>· {PERIODICIDADES.find((p) => p.value === o.periodicidade)?.label || o.periodicidade}</span>
                      {o.dataConclusao && <span>· Concluída em {fmtDate(o.dataConclusao)}</span>}
                    </div>
                  </div>
                  {!isConcluida && (
                    <Button size="sm" variant="outline" onClick={() => concluir.mutate(o.id)} data-testid={`button-concluir-${o.id}`}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />Concluir
                    </Button>
                  )}
                  <ConfirmDelete onConfirm={() => remove.mutate(o.id)} testId={`button-delete-obrigacao-${o.id}`} title="Remover obrigação?" />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===========================================================================
// CERTIFICADOS DIGITAIS
// ===========================================================================
function CertificadosTab({ sociedadeId }: { sociedadeId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const empty = { tipo: "a1", titular: "", cpfCnpjTitular: "", emissor: "", numeroSerie: "", dataEmissao: "", dataValidade: "", status: "ativo", observacoes: "" };
  const [form, setForm] = useState<any>(empty);

  const { data: rows = [], isLoading } = useQuery<CertificadoDigital[]>({
    queryKey: [`/api/societario/sociedades/${sociedadeId}/certificados`],
  });

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/societario/sociedades/${sociedadeId}/certificados`, form),
    onSuccess: () => {
      toast({ title: "Certificado adicionado" });
      queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/certificados`] });
      setOpen(false); setForm(empty);
    },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/societario/certificados/${id}`),
    onSuccess: () => { toast({ title: "Certificado removido" }); queryClient.invalidateQueries({ queryKey: [`/api/societario/sociedades/${sociedadeId}/certificados`] }); },
    onError: (e: any) => toast({ title: "Erro", description: e?.message, variant: "destructive" }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Certificados digitais</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-new-certificado"><Plus className="h-4 w-4 mr-1" />Novo certificado</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Novo certificado digital</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-3 gap-3">
                <SelectField label="Tipo *" value={form.tipo} onChange={(v) => setForm({ ...form, tipo: v })} options={[{ value: "a1", label: "A1 (arquivo)" }, { value: "a3", label: "A3 (token/cartão)" }]} />
                <FieldEdit label="Emissor" value={form.emissor} onChange={(v) => setForm({ ...form, emissor: v })} />
                <FieldEdit label="Nº de série" value={form.numeroSerie} onChange={(v) => setForm({ ...form, numeroSerie: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldEdit label="Titular *" value={form.titular} onChange={(v) => setForm({ ...form, titular: v })} testId="input-certificado-titular" />
                <FieldEdit label="CPF/CNPJ titular" value={form.cpfCnpjTitular} onChange={(v) => setForm({ ...form, cpfCnpjTitular: v })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FieldEdit label="Emissão" type="date" value={form.dataEmissao} onChange={(v) => setForm({ ...form, dataEmissao: v })} />
                <FieldEdit label="Validade *" type="date" value={form.dataValidade} onChange={(v) => setForm({ ...form, dataValidade: v })} />
                <SelectField label="Status" value={form.status} onChange={(v) => setForm({ ...form, status: v })} options={[{ value: "ativo", label: "Ativo" }, { value: "vencido", label: "Vencido" }, { value: "revogado", label: "Revogado" }]} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea rows={2} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Onde está armazenado, senha mestre, etc." />
                <span className="text-[11px] text-muted-foreground">Upload do arquivo PFX (criptografado AES-256-GCM) será habilitado em sprint futuro.</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={() => create.mutate()} disabled={!form.titular || !form.dataValidade || create.isPending} data-testid="button-save-certificado">{create.isPending ? "Salvando..." : "Salvar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : rows.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="text-certificados-empty">Nenhum certificado cadastrado.</div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((c) => {
              const validade = (c.dataValidade as string) || "";
              const isVencido = validade && validade < today;
              const isVencendo = validade && validade >= today && validade <= in60;
              return (
                <div key={c.id} className="p-3 rounded-md border flex items-start gap-3" data-testid={`row-certificado-${c.id}`}>
                  <ShieldCheck className={`h-5 w-5 shrink-0 mt-0.5 ${isVencido ? "text-destructive" : isVencendo ? "text-amber-500" : "text-green-600"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.titular}</div>
                    <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                      <Badge variant="outline" className="text-[10px] uppercase">{c.tipo}</Badge>
                      {c.emissor && <span>{c.emissor}</span>}
                      {c.cpfCnpjTitular && <span>· {c.cpfCnpjTitular}</span>}
                    </div>
                    <div className={`text-xs mt-1 flex items-center gap-1 ${isVencido ? "text-destructive font-medium" : isVencendo ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                      {isVencido && <AlertTriangle className="h-3 w-3" />}
                      Validade: {fmtDate(validade)}
                      {isVencido && <span>· VENCIDO</span>}
                      {isVencendo && <span>· vence em breve</span>}
                    </div>
                  </div>
                  <ConfirmDelete onConfirm={() => remove.mutate(c.id)} testId={`button-delete-certificado-${c.id}`} title="Remover certificado?" />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────── Processos (Pipeline) ───────────────────────────────────
// Mini-board Kanban filtrado pela sociedade aberta. Reaproveita 100% do componente
// PipelineSocietario (board + drag/drop + criar processo) — passamos sociedadeIdFixa
// para que o filtro e o modal "Novo processo" sejam pré-escopados a esta sociedade.

function ProcessosTab({ sociedadeId }: { sociedadeId: string }) {
  return (
    <Card data-testid="card-processos-sociedade">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <KanbanSquare className="h-4 w-4 text-primary" />
          Processos societários
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Mini-board Kanban filtrado por esta sociedade — arraste cards para mover entre etapas.
        </p>
      </CardHeader>
      <CardContent>
        <PipelineSocietario embedded sociedadeIdFixa={sociedadeId} />
      </CardContent>
    </Card>
  );
}
