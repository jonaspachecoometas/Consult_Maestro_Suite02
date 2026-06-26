import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import {
  ArrowLeft,
  Trash2,
  Plus,
  Loader2,
  MapPin,
  Phone,
  Tag,
  FileText,
  Star,
  Mail,
  Globe,
  Smartphone,
  MessageCircle,
} from "lucide-react";
// (Mail/Globe/Smartphone/MessageCircle são usados em CONTATO_ICON)
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Pessoa, Endereco, Contato, PessoaPapel } from "@shared/schema";

type Detail = Pessoa & {
  enderecos: Endereco[];
  contatos: Contato[];
  papeis: PessoaPapel[];
};

const PAPEIS_OPTS = ["cliente", "fornecedor", "colaborador", "transportadora", "credor", "prospect", "parceiro"];
const TIPOS_CONTATO = ["telefone", "celular", "whatsapp", "email", "site"];
const TIPOS_ENDERECO = ["principal", "cobranca", "entrega", "outro"];

const CONTATO_ICON: Record<string, any> = {
  telefone: Phone,
  celular: Smartphone,
  whatsapp: MessageCircle,
  email: Mail,
  site: Globe,
};

export default function PessoaDetalhe() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: p, isLoading } = useQuery<Detail>({
    queryKey: ["/api/pessoas", params.id],
    queryFn: async () => {
      const r = await fetch(`/api/pessoas/${params.id}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  const delMut = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/pessoas/${params.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas/counts"] });
      toast({ title: "Pessoa inativada" });
      navigate("/pessoas");
    },
    onError: () => toast({ title: "Erro ao inativar", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!p) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Pessoa não encontrada.</p>
        <Button asChild variant="outline" className="mt-4"><Link href="/pessoas">Voltar</Link></Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/pessoas" data-testid="link-back"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="font-heading text-3xl font-bold" data-testid="text-pessoa-nome">{p.nomeFantasia}</h1>
            {p.razaoSocial && p.razaoSocial !== p.nomeFantasia && (
              <p className="text-muted-foreground">{p.razaoSocial}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              <Badge variant="outline">{p.tipoPessoa}</Badge>
              <Badge variant="secondary" className="font-mono text-xs">{formatDoc(p.cnpjCpf)}</Badge>
              <Badge variant={p.status === "ativo" ? "default" : "secondary"}>{p.status}</Badge>
              {p.papeis.filter((x) => x.status === "ativo").map((x) => (
                <Badge key={x.id} variant="outline" data-testid={`badge-papel-${x.tipoPapel}`}>{x.tipoPapel}</Badge>
              ))}
            </div>
          </div>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} data-testid="button-delete-pessoa">
          <Trash2 className="h-4 w-4 mr-2" /> Inativar
        </Button>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados" data-testid="tab-dados"><FileText className="h-4 w-4 mr-2" />Dados</TabsTrigger>
          <TabsTrigger value="enderecos" data-testid="tab-enderecos"><MapPin className="h-4 w-4 mr-2" />Endereços ({p.enderecos.length})</TabsTrigger>
          <TabsTrigger value="contatos" data-testid="tab-contatos"><Phone className="h-4 w-4 mr-2" />Contatos ({p.contatos.length})</TabsTrigger>
          <TabsTrigger value="papeis" data-testid="tab-papeis"><Tag className="h-4 w-4 mr-2" />Papéis ({p.papeis.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          <DadosTab pessoa={p} />
        </TabsContent>
        <TabsContent value="enderecos" className="mt-4">
          <EnderecosTab pessoa={p} />
        </TabsContent>
        <TabsContent value="contatos" className="mt-4">
          <ContatosTab pessoa={p} />
        </TabsContent>
        <TabsContent value="papeis" className="mt-4">
          <PapeisTab pessoa={p} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar pessoa?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa será marcada como inativa, mas o histórico será preservado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => delMut.mutate()} data-testid="button-confirm-delete">
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function formatDoc(doc: string) {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

function friendlyError(e: any) {
  const msg = String(e?.message ?? "");
  if (msg.includes("409")) return "Já existe um registro com esses dados.";
  if (msg.includes("403")) return "Sem permissão para esta ação.";
  if (msg.includes("400")) return "Dados inválidos.";
  if (msg.includes("404")) return "Registro não encontrado.";
  return "Falha na operação.";
}

function maskCpfCnpj(v: string, tipo: "PF" | "PJ"): string {
  const d = (v ?? "").replace(/\D/g, "").slice(0, tipo === "PF" ? 11 : 14);
  if (tipo === "PF") {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function DadosTab({ pessoa }: { pessoa: Detail }) {
  const { toast } = useToast();
  const [tipoPessoa, setTipoPessoa] = useState<"PF" | "PJ">(pessoa.tipoPessoa as "PF" | "PJ");
  const [nomeFantasia, setNomeFantasia] = useState(pessoa.nomeFantasia);
  const [razaoSocial, setRazaoSocial] = useState(pessoa.razaoSocial ?? "");
  const [cnpjCpf, setCnpjCpf] = useState(maskCpfCnpj(pessoa.cnpjCpf ?? "", pessoa.tipoPessoa as "PF" | "PJ"));
  const [rgIe, setRgIe] = useState(pessoa.rgIe ?? "");
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState(pessoa.inscricaoMunicipal ?? "");
  const [dataNascFund, setDataNascFund] = useState(pessoa.dataNascimentoFundacao ?? "");
  const [status, setStatus] = useState(pessoa.status);
  const [observacoes, setObservacoes] = useState(pessoa.observacoes ?? "");

  // Comerciais
  const [codigoExterno, setCodigoExterno] = useState(pessoa.codigoExterno ?? "");
  const [pessoaGrupo, setPessoaGrupo] = useState(pessoa.pessoaGrupo ?? "");
  const [vendedorPadrao, setVendedorPadrao] = useState(pessoa.vendedorPadrao ?? "");
  const [categoria, setCategoria] = useState(pessoa.categoria ?? "");
  const [tabelaPreco, setTabelaPreco] = useState(pessoa.tabelaPreco ?? "");
  const [limiteCredito, setLimiteCredito] = useState(pessoa.limiteCredito ?? "");
  const [periodicidade, setPeriodicidade] = useState<string>(
    pessoa.periodicidadeVendaCompra != null ? String(pessoa.periodicidadeVendaCompra) : "",
  );
  const [valorMinimoCompra, setValorMinimoCompra] = useState(pessoa.valorMinimoCompra ?? "");

  const mut = useMutation({
    mutationFn: async () => {
      const docDigits = cnpjCpf.replace(/\D/g, "");
      const docOriginalDigits = (pessoa.cnpjCpf ?? "").replace(/\D/g, "");
      const periodNum = periodicidade.trim() === "" ? null : Number(periodicidade);
      const body: Record<string, any> = {
        tipoPessoa,
        nomeFantasia: nomeFantasia.trim(),
        razaoSocial: razaoSocial.trim() || null,
        rgIe: rgIe.trim() || null,
        inscricaoMunicipal: inscricaoMunicipal.trim() || null,
        dataNascimentoFundacao: dataNascFund || null,
        status,
        observacoes: observacoes.trim() || null,
        codigoExterno: codigoExterno.trim() || null,
        pessoaGrupo: pessoaGrupo.trim() || null,
        vendedorPadrao: vendedorPadrao.trim() || null,
        categoria: categoria.trim() || null,
        tabelaPreco: tabelaPreco.trim() || null,
        limiteCredito: limiteCredito.trim() || null,
        periodicidadeVendaCompra: periodNum,
        valorMinimoCompra: valorMinimoCompra.trim() || null,
      };
      // cnpjCpf: só envia se for um documento válido (11 ou 14 dígitos) E mudou.
      // Pessoas oriundas da migração legada começam com placeholder "LEG-..." e
      // não podem perder esse valor sem que o usuário forneça um documento real.
      if (
        (docDigits.length === 11 || docDigits.length === 14) &&
        docDigits !== docOriginalDigits
      ) {
        body.cnpjCpf = docDigits;
      }
      const r = await apiRequest("PATCH", `/api/pessoas/${pessoa.id}`, body);
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoa.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas"] });
      toast({ title: "Dados atualizados" });
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <Card className="border-card-border">
      <CardContent className="p-6 space-y-6">
        {/* ----- IDENTIFICAÇÃO ----- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Identificação</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Tipo de pessoa</Label>
              <Select value={tipoPessoa} onValueChange={(v) => setTipoPessoa(v as "PF" | "PJ")}>
                <SelectTrigger data-testid="select-tipo-pessoa"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PJ">Jurídica (PJ)</SelectItem>
                  <SelectItem value="PF">Física (PF)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nome / Nome fantasia *</Label>
              <Input value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} data-testid="input-nome-fantasia" />
            </div>
            <div>
              <Label>{tipoPessoa === "PJ" ? "Razão social" : "Nome completo"}</Label>
              <Input value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} data-testid="input-razao-social" />
            </div>
            <div>
              <Label>{tipoPessoa === "PJ" ? "CNPJ *" : "CPF *"}</Label>
              <Input
                value={cnpjCpf}
                onChange={(e) => setCnpjCpf(maskCpfCnpj(e.target.value, tipoPessoa))}
                placeholder={tipoPessoa === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"}
                data-testid="input-cnpj-cpf"
              />
            </div>
            <div>
              <Label>{tipoPessoa === "PJ" ? "Data de fundação" : "Data de nascimento"}</Label>
              <Input
                type="date"
                value={dataNascFund}
                onChange={(e) => setDataNascFund(e.target.value)}
                data-testid="input-data-nasc-fund"
              />
            </div>
            <div>
              <Label>{tipoPessoa === "PJ" ? "Inscrição estadual (IE)" : "RG"}</Label>
              <Input value={rgIe} onChange={(e) => setRgIe(e.target.value)} data-testid="input-rg-ie" />
            </div>
            {tipoPessoa === "PJ" && (
              <div>
                <Label>Inscrição municipal</Label>
                <Input
                  value={inscricaoMunicipal}
                  onChange={(e) => setInscricaoMunicipal(e.target.value)}
                  data-testid="input-inscricao-municipal"
                />
              </div>
            )}
          </div>
        </section>

        {/* ----- COMERCIAL ----- */}
        <section className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Comercial</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Código externo / Identificador</Label>
              <Input
                value={codigoExterno}
                onChange={(e) => setCodigoExterno(e.target.value)}
                placeholder="ID no ERP, CRM ou sistema legado"
                data-testid="input-codigo-externo"
              />
            </div>
            <div>
              <Label>Grupo</Label>
              <Input
                value={pessoaGrupo}
                onChange={(e) => setPessoaGrupo(e.target.value)}
                placeholder="Ex.: VIP, Atacado, Revenda"
                data-testid="input-pessoa-grupo"
              />
            </div>
            <div>
              <Label>Vendedor padrão</Label>
              <Input
                value={vendedorPadrao}
                onChange={(e) => setVendedorPadrao(e.target.value)}
                data-testid="input-vendedor-padrao"
              />
            </div>
            <div>
              <Label>Categoria</Label>
              <Input value={categoria} onChange={(e) => setCategoria(e.target.value)} data-testid="input-categoria" />
            </div>
            <div>
              <Label>Tabela de preço</Label>
              <Input value={tabelaPreco} onChange={(e) => setTabelaPreco(e.target.value)} data-testid="input-tabela-preco" />
            </div>
            <div>
              <Label>Limite de crédito (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={limiteCredito}
                onChange={(e) => setLimiteCredito(e.target.value)}
                data-testid="input-limite-credito"
              />
            </div>
            <div>
              <Label>Periodicidade compra/venda (dias)</Label>
              <Input
                type="number"
                min="0"
                value={periodicidade}
                onChange={(e) => setPeriodicidade(e.target.value)}
                data-testid="input-periodicidade"
              />
            </div>
            <div>
              <Label>Valor mínimo de pedido (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={valorMinimoCompra}
                onChange={(e) => setValorMinimoCompra(e.target.value)}
                data-testid="input-valor-minimo"
              />
            </div>
          </div>
        </section>

        {/* ----- OBSERVAÇÕES ----- */}
        <section className="space-y-3 pt-4 border-t">
          <Label>Observações</Label>
          <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={3} data-testid="input-observacoes" />
        </section>

        <Button onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="button-save-dados">
          {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Salvar alterações
        </Button>
      </CardContent>
    </Card>
  );
}

function EnderecosTab({ pessoa }: { pessoa: Detail }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Endereco | null>(null);

  const delMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/enderecos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoa.id] });
      toast({ title: "Endereço removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-add-endereco">
          <Plus className="h-4 w-4 mr-2" /> Novo endereço
        </Button>
      </div>
      {pessoa.enderecos.length === 0 ? (
        <Card className="border-card-border"><CardContent className="p-6 text-center text-muted-foreground">Nenhum endereço cadastrado.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {pessoa.enderecos.map((e) => (
            <Card key={e.id} className="border-card-border" data-testid={`card-endereco-${e.id}`}>
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{e.tipo}</CardTitle>
                    {e.isPrincipal === 1 && <Star className="h-4 w-4 text-amber-500 fill-amber-500" />}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(e); setOpen(true); }} data-testid={`button-edit-endereco-${e.id}`}>Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => delMut.mutate(e.id)} data-testid={`button-delete-endereco-${e.id}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>{e.logradouro}{e.numero ? `, ${e.numero}` : ""}{e.complemento ? ` — ${e.complemento}` : ""}</p>
                <p>{e.bairro}{e.bairro && (e.cidade || e.uf) ? " — " : ""}{e.cidade}{e.cidade && e.uf ? "/" : ""}{e.uf}</p>
                {e.cep && <p className="text-muted-foreground">CEP {e.cep}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <EnderecoDialog
        key={editing?.id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        pessoaId={pessoa.id}
        editing={editing}
      />
    </div>
  );
}

function maskCep(v: string): string {
  const d = (v ?? "").replace(/\D/g, "").slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function EnderecoDialog({ open, onOpenChange, pessoaId, editing }: {
  open: boolean; onOpenChange: (v: boolean) => void; pessoaId: string; editing: Endereco | null;
}) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState(editing?.tipo ?? "principal");
  const [logradouro, setLogradouro] = useState(editing?.logradouro ?? "");
  const [numero, setNumero] = useState(editing?.numero ?? "");
  const [complemento, setComplemento] = useState(editing?.complemento ?? "");
  const [bairro, setBairro] = useState(editing?.bairro ?? "");
  const [cidade, setCidade] = useState(editing?.cidade ?? "");
  const [codigoMunicipio, setCodigoMunicipio] = useState(editing?.codigoMunicipio ?? "");
  const [uf, setUf] = useState(editing?.uf ?? "");
  const [codigoUf, setCodigoUf] = useState((editing as any)?.codigoUf ?? "");
  const [cep, setCep] = useState(maskCep(editing?.cep ?? ""));
  const [pais, setPais] = useState(editing?.pais ?? "Brasil");
  const [codigoPais, setCodigoPais] = useState((editing as any)?.codigoPais ?? "");
  const [isPrincipal, setIsPrincipal] = useState(editing?.isPrincipal === 1);
  const [cepLoading, setCepLoading] = useState(false);

  // Lookup ViaCEP — preenche cidade/uf/bairro/logradouro/codigoMunicipio automaticamente.
  // Aceita 8 dígitos (com ou sem máscara). Não sobrescreve campos já preenchidos.
  async function buscarCep() {
    const d = cep.replace(/\D/g, "");
    if (d.length !== 8) {
      toast({ title: "CEP incompleto", description: "Digite os 8 dígitos.", variant: "destructive" });
      return;
    }
    try {
      setCepLoading(true);
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const data = await r.json();
      if (data?.erro) {
        toast({ title: "CEP não encontrado", variant: "destructive" });
        return;
      }
      if (data.logradouro && !logradouro) setLogradouro(data.logradouro);
      if (data.bairro && !bairro) setBairro(data.bairro);
      if (data.localidade) setCidade(data.localidade);
      if (data.uf) setUf(data.uf);
      if (data.ibge) setCodigoMunicipio(data.ibge);
      if (!pais) setPais("Brasil");
      toast({ title: "CEP encontrado", description: `${data.localidade}/${data.uf}` });
    } catch {
      toast({ title: "Falha na busca de CEP", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  }

  const mut = useMutation({
    mutationFn: async () => {
      const body = {
        tipo,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: complemento || null,
        bairro: bairro || null,
        cidade: cidade || null,
        codigoMunicipio: codigoMunicipio || null,
        uf: uf ? uf.toUpperCase().slice(0, 2) : null,
        codigoUf: codigoUf || null,
        cep: cep ? cep.replace(/\D/g, "") : null,
        pais: pais || null,
        codigoPais: codigoPais || null,
        isPrincipal: isPrincipal ? 1 : 0,
      };
      if (editing) await apiRequest("PATCH", `/api/enderecos/${editing.id}`, body);
      else await apiRequest("POST", `/api/pessoas/${pessoaId}/enderecos`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoaId] });
      toast({ title: editing ? "Endereço atualizado" : "Endereço criado" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-endereco">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar endereço" : "Novo endereço"}</DialogTitle>
          <DialogDescription>Digite o CEP e clique em Buscar para preencher automaticamente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger data-testid="select-end-tipo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_ENDERECO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>CEP</Label>
              <div className="flex gap-2">
                <Input
                  value={cep}
                  onChange={(e) => setCep(maskCep(e.target.value))}
                  onBlur={() => { if (cep.replace(/\D/g, "").length === 8) buscarCep(); }}
                  placeholder="00000-000"
                  data-testid="input-end-cep"
                />
                <Button type="button" variant="outline" onClick={buscarCep} disabled={cepLoading} data-testid="button-buscar-cep">
                  {cepLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-3">
              <Label>Logradouro</Label>
              <Input value={logradouro} onChange={(e) => setLogradouro(e.target.value)} data-testid="input-end-logradouro" />
            </div>
            <div>
              <Label>Número</Label>
              <Input value={numero} onChange={(e) => setNumero(e.target.value)} data-testid="input-end-numero" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Complemento</Label>
              <Input value={complemento} onChange={(e) => setComplemento(e.target.value)} data-testid="input-end-complemento" />
            </div>
            <div>
              <Label>Bairro</Label>
              <Input value={bairro} onChange={(e) => setBairro(e.target.value)} data-testid="input-end-bairro" />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <Label>Cidade</Label>
              <Input value={cidade} onChange={(e) => setCidade(e.target.value)} data-testid="input-end-cidade" />
            </div>
            <div>
              <Label>Cód. IBGE</Label>
              <Input value={codigoMunicipio} onChange={(e) => setCodigoMunicipio(e.target.value)} data-testid="input-end-cod-mun" />
            </div>
            <div>
              <Label>UF</Label>
              <Input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} maxLength={2} data-testid="input-end-uf" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Cód. UF</Label>
              <Input value={codigoUf} onChange={(e) => setCodigoUf(e.target.value)} data-testid="input-end-cod-uf" />
            </div>
            <div>
              <Label>País</Label>
              <Input value={pais} onChange={(e) => setPais(e.target.value)} data-testid="input-end-pais" />
            </div>
            <div>
              <Label>Cód. País</Label>
              <Input value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} data-testid="input-end-cod-pais" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrincipal} onChange={(e) => setIsPrincipal(e.target.checked)} data-testid="check-end-principal" />
            Principal (desmarca o atual principal da pessoa)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="button-save-endereco">
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContatosTab({ pessoa }: { pessoa: Detail }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contato | null>(null);

  const delMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/contatos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoa.id] });
      toast({ title: "Contato removido" });
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-add-contato">
          <Plus className="h-4 w-4 mr-2" /> Novo contato
        </Button>
      </div>
      {pessoa.contatos.length === 0 ? (
        <Card className="border-card-border"><CardContent className="p-6 text-center text-muted-foreground">Nenhum contato cadastrado.</CardContent></Card>
      ) : (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left">
                  <th className="p-3">Tipo</th>
                  <th className="p-3">Valor</th>
                  <th className="p-3">Principal</th>
                  <th className="p-3 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {pessoa.contatos.map((c) => {
                  const Icon = CONTATO_ICON[c.tipo] ?? Phone;
                  return (
                    <tr key={c.id} className="border-b last:border-0" data-testid={`row-contato-${c.id}`}>
                      <td className="p-3"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted-foreground" />{c.tipo}</div></td>
                      <td className="p-3 font-mono text-xs">{c.valor}</td>
                      <td className="p-3">{c.isPrincipal === 1 && <Star className="h-4 w-4 text-amber-500 fill-amber-500" />}</td>
                      <td className="p-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(c); setOpen(true); }} data-testid={`button-edit-contato-${c.id}`}>Editar</Button>
                        <Button variant="ghost" size="sm" onClick={() => delMut.mutate(c.id)} data-testid={`button-delete-contato-${c.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
      <ContatoDialog
        key={editing?.id ?? "new"}
        open={open}
        onOpenChange={setOpen}
        pessoaId={pessoa.id}
        editing={editing}
      />
    </div>
  );
}

function ContatoDialog({ open, onOpenChange, pessoaId, editing }: {
  open: boolean; onOpenChange: (v: boolean) => void; pessoaId: string; editing: Contato | null;
}) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState(editing?.tipo ?? "telefone");
  const [valor, setValor] = useState(editing?.valor ?? "");
  const [isPrincipal, setIsPrincipal] = useState(editing?.isPrincipal === 1);

  useState(() => {
    if (editing) {
      setTipo(editing.tipo);
      setValor(editing.valor);
      setIsPrincipal(editing.isPrincipal === 1);
    }
  });

  const mut = useMutation({
    mutationFn: async () => {
      const body = { tipo, valor: valor.trim(), isPrincipal: isPrincipal ? 1 : 0 };
      if (editing) await apiRequest("PATCH", `/api/contatos/${editing.id}`, body);
      else await apiRequest("POST", `/api/pessoas/${pessoaId}/contatos`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoaId] });
      toast({ title: editing ? "Contato atualizado" : "Contato criado" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-contato">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar contato" : "Novo contato"}</DialogTitle>
          <DialogDescription>Marcar como principal desmarca outro principal do mesmo tipo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger data-testid="select-cont-tipo"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS_CONTATO.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Valor</Label>
            <Input value={valor} onChange={(e) => setValor(e.target.value)} data-testid="input-cont-valor" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrincipal} onChange={(e) => setIsPrincipal(e.target.checked)} data-testid="check-cont-principal" />
            Principal
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending || !valor.trim()} data-testid="button-save-contato">
            {mut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PapeisTab({ pessoa }: { pessoa: Detail }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [tipoPapel, setTipoPapel] = useState("cliente");

  const ativosTipos = new Set(pessoa.papeis.filter((p) => p.status === "ativo").map((p) => p.tipoPapel));
  const disponiveis = PAPEIS_OPTS.filter((t) => !ativosTipos.has(t));

  const addMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/pessoas/${pessoa.id}/papeis`, { tipoPapel, status: "ativo" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoa.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas/counts"] });
      toast({ title: "Papel adicionado" });
      setOpen(false);
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/papeis/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas", pessoa.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/pessoas/counts"] });
      toast({ title: "Papel inativado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: friendlyError(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)} disabled={disponiveis.length === 0} data-testid="button-add-papel">
          <Plus className="h-4 w-4 mr-2" /> Novo papel
        </Button>
      </div>
      {pessoa.papeis.length === 0 ? (
        <Card className="border-card-border"><CardContent className="p-6 text-center text-muted-foreground">Nenhum papel atribuído.</CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pessoa.papeis.map((pa) => (
            <Card key={pa.id} className="border-card-border" data-testid={`card-papel-${pa.id}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold capitalize">{pa.tipoPapel}</p>
                  <Badge variant={pa.status === "ativo" ? "default" : "secondary"} className="mt-1">{pa.status}</Badge>
                  {pa.dataInicio && <p className="text-xs text-muted-foreground mt-1">Desde {new Date(pa.dataInicio).toLocaleDateString("pt-BR")}</p>}
                </div>
                {pa.status === "ativo" && (
                  <Button variant="ghost" size="icon" onClick={() => delMut.mutate(pa.id)} data-testid={`button-delete-papel-${pa.id}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid="dialog-papel">
          <DialogHeader>
            <DialogTitle>Adicionar papel</DialogTitle>
            <DialogDescription>Cada pessoa pode ter no máximo 1 papel ativo de cada tipo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Papel</Label>
            <Select value={tipoPapel} onValueChange={setTipoPapel}>
              <SelectTrigger data-testid="select-tipo-papel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {disponiveis.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => addMut.mutate()} disabled={addMut.isPending} data-testid="button-save-papel">
              {addMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
