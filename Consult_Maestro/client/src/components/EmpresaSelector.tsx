import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STORAGE_KEY = "arcadia_empresa_ativa";

export function useActiveEmpresa() {
  const [empresaId, setEmpresaIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );

  const setEmpresaId = (id: string | null) => {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    setEmpresaIdState(id);
    // força reload das queries que dependem do header
    window.dispatchEvent(new CustomEvent("empresa-changed", { detail: id }));
  };

  return { empresaId, setEmpresaId };
}

type Empresa = {
  id: number;
  nomeFantasia: string | null;
  razaoSocial: string;
  cnpj: string;
};

export function EmpresaSelector() {
  const { data: empresas = [] } = useQuery<Empresa[]>({
    queryKey: ["/api/empresas"],
    staleTime: 5 * 60 * 1000,
  });

  const { empresaId, setEmpresaId } = useActiveEmpresa();

  // Pré-seleciona a primeira se não houver nenhuma selecionada
  useEffect(() => {
    if (!empresaId && empresas.length > 0) {
      setEmpresaId(String(empresas[0].id));
    }
  }, [empresas, empresaId]);

  // Só renderiza quando há 2 ou mais empresas
  if (empresas.length < 2) return null;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <Select
        value={empresaId ?? ""}
        onValueChange={(val) => setEmpresaId(val)}
      >
        <SelectTrigger className="h-8 w-full border-dashed text-xs">
          <SelectValue placeholder="Selecionar empresa…" />
        </SelectTrigger>
        <SelectContent>
          {empresas.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {e.nomeFantasia ?? e.razaoSocial}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
