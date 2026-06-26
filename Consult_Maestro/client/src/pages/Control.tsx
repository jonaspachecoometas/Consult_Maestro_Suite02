import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Wallet, ArrowRight, Search, Sparkles, Building2 } from "lucide-react";
import { useState, useMemo } from "react";
import { ModuleAgentBanner } from "@/components/agent/ModuleAgentBanner";

interface Cliente {
  id: string;
  // O backend usa nomes em inglês (name/company/industry); mantemos opcionais para
  // tolerar registros antigos com campos vazios.
  name?: string;
  company?: string;
  industry?: string;
  cnpj?: string;
  email?: string;
}

interface PlanoConta {
  id: string;
  codigo: string;
}

export default function Control() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: clientes = [], isLoading } = useQuery<Cliente[]>({ queryKey: ["/api/clients"] });
  const { data: planosContas = [] } = useQuery<PlanoConta[]>({ queryKey: ["/api/control/planos-contas"] });

  // Bootstrap: garante que o tenant tem o plano de contas seedado
  const bootstrap = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/control/bootstrap"),
    onSuccess: async (r: any) => {
      const data = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/control/planos-contas"] });
      if (data.created > 0) {
        toast({ title: "Plano de contas inicializado", description: `${data.created} contas padrão CFC carregadas.` });
      }
    },
  });

  useEffect(() => {
    if (planosContas.length === 0 && !bootstrap.isPending) {
      bootstrap.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planosContas.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => {
      const haystack = [c.name, c.company, c.industry, c.cnpj, c.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [clientes, search]);

  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-control">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-8 w-8 text-primary" />
            Arcádia Control
          </h1>
          <p className="text-muted-foreground mt-1">
            Controller as a Service — selecione um cliente para abrir o workspace financeiro
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1" data-testid="badge-plano-contas">
            <Sparkles className="h-3 w-3" />
            Plano de contas: {planosContas.length} contas
          </Badge>
        </div>
      </div>

      <ModuleAgentBanner module="control" label="Arcádia Control" />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Workspaces de Cliente</CardTitle>
          <CardDescription>
            Cada cliente tem seu próprio workspace de Controller com lançamentos, contas bancárias e relatórios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente por nome ou CNPJ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-search-cliente"
            />
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Nenhum cliente encontrado.</p>
              <Link href="/clientes/novo">
                <Button variant="outline" size="sm" className="mt-3" data-testid="link-novo-cliente">
                  Cadastrar cliente
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((cliente) => (
                <Link key={cliente.id} href={`/control/${cliente.id}`}>
                  <Card className="hover-elevate active-elevate-2 cursor-pointer transition-shadow" data-testid={`card-cliente-${cliente.id}`}>
                    <CardContent className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate" data-testid={`text-cliente-nome-${cliente.id}`}>
                          {cliente.name || cliente.company || "(sem nome)"}
                        </div>
                        {cliente.company && cliente.name && cliente.company !== cliente.name && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">{cliente.company}</div>
                        )}
                        {cliente.cnpj && (
                          <div className="text-xs text-muted-foreground mt-1">CNPJ {cliente.cnpj}</div>
                        )}
                        {cliente.industry && (
                          <Badge variant="secondary" className="mt-2 text-xs">{cliente.industry}</Badge>
                        )}
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground self-center" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
