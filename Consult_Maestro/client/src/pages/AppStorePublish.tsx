import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Rocket, Package } from "lucide-react";

const SLUG_RE = /^[a-z][a-z0-9-]{2,79}$/;

type BillingModel = "free" | "per_install" | "monthly";
type PublishTab = "create" | "myapps";
type SourceKind = "run" | "plan";

interface PipelineRunOption { id: string; title: string; status: string }
interface ModulePlanOption { id: string; title: string; currentVersion: string }
interface SourcesResponse { runs: PipelineRunOption[]; plans: ModulePlanOption[] }
interface MyAppRow { id: string; slug: string; title: string; status: string; installCount: number }

interface CreateDraftBody {
  slug: string;
  title: string;
  shortDescription: string;
  longDescription?: string;
  category: string;
  billingModel: BillingModel;
  priceCents: number;
  initialVersion: string;
  changelog?: string;
  screenshots?: string[];
  sourceRunId?: string;
  sourcePlanId?: string;
}

interface CreateDraftResponse { app: { id: string; slug: string } }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AppStorePublish() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<PublishTab>("create");

  // Form state
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [longDesc, setLongDesc] = useState("");
  const [category, setCategory] = useState("geral");
  const [billingModel, setBillingModel] = useState<BillingModel>("free");
  const [priceCents, setPriceCents] = useState(0);
  const [sourceType, setSourceType] = useState<SourceKind>("run");
  const [sourceId, setSourceId] = useState("");
  const [initialVersion, setInitialVersion] = useState("1.0.0");
  const [changelog, setChangelog] = useState("");
  const [screenshotsRaw, setScreenshotsRaw] = useState("");

  const { data: sources } = useQuery<SourcesResponse>({
    queryKey: ["/api/marketplace/sources"],
  });

  const { data: myApps } = useQuery<MyAppRow[]>({
    queryKey: ["/api/marketplace/my-apps"],
  });

  const createMutation = useMutation<CreateDraftResponse, Error, void>({
    mutationFn: async () => {
      const screenshots = screenshotsRaw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s));
      const body: CreateDraftBody = {
        slug, title, shortDescription: shortDesc, longDescription: longDesc || undefined,
        category, billingModel, priceCents, initialVersion,
        changelog: changelog || undefined,
        screenshots: screenshots.length > 0 ? screenshots : undefined,
      };
      if (sourceType === "run") body.sourceRunId = sourceId;
      else body.sourcePlanId = sourceId;
      const res = await apiRequest("POST", "/api/marketplace/apps", body);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Rascunho criado!", description: "Revise e envie para aprovação." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/my-apps"] });
      setLocation(`/app-store/${data.app.slug}`);
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const slugValid = SLUG_RE.test(slug);
  const formValid = slugValid && title.length >= 3 && shortDesc.length >= 10 && !!sourceId;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Rocket className="h-7 w-7 text-primary" /> Publicar Módulo
        </h1>
        <p className="text-muted-foreground mt-1">
          Empacote uma pipeline run ou plano em um app instalável.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PublishTab)}>
        <TabsList>
          <TabsTrigger value="create" data-testid="tab-create">Novo App</TabsTrigger>
          <TabsTrigger value="myapps" data-testid="tab-myapps">Meus Apps</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Origem do pacote</CardTitle>
              <CardDescription>Selecione qual run ou plano será empacotado.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={sourceType === "run" ? "default" : "outline"}
                  onClick={() => { setSourceType("run"); setSourceId(""); }}
                  data-testid="button-source-run"
                >
                  Pipeline Run (Dev Center)
                </Button>
                <Button
                  variant={sourceType === "plan" ? "default" : "outline"}
                  onClick={() => { setSourceType("plan"); setSourceId(""); }}
                  data-testid="button-source-plan"
                >
                  Plano (Module Planner)
                </Button>
              </div>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger data-testid="select-source">
                  <SelectValue placeholder={`Escolha ${sourceType === "run" ? "uma run" : "um plano"}`} />
                </SelectTrigger>
                <SelectContent>
                  {sourceType === "run"
                    ? (sources?.runs ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.title} ({r.status})
                        </SelectItem>
                      ))
                    : (sources?.plans ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.title} (v{p.currentVersion})
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Informações públicas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Slug (URL)</Label>
                  <Input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="honorarios-consultor"
                    data-testid="input-slug"
                  />
                  {slug && !slugValid && (
                    <p className="text-xs text-destructive mt-1">Use kebab-case (a-z, 0-9, -), 3+ chars.</p>
                  )}
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger data-testid="select-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="geral">Geral</SelectItem>
                      <SelectItem value="financeiro">Financeiro</SelectItem>
                      <SelectItem value="rh">RH</SelectItem>
                      <SelectItem value="vendas">Vendas</SelectItem>
                      <SelectItem value="operacional">Operacional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Título</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Controle de Honorários por Consultor" data-testid="input-title" />
              </div>
              <div>
                <Label>Descrição curta</Label>
                <Input value={shortDesc} onChange={(e) => setShortDesc(e.target.value)} placeholder="Aparece no card da App Store" data-testid="input-short-desc" maxLength={280} />
              </div>
              <div>
                <Label>Descrição longa (opcional)</Label>
                <Textarea value={longDesc} onChange={(e) => setLongDesc(e.target.value)} rows={5} data-testid="textarea-long-desc" />
              </div>
              <div>
                <Label>Screenshots (uma URL por linha, opcional)</Label>
                <Textarea
                  value={screenshotsRaw}
                  onChange={(e) => setScreenshotsRaw(e.target.value)}
                  rows={4}
                  placeholder={"https://exemplo.com/screen-1.png\nhttps://exemplo.com/screen-2.png"}
                  data-testid="textarea-screenshots"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Cada URL https:// vira uma imagem na página do app.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Cobrança e versão</CardTitle>
              <CardDescription>Pagamento real é placeholder no MVP — gera registros em marketplace_charges.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Modelo de cobrança</Label>
                  <Select value={billingModel} onValueChange={(v) => setBillingModel(v as BillingModel)}>
                    <SelectTrigger data-testid="select-billing"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Grátis</SelectItem>
                      <SelectItem value="per_install">Por instalação</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Preço (centavos)</Label>
                  <Input
                    type="number"
                    value={priceCents}
                    onChange={(e) => setPriceCents(Number(e.target.value || 0))}
                    disabled={billingModel === "free"}
                    data-testid="input-price"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Versão inicial</Label>
                  <Input value={initialVersion} onChange={(e) => setInitialVersion(e.target.value)} placeholder="1.0.0" data-testid="input-version" />
                </div>
                <div>
                  <Label>Changelog</Label>
                  <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Versão inicial" data-testid="input-changelog" />
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formValid || createMutation.isPending}
              size="lg"
              data-testid="button-create-draft"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Criar rascunho
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="myapps" className="space-y-3">
          {(myApps ?? []).length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Você ainda não publicou nenhum app.</CardContent></Card>
          ) : (
            (myApps ?? []).map((app) => (
              <Card key={app.id} className="hover-elevate cursor-pointer" onClick={() => setLocation(`/app-store/${app.slug}`)} data-testid={`card-myapp-${app.slug}`}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{app.title}</div>
                      <div className="text-xs text-muted-foreground">{app.slug}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={app.status === "published" ? "default" : "outline"}>{app.status}</Badge>
                    <Badge variant="secondary">{app.installCount} instalações</Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
