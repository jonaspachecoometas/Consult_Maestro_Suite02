import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

// /clientes → /pessoas
// /clientes/novo → /pessoas (a criação agora é feita por dialog na própria lista)
// /clientes/:id → /pessoas/:novoId (resolvido por legacyClientId; fallback /pessoas)
// /clientes/:id/editar → /pessoas/:novoId (mesma resolução)
export default function ClientesLegacyRedirect() {
  const [, setLocation] = useLocation();
  const [matchEdit, paramsEdit] = useRoute<{ id: string }>("/clientes/:id/editar");
  const [matchDetail, paramsDetail] = useRoute<{ id: string }>("/clientes/:id");
  const [matchNew] = useRoute("/clientes/novo");
  const [matchList] = useRoute("/clientes");

  const legacyId =
    (matchEdit && paramsEdit?.id) ||
    (matchDetail && paramsDetail?.id && paramsDetail.id !== "novo" ? paramsDetail.id : null);

  const { data, isLoading, isError } = useQuery<{ id: string }>({
    queryKey: ["/api/pessoas/by-legacy-client", legacyId],
    enabled: !!legacyId,
    retry: false,
  });

  useEffect(() => {
    if (matchList || matchNew) {
      setLocation("/pessoas");
      return;
    }
    if (!legacyId) return;
    if (data?.id) setLocation(`/pessoas/${data.id}`);
    else if (isError) setLocation("/pessoas");
  }, [matchList, matchNew, legacyId, data, isError, setLocation]);

  return (
    <div
      className="flex h-full items-center justify-center gap-3 text-muted-foreground"
      data-testid="text-redirecting-clientes"
    >
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>
        {isLoading
          ? "Localizando o cadastro em Pessoas…"
          : "Redirecionando para Pessoas…"}
      </span>
    </div>
  );
}
