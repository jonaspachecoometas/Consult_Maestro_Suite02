import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Send, Sparkles, Loader2, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Session {
  id: string;
  titulo: string;
  createdAt: string;
}

interface Msg {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export function TaskAgentChat({ taskId }: { taskId: string }) {
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: sessions = [], isLoading: loadingSessions } = useQuery<Session[]>({
    queryKey: ["/api/tasks", taskId, "agent", "sessions"],
  });

  useEffect(() => {
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const { data: messages = [] } = useQuery<Msg[]>({
    queryKey: ["/api/tasks", taskId, "agent", "sessions", activeSessionId, "messages"],
    enabled: !!activeSessionId,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const newSession = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tasks/${taskId}/agent/sessions`, {});
      return res.json();
    },
    onSuccess: (s) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "agent", "sessions"] });
      setActiveSessionId(s.id);
    },
  });

  const sendMsg = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest(
        "POST",
        `/api/tasks/${taskId}/agent/sessions/${activeSessionId}/messages`,
        { content }
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/tasks", taskId, "agent", "sessions", activeSessionId, "messages"],
      });
      setDraft("");
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  function handleSend() {
    const t = draft.trim();
    if (!t || !activeSessionId) return;
    sendMsg.mutate(t);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-3 h-[500px]">
      <Card className="border-card-border">
        <CardContent className="p-2 space-y-1">
          <Button
            variant="default" size="sm" className="w-full"
            onClick={() => newSession.mutate()}
            disabled={newSession.isPending}
            data-testid="button-new-agent-session"
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Nova conversa
          </Button>
          <ScrollArea className="h-[440px]">
            {loadingSessions ? (
              <p className="text-xs text-muted-foreground p-2">Carregando...</p>
            ) : sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Nenhuma conversa ainda.</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveSessionId(s.id)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors ${
                    activeSessionId === s.id ? "bg-muted font-medium" : ""
                  }`}
                  data-testid={`session-${s.id}`}
                >
                  <div className="truncate">{s.titulo}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(s.createdAt).toLocaleDateString("pt-BR")}
                  </div>
                </button>
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="border-card-border flex flex-col">
        <CardContent className="p-3 flex-1 flex flex-col min-h-0">
          {!activeSessionId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                Inicie uma conversa com o Agente Scrum sobre esta tarefa.
              </p>
              <Button onClick={() => newSession.mutate()} disabled={newSession.isPending}
                data-testid="button-start-chat">
                <Sparkles className="h-4 w-4 mr-2" /> Começar
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 pr-2 mb-3" ref={scrollRef as any}>
                <div className="space-y-3" data-testid="chat-messages">
                  {messages.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      Envie uma mensagem para começar a conversa.
                    </p>
                  )}
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                          m.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                        data-testid={`msg-${m.role}-${m.id}`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {sendMsg.isPending && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Pensando...
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
                  }}
                  placeholder="Pergunte ao agente sobre esta tarefa..."
                  rows={2}
                  className="resize-none"
                  data-testid="input-agent-message"
                />
                <Button onClick={handleSend} disabled={!draft.trim() || sendMsg.isPending}
                  data-testid="button-send-message">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
