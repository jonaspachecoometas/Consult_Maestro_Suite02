// Sprint IDE-3 — Aba colapsável "Planejador" no Explorer.
// Atalho leve para abrir o /planejador do Module Planner existente.
// Para evitar duplicação de UI, não implementa formulário próprio: link + dica.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Wand2, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";

export function ModulePlannerTab() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover-elevate"
        data-testid="button-toggle-planner"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wand2 className="h-3 w-3" />
        <span>PLANEJADOR DE MÓDULO</span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          <p className="mb-2 text-[10px] leading-snug text-muted-foreground">
            Descreva um módulo em linguagem natural e gere um plano técnico estruturado
            (schema, rotas, telas, agentes). O plano alimenta o Pipeline.
          </p>
          <Button
            size="sm" variant="outline" className="h-6 w-full gap-1 text-[11px]"
            onClick={() => setLocation("/planejador")}
            data-testid="link-open-planner"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir Planejador
          </Button>
        </div>
      )}
    </div>
  );
}
