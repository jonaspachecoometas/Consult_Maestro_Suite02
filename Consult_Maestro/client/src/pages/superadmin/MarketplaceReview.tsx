import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Shield, ArrowRight, Check, X, FileSearch } from "lucide-react";

type BillingModel = "free" | "per_install" | "monthly";

interface QueueAppRow {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  category: string;
  billingModel: BillingModel;
  priceCents: number;
  status: string;
}

interface ManifestColumn { name: string; type: string; nullable?: boolean }
interface ManifestTable { name: string; columns?: ManifestColumn[] }
interface ManifestRoute { method: string; path: string }
interface ManifestMenu { title: string; url: string }
interface ManifestDep { module: string; minVersion?: string }
interface MarketplaceManifest {
  tables?: ManifestTable[];
  routes?: ManifestRoute[];
  menu?: ManifestMenu[];
  dependencies?: ManifestDep[];
}

interface QueueVersionRow {
  id: string;
  version: string;
  changelog: string | null;
  manifestJson: MarketplaceManifest | null;
  schemaDiff: unknown;
  filesSnapshot: Record<string, string> | null;
  publishedAt: string | null;
  rejectedAt: string | null;
}

interface QueueRow {
  app: QueueAppRow;
  owner: { id: string; name: string } | null;
  latestVersion: QueueVersionRow | null;
  previousVersion: QueueVersionRow | null;
  filesCount: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function VersionDiffPanel({ row }: { row: QueueRow }) {
  const v = row.latestVersion;
  const prev = row.previousVersion;
  if (!v) return <p className="text-sm text-muted-foreground">Nenhuma versão associada.</p>;

  const manifest: MarketplaceManifest = v.manifestJson ?? {};
  const tables: ManifestTable[] = Array.isArray(manifest.tables) ? manifest.tables : [];
  const routes: ManifestRoute[] = Array.isArray(manifest.routes) ? manifest.routes : [];
  const menu: ManifestMenu[] = Array.isArray(manifest.menu) ? manifest.menu : [];
  const deps: ManifestDep[] = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  const schemaDiff = v.schemaDiff ?? null;
  const filesSnapshot = v.filesSnapshot;
  const fileNames = filesSnapshot && typeof filesSnapshot === "object"
    ? Object.keys(filesSnapshot)
    : [];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Badge>v{v.version}</Badge>
        {prev && <Badge variant="outline">Anterior: v{prev.version}</Badge>}
        {!prev && <Badge variant="secondary">Primeira versão</Badge>}
      </div>
      {v.changelog && (
        <div>
          <div className="font-semibold mb-1">Changelog</div>
          <p className="text-muted-foreground whitespace-pre-wrap">{v.changelog}</p>
        </div>
      )}

      <div>
        <div className="font-semibold mb-1">Tabelas ({tables.length})</div>
        {tables.length === 0 ? (
          <p className="text-muted-foreground text-xs">Sem tabelas declaradas.</p>
        ) : (
          <div className="space-y-2">
            {tables.map((t, i) => (
              <Card key={i} className="border-muted">
                <CardContent className="py-2">
                  <div className="font-mono text-xs font-semibold">mkt_{row.app.slug.replace(/-/g, "_")}_{t.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {(t.columns ?? []).map((c) => `${c.name}:${c.type}${c.nullable === false ? " NOT NULL" : ""}`).join(" · ")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="font-semibold mb-1">Rotas declaradas ({routes.length})</div>
        {routes.length === 0 ? (
          <p className="text-muted-foreground text-xs">Sem rotas (CRUD genérico via /api/mkt/{row.app.slug}/&lt;resource&gt;).</p>
        ) : (
          <div className="text-xs text-muted-foreground font-mono space-y-0.5">
            {routes.map((r, i) => (
              <div key={i}>{r.method} {r.path}</div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="font-semibold mb-1">Menu lateral ({menu.length})</div>
        {menu.length === 0 ? (
          <p className="text-muted-foreground text-xs">Sem itens de menu.</p>
        ) : (
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {menu.map((m, i) => (
              <li key={i}>• {m.title} → {m.url}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="font-semibold mb-1">Dependências ({deps.length})</div>
        {deps.length === 0 ? (
          <p className="text-muted-foreground text-xs">Sem dependências de outros módulos.</p>
        ) : (
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {deps.map((d, i) => (
              <li key={i}>• {d.module}{d.minVersion ? ` (>= ${d.minVersion})` : ""}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="font-semibold mb-1">Arquivos do pacote ({row.filesCount})</div>
        {fileNames.length === 0 ? (
          <p className="text-muted-foreground text-xs">Sem arquivos materializados.</p>
        ) : (
          <div className="text-xs text-muted-foreground font-mono max-h-32 overflow-y-auto">
            {fileNames.slice(0, 50).map((n, i) => (
              <div key={i}>{n}</div>
            ))}
            {fileNames.length > 50 && <div>...e mais {fileNames.length - 50}</div>}
          </div>
        )}
      </div>

      {schemaDiff !== null && schemaDiff !== undefined && (
        <div>
          <div className="font-semibold mb-1">Schema diff vs versão anterior</div>
          <pre className="text-xs bg-muted p-2 rounded max-h-48 overflow-auto">
            {typeof schemaDiff === "string" ? schemaDiff : JSON.stringify(schemaDiff, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function MarketplaceReview() {
  const { toast } = useToast();
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [notes, setNotes] = useState("");

  const { data, isLoading } = useQuery<QueueRow[]>({
    queryKey: ["/api/marketplace/admin/queue"],
  });

  const reviewMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/marketplace/apps/${selected!.app.id}/review`, {
        decision, notes: notes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: decision === "approve" ? "App aprovado e publicado" : "App rejeitado",
      });
      setSelected(null);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/admin/queue"] });
    },
    onError: (e) => toast({ title: "Erro", description: errorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-semibold flex items-center gap-2" data-testid="text-page-title">
          <Shield className="h-7 w-7 text-primary" /> Revisão do Marketplace
        </h1>
        <p className="text-muted-foreground mt-1">
          Aprove ou rejeite apps submetidos por tenants. Apps aprovados ficam visíveis a todos.
        </p>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-8">Carregando...</CardContent></Card>
      ) : (data ?? []).length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Fila vazia.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {data!.map((row) => {
            const tableCount = Array.isArray(row.latestVersion?.manifestJson?.tables)
              ? row.latestVersion!.manifestJson!.tables!.length
              : 0;
            const routeCount = Array.isArray(row.latestVersion?.manifestJson?.routes)
              ? row.latestVersion!.manifestJson!.routes!.length
              : 0;
            return (
              <Card key={row.app.id} data-testid={`card-queue-${row.app.slug}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {row.app.title}
                        {row.latestVersion && <Badge variant="outline">v{row.latestVersion.version}</Badge>}
                        {row.app.status === "published" && (
                          <Badge variant="secondary" data-testid={`badge-update-${row.app.slug}`}>Atualização</Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">{row.app.shortDescription}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span>Owner: <strong>{row.owner?.name ?? "—"}</strong></span>
                        <span>Categoria: {row.app.category}</span>
                        <span>Cobrança: {row.app.billingModel}</span>
                        {row.app.priceCents > 0 && <span>R${(row.app.priceCents/100).toFixed(2)}</span>}
                        {row.latestVersion && (
                          <>
                            <span>Tabelas: {tableCount}</span>
                            <span>Rotas: {routeCount}</span>
                            <span>Arquivos: {row.filesCount}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 min-w-[200px]">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid={`button-diff-${row.app.slug}`}
                          >
                            <FileSearch className="h-3 w-3 mr-1" /> Ver diff
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>{row.app.title} — versão a aprovar</DialogTitle>
                          </DialogHeader>
                          <VersionDiffPanel row={row} />
                        </DialogContent>
                      </Dialog>
                      <Link href={`/app-store/${row.app.slug}`}>
                        <Button variant="outline" size="sm" className="w-full" data-testid={`button-view-${row.app.slug}`}>
                          Ver detalhes <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            onClick={() => { setSelected(row); setDecision("approve"); setNotes(""); }}
                            data-testid={`button-approve-${row.app.slug}`}
                          >
                            <Check className="h-3 w-3 mr-1" /> Aprovar
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Aprovar {selected?.app.title}?</DialogTitle></DialogHeader>
                          <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Observações (opcional)"
                            rows={3}
                            data-testid="textarea-notes-approve"
                          />
                          <DialogFooter>
                            <Button onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending} data-testid="button-confirm-approve">
                              Aprovar e publicar
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => { setSelected(row); setDecision("reject"); setNotes(""); }}
                            data-testid={`button-reject-${row.app.slug}`}
                          >
                            <X className="h-3 w-3 mr-1" /> Rejeitar
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Rejeitar {selected?.app.title}?</DialogTitle></DialogHeader>
                          <Textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Motivo (será visível ao owner)"
                            rows={4}
                            data-testid="textarea-notes-reject"
                          />
                          <DialogFooter>
                            <Button
                              variant="destructive"
                              onClick={() => reviewMutation.mutate()}
                              disabled={reviewMutation.isPending || !notes.trim()}
                              data-testid="button-confirm-reject"
                            >
                              Rejeitar
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
