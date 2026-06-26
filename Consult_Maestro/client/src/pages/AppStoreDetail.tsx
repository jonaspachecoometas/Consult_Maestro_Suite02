import { useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription,
} from "@/components/ui/dialog";
import {
  Star, Package, ArrowLeft, Loader2, Trash2, RotateCcw, Upload, Send,
} from "lucide-react";
import { useSystemRole } from "@/hooks/useSystemRole";

type BillingModel = "free" | "per_install" | "monthly";
type AppStatus = "draft" | "in_review" | "published" | "rejected" | "archived";
type SourceKind = "run" | "plan";

interface MarketplaceAppDTO {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  longDescription: string | null;
  category: string;
  status: AppStatus;
  billingModel: BillingModel;
  priceCents: number;
  iconUrl: string | null;
  screenshots: string[] | null;
  installCount: number;
  ratingAvg: string | null;
  ratingCount: number;
  reviewNotes: string | null;
  ownerTenantId: string;
  currentVersionId: string | null;
}

interface ManifestSummary {
  tables?: unknown[];
  routes?: unknown[];
}

interface MarketplaceVersionDTO {
  id: string;
  appId: string;
  version: string;
  changelog: string | null;
  manifestJson: ManifestSummary | null;
  publishedAt: string | null;
  rejectedAt: string | null;
  submittedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

interface InstallationDTO {
  id: string;
  appId: string;
  status: "installed" | "uninstalled" | "failed";
  installedVersionId: string | null;
}

interface ReviewWithTenant {
  review: { id: string; rating: number; comment: string | null };
  tenant: { id: string; name: string } | null;
}

interface DetailResponse {
  app: MarketplaceAppDTO;
  versions: MarketplaceVersionDTO[];
  reviews: ReviewWithTenant[];
  installation: InstallationDTO | null;
  isOwner: boolean;
}

interface PipelineRunOption { id: string; title: string; status: string }
interface ModulePlanOption { id: string; title: string; currentVersion: string }
interface SourcesResponse { runs: PipelineRunOption[]; plans: ModulePlanOption[] }

interface NewVersionResponse { version: { id: string; version: string } }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function StarRating({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          disabled={!onChange}
          data-testid={`button-rating-${n}`}
          className="text-yellow-500"
        >
          <Star className={`h-5 w-5 ${n <= value ? "fill-current" : ""}`} />
        </button>
      ))}
    </div>
  );
}

interface NewVersionDialogProps {
  appId: string;
  slug: string;
  onCreated: () => void;
}

