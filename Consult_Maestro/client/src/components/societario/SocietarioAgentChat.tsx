import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bot, Send, Loader2, Sparkles, User } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface ChatResponse {
  reply: string;
  agentName: string;
  agentSource: "tenant" | "global";
  provider: "tenant" | "platform";
  model: string;
  usedSociedadeId: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sociedadeId?: string | null;
  sociedadeName?: string | null;
}

const SUGGESTIONS_DETAIL = [
  "Faça um diagnóstico societário desta empresa.",
  "Quais obrigações estão vencendo? Priorize por urgência.",
  "Soma das participações dos sócios bate 100%? Há riscos?",
  "Sugira o próximo passo prático para esta sociedade.",
];
const SUGGESTIONS_LIST = [
  "Quais sociedades exigem ação imediata?",
  "Quantos certificados digitais vão vencer nos próximos 60 dias?",
  "Qual a distribuição da carteira por regime tributário?",
  "Resuma os pontos críticos da carteira hoje.",
];

export function SocietarioAgentChat({ open, onOpenChange, sociedadeId, sociedadeName }: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastContextKey = useRef<string | null>(null);

  // Reset chat history when context changes (different sociedade or list mode)
  useEffect(() => {
    const key = sociedadeId || "__list__";
    if (lastContextKey.current !== key) {
      lastContextKey.current = key;
      setMessages([]);
      setInput("");
    }
  }, [sociedadeId]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [messages, open]);

  const chat = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/societario/agent/chat", {
        message,
        sociedadeId: sociedadeId || null,
        history: messages,
      });
      return res.json() as Promise<ChatResponse>;
    },
    onSuccess: (data) => {
      setMessages((m) => [...m, { role: "assistant", content: data.reply || "(sem resposta)" }]);
    },
    onError: (e: any) => {
      toast({ title: "Erro no agente", description: e?.message || "Falha ao chamar o agente", variant: "destructive" });
      setMessages((m) => m.slice(0, -1));
    },
  });

  function send(text?: string) {
    const value = (text ?? input).trim();
    if (!value || chat.isPending) return;
    setMessages((m) => [...m, { role: "user", content: value }]);
    setInput("");
    chat.mutate(value);
  }

  const suggestions = sociedadeId ? SUGGESTIONS_DETAIL : SUGGESTIONS_LIST;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col p-0"
        data-testid="sheet-societario-agent"
      >
        <SheetHeader className="px-5 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Agente Societário
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {sociedadeId ? "contexto: sociedade" : "contexto: carteira"}
            </Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {sociedadeId
              ? `Conversando sobre ${sociedadeName || "a sociedade aberta"}. Dados da empresa, sócios, obrigações e certificados são injetados automaticamente.`
              : "Visão da carteira do tenant. Pergunte sobre obrigações pendentes, certificados vencendo e distribuição."}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1" ref={scrollRef as any}>
          <div className="px-5 py-4 space-y-3" data-testid="chat-messages">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <span>
                    Pergunte ao agente sobre direito empresarial, prazos, alterações societárias e
                    riscos da {sociedadeId ? "sociedade aberta" : "carteira"}. As respostas usam os
                    dados em tempo real do módulo.
                  </span>
                </div>
                <div className="grid gap-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => send(s)}
                      className="text-left text-xs rounded-md border px-3 py-2 hover-elevate"
                      data-testid={`button-suggestion-${i}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${m.role}-${i}`}
              >
                {m.role === "assistant" && (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {m.content}
                </div>
                {m.role === "user" && (
                  <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}

            {chat.isPending && (
              <div className="flex gap-2 justify-start" data-testid="loading-indicator">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-lg px-3 py-2 bg-muted text-sm flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pensando…
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-5 py-3 space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Pergunte ao Agente Societário…  (Enter envia, Shift+Enter quebra linha)"
            rows={2}
            className="text-sm resize-none"
            disabled={chat.isPending}
            data-testid="input-chat-message"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              O agente lê os dados em tempo real do módulo Societário.
            </span>
            <Button
              size="sm"
              onClick={() => send()}
              disabled={!input.trim() || chat.isPending}
              data-testid="button-send-chat"
            >
              {chat.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5 mr-1.5" />
              )}
              Enviar
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
