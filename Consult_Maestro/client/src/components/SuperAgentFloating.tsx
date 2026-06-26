import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sparkles } from "lucide-react";
import { SuperAgentChat } from "./SuperAgentChat";
import { useAuth } from "@/hooks/useAuth";

export function SuperAgentFloating() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-4 right-4 h-12 w-12 rounded-full shadow-lg z-40"
          data-testid="button-super-agent-floating"
          title="Super Agente"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-5xl xl:max-w-6xl flex flex-col"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Super Agente (modo global)
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 mt-4">
          <SuperAgentChat heightClass="h-full" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