function NewVersionDialog({ appId, slug, onCreated }: NewVersionDialogProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sourceType, setSourceType] = useState<SourceKind>("run");
  const [sourceId, setSourceId] = useState("");
  const [version, setVersion] = useState("");
  const [changelog, setChangelog] = useState("");

  const { data: sources } = useQuery<SourcesResponse>({
    queryKey: ["/api/marketplace/sources"],
    enabled: open,
  });

  const createMutation = useMutation<NewVersionResponse, Error, void>({
    mutationFn: async () => {
      const body: Record<string, string | undefined> = {
        version,
        changelog: changelog || undefined,
      };
      if (sourceType === "run") body.sourceRunId = sourceId;
      else body.sourcePlanId = sourceId;
      const res = await apiRequest("POST", `/api/marketplace/apps/${appId}/versions`, body);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Versão criada",
        description: "Agora envie para revisão para que outros tenants possam atualizar.",
      });
      setOpen(false);
      setVersion("");
      setChangelog("");
      setSourceId("");
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps", slug] });
      onCreated();
    },
    onError: (e) => toast({
      title: "Erro ao criar versão",
      description: errorMessage(e),
      variant: "destructive",
    }),
  });

  const SEMVER = /^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$/;
  const formValid = SEMVER.test(version) && !!sourceId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="button-new-version">
          <Upload className="h-4 w-4 mr-1" /> Nova versão
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publicar nova versão</DialogTitle>
          <DialogDescription>
            A versão atual continua disponível para quem já instalou. Esta nova versão precisará ser aprovada antes de aparecer como atualização.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Fonte do código</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <Button
                type="button"
                variant={sourceType === "run" ? "default" : "outline"}
                onClick={() => { setSourceType("run"); setSourceId(""); }}
                data-testid="button-newver-source-run"
              >
                Pipeline Run
              </Button>
              <Button
                type="button"
                variant={sourceType === "plan" ? "default" : "outline"}
                onClick={() => { setSourceType("plan"); setSourceId(""); }}
                data-testid="button-newver-source-plan"
              >
                Plano
              </Button>
            </div>
          </div>
          <div>
            <Label>Selecione a {sourceType === "run" ? "run" : "plano"}</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger className="mt-1" data-testid="select-newver-source">
                <SelectValue placeholder={`Escolha ${sourceType === "run" ? "uma run" : "um plano"}`} />
              </SelectTrigger>
              <SelectContent>
                {sourceType === "run"
                  ? (sources?.runs ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.title} ({r.status})</SelectItem>
                    ))
                  : (sources?.plans ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.title} (v{p.currentVersion})</SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Versão (semver)</Label>
            <Input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.1.0"
              className="mt-1"
              data-testid="input-newver-version"
            />
            {version && !SEMVER.test(version) && (
              <p className="text-xs text-destructive mt-1">Use formato semver (ex.: 1.1.0).</p>
            )}
          </div>
          <div>
            <Label>Changelog</Label>
            <Textarea
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              rows={3}
              placeholder="O que mudou?"
              className="mt-1"
              data-testid="textarea-newver-changelog"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!formValid || createMutation.isPending}
            data-testid="button-newver-submit"
          >
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Criar versão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AppStoreDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { toast } = useToast();
  const { isSuperadmin, isTenantAdmin } = useSystemRole();
  // install/update/uninstall só para admins do tenant — espelha
  // requireTenantAdmin do backend (evita botão clicável que dará 403).
  const canInstall = isSuperadmin || isTenantAdmin;
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  const { data, isLoading } = useQuery<DetailResponse>({
    queryKey: ["/api/marketplace/apps", slug],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/apps/${slug}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro");
      return res.json();
    },
  });

  const installMutation = useMutation<unknown, Error, string | undefined>({
    mutationFn: async (versionId?: string) => {
      const res = await apiRequest("POST", `/api/marketplace/apps/${data!.app.id}/install`, { versionId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Módulo instalado", description: "Tabelas criadas no seu tenant com sucesso." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const updateMutation = useMutation<unknown, Error, string>({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/marketplace/installations/${data!.installation!.id}/update`, { versionId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Atualizado", description: "Instalação migrada para a nova versão." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const rollbackMutation = useMutation<unknown, Error, string>({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/marketplace/installations/${data!.installation!.id}/rollback`, { versionId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Rollback feito", description: "Voltou para a versão anterior." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const uninstallMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/marketplace/installations/${data!.installation!.id}`);
    },
    onSuccess: () => {
      toast({ title: "Desinstalado", description: "Os dados foram preservados para reinstalação futura." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const submitMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/marketplace/apps/${data!.app.id}/submit`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Enviado para revisão", description: "Aguarde aprovação do superadmin." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps", slug] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const reviewMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/marketplace/apps/${data!.app.id}/reviews`, {
        rating: reviewRating,
        comment: reviewComment || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Avaliação enviada" });
      setReviewComment("");
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps", slug] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  const { app, versions, reviews, installation, isOwner } = data ?? {
    app: undefined as unknown as MarketplaceAppDTO,
    versions: [] as MarketplaceVersionDTO[],
    reviews: [] as ReviewWithTenant[],
    installation: null as InstallationDTO | null,
    isOwner: false,
  };

  // "pendingVersion" inclui rascunhos (não submetidos) e versões já em
  // revisão. Owner usa para decidir se pode clicar em "Enviar versão p/
  // revisão" — se a versão pendente ainda não foi submetida.
  const pendingVersion = useMemo(
    () => versions.find((v) => !v.publishedAt && !v.rejectedAt) ?? null,
    [versions],
  );
  const hasUnsubmittedDraft = !!pendingVersion && !pendingVersion.submittedAt;
  const lastRejectedVersion = useMemo(
    () => versions.find((v) => !!v.rejectedAt) ?? null,
    [versions],
  );

  if (isLoading || !data) {
    return (
      <div className="container mx-auto p-6 max-w-5xl space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const publishedVersions = versions.filter((v) => !!v.publishedAt);
  const currentVersion = publishedVersions.find((v) => v.id === installation?.installedVersionId);
  const latestPublished = publishedVersions[0] ?? null;
  const canUpdate =
    installation?.status === "installed" &&
    latestPublished &&
    installation.installedVersionId !== latestPublished.id;

  // Owner pode submeter quando: app está em draft (envia o app inteiro p/ 1ª
  // revisão) OU quando há uma versão pendente que ainda não foi submetida
  // (app published com nova versão criada via NewVersionDialog).
  const canOwnerSubmit =
    isOwner &&
    hasUnsubmittedDraft &&
    (app.status === "draft" || app.status === "rejected" || app.status === "published");

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <Link href="/app-store">
        <Button variant="ghost" size="sm" data-testid="link-back">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            {app.iconUrl ? (
              <img src={app.iconUrl} alt="" className="h-20 w-20 rounded-md object-cover" />
            ) : (
              <div className="h-20 w-20 rounded-md bg-primary/10 flex items-center justify-center">
                <Package className="h-10 w-10 text-primary" />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-2xl" data-testid="text-app-title">{app.title}</CardTitle>
                <Badge>{app.category}</Badge>
                {app.status !== "published" && <Badge variant="outline">{app.status}</Badge>}
                {isOwner && <Badge variant="secondary">Seu app</Badge>}
                {pendingVersion && (
                  <Badge variant="outline" data-testid="badge-pending-version">
                    v{pendingVersion.version} pendente
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground mt-2">{app.shortDescription}</p>
              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="h-4 w-4" />
                  {app.ratingAvg ? `${Number(app.ratingAvg).toFixed(1)} (${app.ratingCount})` : "Sem avaliações"}
                </span>
                <span>{app.installCount} instalações</span>
                <span className="font-medium text-foreground">
                  {app.billingModel === "free" ? "Grátis" :
                    `${(app.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}${app.billingModel === "monthly" ? "/mês" : ""}`}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[180px]">
              {!isOwner && app.status === "published" && canInstall && (
                installation?.status === "installed" ? (
                  <>
                    {canUpdate && latestPublished && (
                      <Button
                        onClick={() => updateMutation.mutate(latestPublished.id)}
                        disabled={updateMutation.isPending}
                        data-testid="button-update"
                      >
                        {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => uninstallMutation.mutate()}
                      disabled={uninstallMutation.isPending}
                      data-testid="button-uninstall"
                    >
                      <Trash2 className="h-4 w-4 mr-1" /> Desinstalar
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => installMutation.mutate(undefined)}
                    disabled={installMutation.isPending}
                    data-testid="button-install"
                  >
                    {installMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Instalar"}
                  </Button>
                )
              )}
              {!isOwner && app.status === "published" && !canInstall && installation?.status === "installed" && (
                <Badge variant="secondary" data-testid="badge-installed-readonly">Instalado</Badge>
              )}
              {!isOwner && app.status === "published" && !canInstall && installation?.status !== "installed" && (
                <Badge variant="outline" data-testid="badge-no-permission">Apenas admins instalam</Badge>
              )}
              {isOwner && (
                <NewVersionDialog
                  appId={app.id}
                  slug={app.slug}
                  onCreated={() => {/* dialog handles cache invalidation */}}
                />
              )}
              {canOwnerSubmit && (
                <Button
                  onClick={() => submitMutation.mutate()}
                  disabled={submitMutation.isPending}
                  data-testid="button-submit-review"
                >
                  {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  {app.status === "published" ? "Enviar versão p/ revisão" : "Enviar p/ revisão"}
                </Button>
              )}
              {isOwner && app.status === "rejected" && app.reviewNotes && (
                <Card className="bg-destructive/10 p-3 text-xs">
                  <div className="font-semibold text-destructive">Rejeitado:</div>
                  <p>{app.reviewNotes}</p>
                </Card>
              )}
              {isOwner && lastRejectedVersion && app.status === "published" && (
                <Card className="bg-destructive/10 p-3 text-xs" data-testid="card-version-rejected">
                  <div className="font-semibold text-destructive">
                    v{lastRejectedVersion.version} rejeitada
                  </div>
                  {lastRejectedVersion.reviewNotes && (
                    <p className="mt-1">{lastRejectedVersion.reviewNotes}</p>
                  )}
                  <p className="mt-1 text-muted-foreground">
                    Crie uma nova versão (semver maior) e submeta novamente.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </CardHeader>
        {app.longDescription && (
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{app.longDescription}</p>
          </CardContent>
        )}
        {Array.isArray(app.screenshots) && app.screenshots.length > 0 && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {app.screenshots.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md overflow-hidden border bg-muted hover-elevate"
                  data-testid={`link-screenshot-${i}`}
                >
                  <img src={url} alt={`Screenshot ${i + 1}`} className="w-full h-auto object-cover" />
                </a>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="versions">
        <TabsList>
          <TabsTrigger value="versions" data-testid="tab-versions">Versões</TabsTrigger>
          <TabsTrigger value="reviews" data-testid="tab-reviews">Avaliações</TabsTrigger>
        </TabsList>

        <TabsContent value="versions" className="space-y-3">
          {versions.map((v) => {
            const tableCount = Array.isArray(v.manifestJson?.tables) ? v.manifestJson!.tables!.length : 0;
            const routeCount = Array.isArray(v.manifestJson?.routes) ? v.manifestJson!.routes!.length : 0;
            return (
              <Card key={v.id} data-testid={`card-version-${v.version}`}>
                <CardContent className="py-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      v{v.version}
                      {currentVersion?.id === v.id && <Badge>Instalada</Badge>}
                      {latestPublished?.id === v.id && <Badge variant="outline">Mais recente</Badge>}
                      {!v.publishedAt && !v.rejectedAt && !v.submittedAt && (
                        <Badge variant="secondary">Rascunho</Badge>
                      )}
                      {!v.publishedAt && !v.rejectedAt && !!v.submittedAt && (
                        <Badge variant="outline">Em revisão</Badge>
                      )}
                      {v.rejectedAt && <Badge variant="destructive">Rejeitada</Badge>}
                    </div>
                    {v.changelog && <p className="text-sm text-muted-foreground mt-1">{v.changelog}</p>}
                    {v.rejectedAt && v.reviewNotes && (
                      <p className="text-xs text-destructive mt-1">Motivo: {v.reviewNotes}</p>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {tableCount > 0 && `${tableCount} tabelas`}
                      {tableCount > 0 && routeCount > 0 && " · "}
                      {routeCount > 0 && `${routeCount} rotas`}
                    </div>
                  </div>
                  {installation?.status === "installed" &&
                    !!v.publishedAt &&
                    currentVersion?.id !== v.id &&
                    canInstall && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rollbackMutation.mutate(v.id)}
                      disabled={rollbackMutation.isPending}
                      data-testid={`button-rollback-${v.version}`}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" /> Usar esta versão
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="reviews" className="space-y-3">
          {!isOwner && installation?.status === "installed" && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sua avaliação</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <StarRating value={reviewRating} onChange={setReviewRating} />
                <Textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Comentário (opcional)"
                  rows={3}
                  data-testid="textarea-review"
                />
                <Button onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending} data-testid="button-submit-review-rating">
                  Enviar avaliação
                </Button>
              </CardContent>
            </Card>
          )}
          {reviews.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Sem avaliações ainda.</CardContent></Card>
          ) : reviews.map(({ review, tenant }) => (
            <Card key={review.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{tenant?.name || "Tenant"}</span>
                  <StarRating value={review.rating} />
                </div>
                {review.comment && <p className="text-sm text-muted-foreground">{review.comment}</p>}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
