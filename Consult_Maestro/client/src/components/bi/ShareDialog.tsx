import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Trash2, Eye, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ShareRow {
  id: string;
  token: string;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  isActive: number;
  createdAt: string;
  hasPassword: boolean;
}

export function ShareDialog({
  dashboardId, open, onClose,
}: {
  dashboardId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [expDays, setExpDays] = useState("30");
  const [newLink, setNewLink] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: shares = [] } = useQuery<ShareRow[]>({
    queryKey: ["/api/bi/dashboards", dashboardId, "shares"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/bi/dashboards/${dashboardId}/shares`);
      return await res.json();
    },
    enabled: !!dashboardId && open,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/bi/dashboards/${dashboardId}/share`, {
        password: password || undefined,
        expiresInDays: expDays ? Number(expDays) : undefined,
      });
      return await res.json();
    },
    onSuccess: (data) => {
      setNewLink(window.location.origin + data.url);
      setPassword("");
      qc.invalidateQueries({ queryKey: ["/api/bi/dashboards", dashboardId, "shares"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (token: string) => apiRequest("DELETE", `/api/bi/shares/${token}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/bi/dashboards", dashboardId, "shares"] });
      toast({ title: "Link revogado" });
    },
  });

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    toast({ title: "Link copiado" });
  }

  const activeShares = shares.filter((s) => s.isActive === 1);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle>Compartilhar dashboard</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Senha (opcional)</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="—"
                className="h-8 text-sm"
                data-testid="input-share-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expira em (dias)</Label>
              <Input
                type="number"
                value={expDays}
                onChange={(e) => setExpDays(e.target.value)}
                className="h-8 text-sm"
                data-testid="input-share-exp-days"
              />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            data-testid="button-create-share"
          >
            {createMutation.isPending ? "Gerando…" : "Gerar novo link"}
          </Button>

          {newLink && (
            <div className="rounded-md border bg-muted/30 p-2 flex items-center gap-2">
              <Input value={newLink} readOnly className="h-7 text-xs flex-1" />
              <Button size="sm" variant="outline" onClick={() => copyLink(newLink)} data-testid="button-copy-new-link">
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Links ativos ({activeShares.length})
            </Label>
            {activeShares.length === 0 && (
              <p className="text-xs text-muted-foreground py-3 text-center">Nenhum link ativo.</p>
            )}
            {activeShares.map((s) => {
              const url = window.location.origin + `/bi/public/${s.token}`;
              return (
                <div key={s.id} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1.5" data-testid={`share-row-${s.token}`}>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono truncate text-[11px]">{s.token.slice(0, 16)}…</div>
                    <div className="flex items-center gap-2 text-muted-foreground text-[10px]">
                      <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" /> {s.viewCount}</span>
                      {s.hasPassword && <Badge variant="outline" className="h-4 text-[9px] gap-0.5"><Lock className="h-2.5 w-2.5" /> Senha</Badge>}
                      {s.expiresAt && <span>exp: {new Date(s.expiresAt).toLocaleDateString("pt-BR")}</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => copyLink(url)} data-testid={`button-copy-${s.token}`}>
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 w-6 p-0 text-destructive"
                    onClick={() => revokeMutation.mutate(s.token)}
                    data-testid={`button-revoke-${s.token}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
