import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Upload, FileText, Image as ImageIcon, FileSpreadsheet, FileVideo, FileAudio,
  Download, Trash2, Sparkles, Search, Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ScrumAgentDialog } from "./ScrumAgentDialog";

interface ProjectFile {
  id: string;
  fileName: string;
  originalName: string | null;
  fileType: string;
  mimeType: string | null;
  fileSize: number;
  categoria: string | null;
  description: string | null;
  taskId: string | null;
  subprojectId: string | null;
  extractedText: string | null;
  createdAt: string;
}

const CATEGORIAS = [
  { value: "todos", label: "Todos" },
  { value: "documento", label: "Documentos" },
  { value: "spec", label: "Especificações" },
  { value: "ata", label: "Atas" },
  { value: "imagem", label: "Imagens" },
  { value: "outro", label: "Outros" },
];

function fileIcon(type: string) {
  if (type === "image") return ImageIcon;
  if (type === "spreadsheet") return FileSpreadsheet;
  if (type === "video") return FileVideo;
  if (type === "audio") return FileAudio;
  return FileText;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectDrive({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [filtroCat, setFiltroCat] = useState("todos");
  const [search, setSearch] = useState("");
  const [agentFile, setAgentFile] = useState<ProjectFile | null>(null);

  const { data: files = [], isLoading } = useQuery<ProjectFile[]>({
    queryKey: ["/api/projects", projectId, "drive"],
  });

  const filtered = files.filter((f) => {
    if (filtroCat !== "todos" && f.categoria !== filtroCat) return false;
    if (search) {
      const s = search.toLowerCase();
      const name = (f.originalName || f.fileName || "").toLowerCase();
      const text = (f.extractedText || "").toLowerCase();
      if (!name.includes(s) && !text.includes(s)) return false;
    }
    return true;
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("categoria", "documento");
      const res = await fetch(`/api/projects/${projectId}/drive`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drive"] });
      setUploadProgress(null);
      toast({ title: "Arquivo enviado" });
    },
    onError: (err: any) => {
      setUploadProgress(null);
      toast({ title: "Erro no upload", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/drive/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "drive"] });
      toast({ title: "Arquivo removido" });
    },
  });

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadProgress(0);
    for (let i = 0; i < fileList.length; i++) {
      setUploadProgress(Math.round(((i + 1) / fileList.length) * 100));
      await uploadMutation.mutateAsync(fileList[i]);
    }
  }

  async function handleDownload(file: ProjectFile) {
    const res = await apiRequest("GET", `/api/projects/${projectId}/drive/${file.id}/download`);
    const data = await res.json();
    window.open(data.url, "_blank");
  }

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        data-testid="dropzone-drive"
      >
        <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
        <p className="font-medium mb-1">Arraste arquivos ou</p>
        <Button onClick={() => inputRef.current?.click()} data-testid="button-upload-files">
          Selecionar Arquivos
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <p className="text-xs text-muted-foreground mt-3">
          PDF, DOCX, XLSX, CSV, imagens, vídeos · até 25 MB cada · texto extraído automaticamente
        </p>
        {uploadProgress !== null && (
          <Progress value={uploadProgress} className="mt-3 max-w-xs mx-auto" />
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou conteúdo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-search-drive"
          />
        </div>
        <div className="flex gap-1">
          {CATEGORIAS.map((c) => (
            <Button
              key={c.value}
              variant={filtroCat === c.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFiltroCat(c.value)}
              data-testid={`filter-cat-${c.value}`}
            >
              {c.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : filtered.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Folder className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">Nenhum arquivo encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2">
          {filtered.map((f) => {
            const Icon = fileIcon(f.fileType);
            return (
              <Card key={f.id} className="border-card-border hover-elevate" data-testid={`card-file-${f.id}`}>
                <CardContent className="p-3 flex items-center gap-3">
                  <Icon className="h-8 w-8 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium truncate" data-testid={`text-file-name-${f.id}`}>
                        {f.originalName || f.fileName}
                      </h4>
                      {f.taskId && (
                        <Badge variant="secondary" size="sm" className="shrink-0">vinculado a tarefa</Badge>
                      )}
                      {f.extractedText && (
                        <Badge variant="outline" size="sm" className="shrink-0">texto extraído</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-3">
                      <span>{formatBytes(f.fileSize)}</span>
                      <span>{new Date(f.createdAt).toLocaleDateString('pt-BR')}</span>
                      {f.categoria && <span>· {f.categoria}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {f.extractedText && (
                      <Button
                        variant="outline" size="sm"
                        onClick={() => setAgentFile(f)}
                        data-testid={`button-analyze-${f.id}`}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                        Analisar
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => handleDownload(f)}
                      data-testid={`button-download-${f.id}`}>
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => {
                        if (confirm(`Excluir "${f.originalName || f.fileName}"?`)) deleteMutation.mutate(f.id);
                      }}
                      data-testid={`button-delete-file-${f.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {agentFile && (
        <ScrumAgentDialog
          open={!!agentFile}
          onClose={() => setAgentFile(null)}
          projectId={projectId}
          fileId={agentFile.id}
          fileName={agentFile.originalName || agentFile.fileName}
        />
      )}
    </div>
  );
}
