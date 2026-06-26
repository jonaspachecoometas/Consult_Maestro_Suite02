// Sprint 5 — GitViewer: lista de commits + diff por arquivo + ações de
// branch/revert. Layout 2 colunas: esquerda lista commits e seletor de branch,
// direita mostra diff colorido do commit selecionado.
//
// Estados especiais tratados:
//   - 412: tenant sem Gitea cadastrado → orienta cadastrar em Infraestrutura.
//   - 404 com mensagem "Repositório ainda não criado" → pede primeiro deploy.
//   - 401/500: mostra mensagem genérica e permite retry.

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitBranch, GitCommit, ExternalLink, Plus, Undo2, Loader2, AlertCircle } from "lucide-react";

interface Commit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  date: string;
  htmlUrl?: string;
}

interface Branch {
  name: string;
  commit?: { sha: string };
}

interface CommitsResponse {
  gitRepoUrl: string;
  owner: string;
  repo: string;
  branches: Branch[];
  commits: Commit[];
}

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

interface CommitDetail {
  sha: string;
  message: string;
  authorName: string;
  date: string;
  files: DiffFile[];
}

interface Props {
  projectId: string;
  gitRepoUrl: string | null;
}

export default function GitViewer({ projectId, gitRepoUrl }: Props) {
  const { toast } = useToast();
  const [branch, setBranch] = useState<string>("main");
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const commitsQ = useQuery<CommitsResponse>({
    queryKey: ["/api/ide/projects", projectId, "git/commits", branch],
    queryFn: async () => {
      const res = await fetch(`/api/ide/projects/${projectId}/git/commits?branch=${encodeURIComponent(branch)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err: any = new Error(body?.message || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    retry: false,
    enabled: !!projectId,
  });

  const diffQ = useQuery<CommitDetail>({
    queryKey: ["/api/ide/projects", projectId, "git/commits", selectedSha, "diff"],
    queryFn: async () => {
      const res = await fetch(`/api/ide/projects/${projectId}/git/commits/${selectedSha}/diff`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: !!selectedSha && commitsQ.isSuccess,
  });

  const createBranchMut = useMutation({
    mutationFn: async (name: string) => {
      return apiRequest("POST", `/api/ide/projects/${projectId}/git/branches`, {
        name,
        fromBranch: branch,
      });
    },
    onSuccess: () => {
      toast({ title: "Branch criado", description: `Criado a partir de ${branch}` });
      setShowNewBranch(false);
      setNewBranchName("");
      queryClient.invalidateQueries({ queryKey: ["/api/ide/projects", projectId, "git/commits"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Falha ao criar branch", description: e?.message });
    },
  });

  const revertMut = useMutation({
    mutationFn: async (sha: string) => {
      return apiRequest("POST", `/api/ide/projects/${projectId}/git/commits/${sha}/revert`, { branch });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Commit revertido",
        description: `${data?.reverted ?? 0} arquivo(s) restaurado(s) com novos commits (histórico preservado).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/ide/projects", projectId, "git/commits"] });
    },
    onError: (e: any) => {
      toast({ variant: "destructive", title: "Falha ao reverter", description: e?.message });
    },
  });

  const selectedCommit = useMemo(
    () => commitsQ.data?.commits.find((c) => c.sha === selectedSha) ?? null,
    [commitsQ.data, selectedSha],
  );

  // ----- Estados de erro guiados -----
  if (commitsQ.isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="git-loading">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commitsQ.isError) {
    const err: any = commitsQ.error;
    const status = err?.status;
    return (
      <div className="flex items-center justify-center h-full p-6">
        <Card className="max-w-md p-6 text-center" data-testid="git-error-state">
          <AlertCircle className="h-8 w-8 mx-auto text-amber-500 mb-3" />
          <h3 className="font-semibold mb-2">
            {status === 412 ? "Gitea não configurado" :
             status === 404 ? "Repositório ainda não criado" :
             "Não foi possível carregar o Git"}
          </h3>
          <p className="text-sm text-muted-foreground">{err?.message ?? "Erro desconhecido"}</p>
          {status === 404 && !gitRepoUrl && (
            <p className="text-xs text-muted-foreground mt-3">
              O repositório é criado automaticamente no primeiro deploy aprovado deste projeto.
            </p>
          )}
        </Card>
      </div>
    );
  }

  const data = commitsQ.data!;
  const commits = data.commits;
  const branches = data.branches.length > 0 ? data.branches : [{ name: "main" }];

  return (
    <div className="h-full flex flex-col gap-2" data-testid="git-viewer">
      {/* Header: branch selector + repo link + ações */}
      <div className="flex items-center gap-2 px-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <Select value={branch} onValueChange={setBranch}>
          <SelectTrigger className="h-8 w-[200px] text-xs" data-testid="select-branch">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.name} value={b.name}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={() => setShowNewBranch((v) => !v)}
          data-testid="button-new-branch"
        >
          <Plus className="h-3.5 w-3.5" /> Novo branch
        </Button>
        {showNewBranch && (
          <div className="flex items-center gap-1.5">
            <Input
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder={`a partir de ${branch}`}
              className="h-8 w-[180px] text-xs"
              data-testid="input-new-branch"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!newBranchName || createBranchMut.isPending}
              onClick={() => createBranchMut.mutate(newBranchName)}
              data-testid="button-create-branch"
            >
              {createBranchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Criar"}
            </Button>
          </div>
        )}
        <div className="flex-1" />
        {data.gitRepoUrl && (
          <a
            href={data.gitRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            data-testid="link-git-repo"
          >
            {data.owner}/{data.repo} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* 2 colunas: lista commits | diff */}
      <div className="flex-1 grid grid-cols-[320px_1fr] gap-2 min-h-0 px-2 pb-2">
        {/* Lista de commits */}
        <Card className="flex flex-col min-h-0 overflow-hidden" data-testid="commits-list">
          <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <GitCommit className="h-3.5 w-3.5" /> Commits ({commits.length})
          </div>
          <ScrollArea className="flex-1">
            {commits.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                Nenhum commit ainda — aprove o primeiro deploy.
              </div>
            ) : (
              <ul className="divide-y">
                {commits.map((c) => {
                  const isSel = c.sha === selectedSha;
                  return (
                    <li
                      key={c.sha}
                      onClick={() => setSelectedSha(c.sha)}
                      className={`px-3 py-2 cursor-pointer hover-elevate active-elevate-2 ${isSel ? "bg-accent" : ""}`}
                      data-testid={`commit-row-${c.sha.slice(0, 7)}`}
                    >
                      <div className="text-xs font-medium line-clamp-2">{c.message.split("\n")[0]}</div>
                      <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px] px-1 py-0">{c.sha.slice(0, 7)}</Badge>
                        <span className="truncate">{c.authorName}</span>
                        <span>·</span>
                        <span>{formatDate(c.date)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </Card>

        {/* Diff */}
        <Card className="flex flex-col min-h-0 overflow-hidden" data-testid="commit-diff">
          {!selectedCommit ? (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              Selecione um commit para ver o diff
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold line-clamp-2">{selectedCommit.message}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px] px-1 py-0">{selectedCommit.sha.slice(0, 7)}</Badge>
                    <span>{selectedCommit.authorName}</span>
                    <span>·</span>
                    <span>{formatDate(selectedCommit.date)}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 shrink-0"
                  onClick={() => {
                    if (confirm(`Reverter commit ${selectedCommit.sha.slice(0, 7)}?\n\nIsso cria NOVOS commits restaurando o estado anterior — não reescreve histórico.`)) {
                      revertMut.mutate(selectedCommit.sha);
                    }
                  }}
                  disabled={revertMut.isPending}
                  data-testid="button-revert-commit"
                >
                  {revertMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
                  Reverter
                </Button>
              </div>
              <ScrollArea className="flex-1">
                {diffQ.isLoading ? (
                  <div className="p-6 flex justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : diffQ.isError ? (
                  <div className="p-4 text-xs text-destructive" data-testid="diff-error">
                    {(diffQ.error as any)?.message ?? "Falha ao carregar diff"}
                  </div>
                ) : diffQ.data ? (
                  <DiffFiles files={diffQ.data.files} />
                ) : null}
              </ScrollArea>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function DiffFiles({ files }: { files: DiffFile[] }) {
  if (!files || files.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground">Sem alterações neste commit.</div>;
  }
  return (
    <div className="divide-y" data-testid="diff-files">
      {files.map((f, idx) => (
        <div key={`${f.filename}-${idx}`} className="p-3" data-testid={`diff-file-${idx}`}>
          <div className="flex items-center gap-2 mb-2 text-xs">
            <Badge variant={statusVariant(f.status)} className="text-[10px]">{f.status}</Badge>
            <code className="font-mono text-xs truncate flex-1">{f.filename}</code>
            <span className="text-emerald-600">+{f.additions}</span>
            <span className="text-red-600">−{f.deletions}</span>
          </div>
          {f.patch ? (
            <pre className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto leading-relaxed">
              {f.patch.split("\n").map((line, i) => {
                const cls = line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-700 dark:text-emerald-400 bg-emerald-500/10" :
                            line.startsWith("-") && !line.startsWith("---") ? "text-red-700 dark:text-red-400 bg-red-500/10" :
                            line.startsWith("@@") ? "text-blue-700 dark:text-blue-400 bg-blue-500/10" :
                            "text-muted-foreground";
                return <div key={i} className={`whitespace-pre ${cls}`}>{line || " "}</div>;
              })}
            </pre>
          ) : (
            <div className="text-[11px] text-muted-foreground italic">Patch não disponível (arquivo binário ou muito grande).</div>
          )}
        </div>
      ))}
    </div>
  );
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "added") return "default";
  if (status === "removed") return "destructive";
  if (status === "modified") return "secondary";
  return "outline";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
