import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient as qc } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Paperclip, Upload, Trash2, FileText, FileImage, File,
  Eye, ExternalLink, X, ZoomIn,
} from "lucide-react";

interface Anexo {
  id: string; tipo: string; nome_arquivo: string;
  url_storage: string; tamanho_bytes?: number;
  mime_type?: string; uploaded_por_nome?: string;
  created_at: string;
}

const TIPOS_ANEXO = [
  { value: "boleto",      label: "Boleto" },
  { value: "nota_fiscal", label: "Nota Fiscal" },
  { value: "contrato",    label: "Contrato" },
  { value: "documento",   label: "Documento" },
  { value: "outro",       label: "Outro" },
];

function TipoLabel({ tipo }: { tipo: string }) {
  const colors: Record<string, string> = {
    boleto:      "bg-blue-100 text-blue-700",
    nota_fiscal: "bg-green-100 text-green-700",
    contrato:    "bg-purple-100 text-purple-700",
    documento:   "bg-gray-100 text-gray-700",
    outro:       "bg-amber-100 text-amber-700",
  };
  const label = TIPOS_ANEXO.find(t => t.value === tipo)?.label || tipo;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[tipo] || colors.outro}`}>
      {label}
    </span>
  );
}

function FileIcon({ mime }: { mime?: string }) {
  if (!mime) return <File className="h-4 w-4 text-muted-foreground" />;
  if (mime.startsWith("image/")) return <FileImage className="h-4 w-4 text-blue-500" />;
  if (mime === "application/pdf") return <FileText className="h-4 w-4 text-red-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function fmtBytes(b?: number) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function AnexoPreviewDialog({ anexo, onClose }: { anexo: Anexo; onClose: () => void }) {
  const isImage = anexo.mime_type?.startsWith("image/");
  const isPdf   = anexo.mime_type === "application/pdf";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0 flex flex-row items-center justify-between">
          <DialogTitle className="text-sm font-medium truncate flex items-center gap-2">
            <FileIcon mime={anexo.mime_type} />
            {anexo.nome_arquivo}
            <TipoLabel tipo={anexo.tipo} />
          </DialogTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Abrir em nova aba"
              onClick={() => {
                const w = window.open();
                if (w) {
                  if (anexo.url_storage.startsWith("data:")) {
                    w.document.write(`<iframe src="${anexo.url_storage}" width="100%" height="100%" style="border:none"></iframe>`);
                  } else {
                    w.location.href = anexo.url_storage;
                  }
                }
              }}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-muted/30 flex items-center justify-center p-2">
          {isImage ? (
            <img
              src={anexo.url_storage}
              alt={anexo.nome_arquivo}
              className="max-w-full max-h-full object-contain rounded shadow"
            />
          ) : (isPdf || anexo.url_storage.startsWith("data:")) ? (
            <iframe
              src={anexo.url_storage}
              title={anexo.nome_arquivo}
              className="w-full h-full rounded border-0"
            />
          ) : (
            <div className="text-center space-y-3 p-8">
              <File className="h-12 w-12 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">
                Pré-visualização não disponível para este tipo de arquivo.
              </p>
              <Button size="sm" variant="outline"
                onClick={() => window.open(anexo.url_storage, "_blank")}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Abrir arquivo
              </Button>
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t text-xs text-muted-foreground flex gap-4 shrink-0">
          {anexo.tamanho_bytes && <span>{fmtBytes(anexo.tamanho_bytes)}</span>}
          {anexo.uploaded_por_nome && <span>Enviado por {anexo.uploaded_por_nome}</span>}
          <span>{new Date(anexo.created_at).toLocaleString("pt-BR")}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  lancamentoId: string;
  readOnly?: boolean;
}

export default function LancamentoAnexos({ lancamentoId, readOnly }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tipoSelecionado, setTipoSelecionado] = useState("documento");
  const [uploading, setUploading] = useState(false);
  const [previewAnexo, setPreviewAnexo] = useState<Anexo | null>(null);

  const { data: anexos = [], isLoading } = useQuery<Anexo[]>({
    queryKey: ["lancamento-anexos", lancamentoId],
    queryFn: () =>
      fetch(`/api/control/lancamentos/${lancamentoId}/anexos`, { credentials: "include" })
        .then(r => r.json()),
    enabled: !!lancamentoId,
  });

  const mutDelete = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/control/anexos/${id}`, { method: "DELETE", credentials: "include" }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lancamento-anexos", lancamentoId] });
      toast({ title: "Anexo removido" });
    },
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "Limite: 20 MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("tipo", tipoSelecionado);
      const r = await fetch(`/api/control/lancamentos/${lancamentoId}/anexos`, {
        method: "POST", body: fd, credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || "Erro no upload");
      }
      qc.invalidateQueries({ queryKey: ["lancamento-anexos", lancamentoId] });
      toast({ title: "Anexo adicionado", description: file.name });
      if (fileRef.current) fileRef.current.value = "";
    } catch (ex: any) {
      toast({ title: "Erro no upload", description: ex.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      {previewAnexo && (
        <AnexoPreviewDialog anexo={previewAnexo} onClose={() => setPreviewAnexo(null)} />
      )}

      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Anexos</span>
        {anexos.length > 0 && (
          <Badge variant="secondary" className="text-xs">{anexos.length}</Badge>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando anexos...</p>
      ) : anexos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum anexo.</p>
      ) : (
        <div className="space-y-1.5">
          {anexos.map(a => (
            <div key={a.id} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/30 group">
              <FileIcon mime={a.mime_type} />
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  className="text-xs font-medium truncate text-left hover:underline cursor-pointer w-full"
                  onClick={() => setPreviewAnexo(a)}
                  title="Clique para visualizar"
                >
                  {a.nome_arquivo}
                </button>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <TipoLabel tipo={a.tipo} />
                  {a.tamanho_bytes && (
                    <span className="text-xs text-muted-foreground">{fmtBytes(a.tamanho_bytes)}</span>
                  )}
                  {a.uploaded_por_nome && (
                    <span className="text-xs text-muted-foreground">· {a.uploaded_por_nome}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Visualizar inline"
                  onClick={() => setPreviewAnexo(a)}>
                  <Eye className="h-3 w-3" />
                </Button>
                {!readOnly && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Remover"
                    onClick={() => mutDelete.mutate(a.id)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex gap-2 items-center pt-1">
          <Select value={tipoSelecionado} onValueChange={setTipoSelecionado}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_ANEXO.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}>
            <Upload className="h-3 w-3 mr-1" />
            {uploading ? "Enviando..." : "Anexar arquivo"}
          </Button>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange}
            accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx,.zip,.xml" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">PDF, imagens, planilhas, Word, XML · máx. 20 MB</p>
    </div>
  );
}
