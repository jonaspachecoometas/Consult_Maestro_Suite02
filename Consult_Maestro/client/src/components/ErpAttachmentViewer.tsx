import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Upload, 
  File, 
  FileText, 
  Image, 
  Trash2, 
  Download, 
  Eye,
  X,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ErpRequirementAttachment } from "@shared/schema";

interface AttachmentWithUrl extends ErpRequirementAttachment {
  signedUrl?: string | null;
}

function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />;
    case 'image':
      return <Image className="h-5 w-5 text-blue-500" />;
    case 'word':
      return <FileText className="h-5 w-5 text-blue-600" />;
    case 'excel':
      return <FileText className="h-5 w-5 text-green-600" />;
    default:
      return <File className="h-5 w-5 text-muted-foreground" />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function detectFileType(mimeType: string, fileName: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) return 'word';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || fileName.endsWith('.xls') || fileName.endsWith('.xlsx')) return 'excel';
  return 'other';
}

interface ErpAttachmentViewerProps {
  requirementId: string;
  requirementName: string;
}

export function ErpAttachmentViewer({ requirementId, requirementName }: ErpAttachmentViewerProps) {
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentWithUrl | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const attachmentsUrl = requirementId ? `/api/erp-attachments/${requirementId}/view` : '';
  const { data: attachments = [], isLoading } = useQuery<AttachmentWithUrl[]>({
    queryKey: [attachmentsUrl],
    queryFn: async () => {
      if (!attachmentsUrl) return [];
      const res = await fetch(attachmentsUrl, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch attachments');
      return res.json();
    },
    enabled: !!requirementId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/erp-attachments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [attachmentsUrl] });
      toast({ title: "Anexo removido" });
    },
    onError: () => {
      toast({ title: "Erro ao remover anexo", variant: "destructive" });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande. Maximo 10MB.", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const fileType = detectFileType(file.type, file.name);
        
        await apiRequest("POST", "/api/erp-attachments/upload", {
          requirementId,
          fileName: file.name,
          fileType,
          mimeType: file.type,
          fileSize: file.size,
          fileData: base64,
        });
        
        queryClient.invalidateQueries({ queryKey: [attachmentsUrl] });
        toast({ title: "Arquivo enviado com sucesso" });
        setIsUploading(false);
      };
      reader.onerror = () => {
        toast({ title: "Erro ao ler arquivo", variant: "destructive" });
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast({ title: "Erro ao enviar arquivo", variant: "destructive" });
      setIsUploading(false);
    }
    e.target.value = '';
  };

  const handleDownload = async (attachment: AttachmentWithUrl) => {
    if (!attachment.signedUrl) {
      toast({ title: "URL de download nao disponivel", variant: "destructive" });
      return;
    }
    window.open(attachment.signedUrl, '_blank');
  };

  const canPreview = (attachment: AttachmentWithUrl) => {
    // PDFs, images, Word, and Excel can be previewed
    return ['pdf', 'image', 'word', 'excel'].includes(attachment.fileType || '');
  };

  return (
    <Card className="border-card-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <File className="h-4 w-4" />
            Anexos
          </CardTitle>
          <label>
            <input
              type="file"
              className="hidden"
              onChange={handleFileUpload}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif"
              disabled={isUploading}
              data-testid="input-file-upload"
            />
            <Button size="sm" variant="outline" asChild disabled={isUploading}>
              <span className="cursor-pointer flex items-center gap-1">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Enviar
              </span>
            </Button>
          </label>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando anexos...</div>
        ) : attachments.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Nenhum anexo. Clique em "Enviar" para adicionar.
          </div>
        ) : (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div 
                key={attachment.id}
                className="flex items-center gap-3 p-2 rounded-md hover-elevate border border-border"
              >
                {getFileIcon(attachment.fileType || 'other')}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{attachment.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.fileSize || 0)}
                    {attachment.mimeType && (
                      <Badge variant="outline" size="sm" className="ml-2 text-xs">
                        {attachment.fileType}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  {canPreview(attachment) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (!attachment.signedUrl) {
                          toast({ title: "URL de visualizacao nao disponivel", variant: "destructive" });
                          return;
                        }
                        setPreviewAttachment(attachment);
                      }}
                      data-testid={`button-preview-${attachment.id}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDownload(attachment)}
                    disabled={!attachment.signedUrl}
                    data-testid={`button-download-${attachment.id}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(attachment.id)}
                    data-testid={`button-delete-attachment-${attachment.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!previewAttachment} onOpenChange={() => setPreviewAttachment(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewAttachment && getFileIcon(previewAttachment.fileType || 'other')}
              {previewAttachment?.fileName}
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto"
                onClick={() => setPreviewAttachment(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 overflow-auto max-h-[70vh]">
            {previewAttachment?.fileType === 'pdf' && previewAttachment.signedUrl && (
              <iframe
                src={previewAttachment.signedUrl}
                className="w-full h-[60vh] border rounded-md"
                title={previewAttachment.fileName}
              />
            )}
            {previewAttachment?.fileType === 'image' && previewAttachment.signedUrl && (
              <img
                src={previewAttachment.signedUrl}
                alt={previewAttachment.fileName}
                className="max-w-full h-auto rounded-md"
              />
            )}
            {(previewAttachment?.fileType === 'word' || previewAttachment?.fileType === 'excel') && previewAttachment.signedUrl && (
              <div className="flex flex-col items-center justify-center py-8 space-y-4">
                <FileText className="h-16 w-16 text-muted-foreground" />
                <p className="text-muted-foreground text-center">
                  Arquivos {previewAttachment.fileType === 'word' ? 'Word' : 'Excel'} nao podem ser visualizados diretamente no navegador.
                </p>
                <Button onClick={() => handleDownload(previewAttachment)} data-testid="button-download-preview">
                  <Download className="h-4 w-4 mr-2" />
                  Baixar para visualizar
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
