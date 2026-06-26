import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Star, Package, CheckCircle2, Crown, Building2, Download, Trash2, RefreshCw } from "lucide-react";
import { useSystemRole } from "@/hooks/useSystemRole";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface MarketplaceAppRow {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  billingModel: "free" | "per_install" | "monthly";
  priceCents: number;
  iconUrl: string | null;
  installCount: number;
  ratingAvg: string | null;
  ratingCount: number;
  installation: { id: string; status: string; installedVersionId: string | null } | null;
  isOwner: boolean;
  ownerTenantId: string;
  ownerName: string | null;
  currentVersionId: string | null;
}

const CATEGORIES = [
  { value: "all", label: "Todas" },
  { value: "geral", label: "Geral" },
  { value: "financeiro", label: "Financeiro" },
  { value: "rh", label: "RH" },
  { value: "vendas", label: "Vendas" },
  { value: "operacional", label: "Operacional" },
];

function priceLabel(app: MarketplaceAppRow): string {
  if (app.billingModel === "free") return "Grátis";
  const value = (app.priceCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return app.billingModel === "monthly" ? `${value}/mês` : value;
}

export default function AppStore() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const { isSuperadmin, isPartner, isTenantAdmin } = useSystemRole();
  const canPublish = isSuperadmin || isPartner || isTenantAdmin;
  // install/uninstall só para tenant admin (alinhado com authInstall do backend).
  const canInstall = isSuperadmin || isTenantAdmin;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const installMutation = useMutation({
    mutationFn: async (appId: string) => {
      const res = await apiRequest("POST", `/api/marketplace/apps/${appId}/install`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Módulo instalado", description: "Pronto para usar no seu tenant." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installed-menu"] });
    },
    onError: (e: unknown) => toast({
      title: "Erro ao instalar",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

  const uninstallMutation = useMutation({
    mutationFn: async (installationId: string) => {
      await apiRequest("DELETE", `/api/marketplace/installations/${installationId}`);
    },
    onSuccess: () => {
      toast({ title: "Módulo desinstalado", description: "Os dados foram preservados para reinstalar depois." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installed-menu"] });
    },
    onError: (e: unknown) => toast({
      title: "Erro ao desinstalar",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

  const updateMutation = useMutation({
    mutationFn: async (params: { installationId: string; versionId: string }) => {
      const res = await apiRequest("POST", `/api/marketplace/installations/${params.installationId}/update`, {
        versionId: params.versionId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Módulo atualizado", description: "Migrado para a versão mais recente." });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/apps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/installed-menu"] });
    },
    onError: (e: unknown) => toast({
      title: "Erro ao atualizar",
      description: e instanceof Error ? e.message : String(e),
      variant: "destructive",
    }),
  });

  const { data, isLoading } = useQuery<MarketplaceAppRow[]>({
    queryKey: ["/api/marketplace/apps", { category }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/marketplace/apps?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao carregar");
      return res.json();
    },
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((a) =>
      `${a.title} ${a.shortDescription}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-semibold flex items-center gap-2" data-testid="text-page-title">
            <Package className="h-7 w-7 text-primary" /> App Store
          </h1>
          <p className="text-muted-foreground mt-1">
            Módulos prontos para o seu tenant. Publique os seus para outros tenants instalarem.
          </p>
        </div>
        {canPublish && (
          <Link href="/app-store/publicar">
            <Button data-testid="button-publish-app">Publicar Módulo</Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou descrição"
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]" data-testid="select-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum módulo publicado encontrado.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((app) => {
            const isInstalled = app.installation?.status === "installed";
            const hasUpdate =
              isInstalled &&
              app.currentVersionId &&
              app.installation?.installedVersionId &&
              app.installation.installedVersionId !== app.currentVersionId;
            const isPending = installMutation.isPending || uninstallMutation.isPending || updateMutation.isPending;
            return (
              <Card
                key={app.id}
                className="h-full transition-all hover-elevate flex flex-col"
                data-testid={`card-app-${app.slug}`}
              >
                <Link href={`/app-store/${app.slug}`}>
                  <div className="cursor-pointer">
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        {app.iconUrl ? (
                          <img src={app.iconUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                        ) : (
                          <div className="h-12 w-12 rounded-md bg-primary/10 flex items-center justify-center">
                            <Package className="h-6 w-6 text-primary" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base flex items-center gap-2 truncate">
                            {app.title}
                            {app.isOwner && (
                              <Badge variant="outline" className="text-xs">
                                <Crown className="h-3 w-3 mr-1" /> Seu
                              </Badge>
                            )}
                          </CardTitle>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="secondary" className="text-xs">{app.category}</Badge>
                            {app.ownerName && (
                              <span
                                className="text-xs text-muted-foreground flex items-center gap-1 truncate"
                                data-testid={`text-owner-${app.slug}`}
                              >
                                <Building2 className="h-3 w-3" /> {app.ownerName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground line-clamp-2">{app.shortDescription}</p>
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-3 text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Star className="h-3.5 w-3.5" />
                            {app.ratingAvg ? Number(app.ratingAvg).toFixed(1) : "—"}
                          </span>
                          <span>{app.installCount} instalações</span>
                        </div>
                        <span className="font-medium" data-testid={`text-price-${app.slug}`}>
                          {priceLabel(app)}
                        </span>
                      </div>
                    </CardContent>
                  </div>
                </Link>
                <div className="px-6 pb-6 mt-auto">
                  {app.isOwner ? (
                    <Badge className="w-full justify-center" variant="outline">
                      <Crown className="h-3.5 w-3.5 mr-1" /> Você é o autor
                    </Badge>
                  ) : isInstalled ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Badge className="flex-1 justify-center py-2" variant={hasUpdate ? "outline" : "default"}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          {hasUpdate ? "Atualização disponível" : "Instalado"}
                        </Badge>
                        {canInstall && app.installation && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => uninstallMutation.mutate(app.installation!.id)}
                            disabled={isPending}
                            data-testid={`button-uninstall-${app.slug}`}
                            aria-label="Desinstalar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      {canInstall && hasUpdate && app.installation && app.currentVersionId && (
                        <Button
                          className="w-full"
                          size="sm"
                          variant="default"
                          onClick={() => updateMutation.mutate({
                            installationId: app.installation!.id,
                            versionId: app.currentVersionId!,
                          })}
                          disabled={isPending}
                          data-testid={`button-update-${app.slug}`}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" /> Atualizar
                        </Button>
                      )}
                    </div>
                  ) : canInstall ? (
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => installMutation.mutate(app.id)}
                      disabled={isPending}
                      data-testid={`button-install-${app.slug}`}
                    >
                      <Download className="h-4 w-4 mr-2" /> Instalar
                    </Button>
                  ) : (
                    <Link href={`/app-store/${app.slug}`}>
                      <Button className="w-full" size="sm" variant="outline">
                        Ver detalhes
                      </Button>
                    </Link>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
