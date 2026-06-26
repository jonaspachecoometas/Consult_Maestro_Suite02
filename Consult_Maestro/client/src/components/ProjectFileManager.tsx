import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Upload, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Trash2, 
  Download, 
  Eye,
  X,
  Loader2,
  Folder,
  FolderPlus,
  Video,
  Music,
  FileSpreadsheet,
  Presentation,
  FileCode,
  Filter,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ProjectFile } from "@shared/schema";

function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />;
    case 'image':
      return <ImageIcon className="h-5 w-5 text-blue-500" />;
    case 'document':
      return <FileText className="h-5 w-5 text-blue-600" />;
    case 'spreadsheet':
      return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
    case 'presentation':
      return <Presentation className="h-5 w-5 text-orange-500" />;
    case 'video':
      return <Video className="h-5 w-5 text-purple-500" />;
    case 'audio':
      return <Music className="h-5 w-5 text-pink-500" />;
    case 'ofx':
      return <FileCode className="h-5 w-5 text-teal-500" />;
    default:
      return <File className="h-5 w-5 text-muted-foreground" />;
  }
}

function getFileTypeLabel(fileType: string): string {
  switch (fileType) {
    case 'pdf': return 'PDF';
    case 'image': return 'Imagem';
    case 'document': return 'Documento';
    case 'spreadsheet': return 'Planilha';
    case 'presentation': return 'Apresentacao';
    case 'video': return 'Video';
    case 'audio': return 'Audio';
    case 'ofx': return 'OFX';
    default: return 'Arquivo';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

interface ProjectFileManagerProps {
  projectId: string;
}

export function ProjectFileManager({ projectId }: ProjectFileManagerProps) {
  const [previewFile, setPreviewFile] = useState<ProjectFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>('/');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const { toast } = useToast();

  const filesUrl = `/api/projects/${projectId}/files`;
  const { data: files = [], isLoading } = useQuery<ProjectFile[]>({
    queryKey: [filesUrl, selectedFolder],
    enabled: !!projectId,
  });

  const { data: folders = [] } = useQuery<string[]>({
    queryKey: [`/api/projects/${projectId}/files/folders`],
    enabled: !!projectId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/project-files/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [filesUrl] });
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files/folders`] });
      toast({ title: "Arquivo removido com sucesso" });
    },
    onError: () => {
      toast({ title: "Erro ao remover arquivo", variant: "destructive" });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      
      if (file.size > 50 * 1024 * 1024) {
        toast({ title: `Arquivo ${file.name} muito grande. Maximo 50MB.`, variant: "destructive" });
        continue;
      }

      setIsUploading(true);
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        await apiRequest("POST", `/api/projects/${projectId}/files/upload`, {
          fileName: file.name,
          fileData: base64,
          mimeType: file.type,
          fileSize: file.size,
          folder: selectedFolder,
        });

        queryClient.invalidateQueries({ queryKey: [filesUrl] });
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/files/folders`] });
        toast({ title: `Arquivo ${file.name} enviado com sucesso` });
      } catch (error) {
        toast({ title: `Erro ao enviar ${file.name}`, variant: "destructive" });
      }
    }
    setIsUploading(false);
    e.target.value = '';
  };

  const handleDownload = async (file: ProjectFile) => {
    try {
      const response = await fetch(`/api/project-files/${file.id}/download`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to get download URL');
      const { url } = await response.json();
      window.open(url, '_blank');
    } catch (error) {
      toast({ title: "Erro ao baixar arquivo", variant: "destructive" });
    }
  };

  const handlePreview = async (file: ProjectFile) => {
    try {
      const response = await fetch(`/api/project-files/${file.id}/download`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to get download URL');
      const { url } = await response.json();
      setPreviewFile(file);
      setPreviewUrl(url);
    } catch (error) {
      toast({ title: "Erro ao visualizar arquivo", variant: "destructive" });
    }
  };

  const canPreview = (file: ProjectFile) => {
    const previewableTypes = ['pdf', 'image', 'video', 'audio'];
    return previewableTypes.includes(file.fileType || '');
  };

  const createFolder = () => {
    if (!newFolderName.trim()) return;
    const folderPath = selectedFolder === '/' 
      ? `/${newFolderName.trim()}` 
      : `${selectedFolder}/${newFolderName.trim()}`;
    setSelectedFolder(folderPath);
    setNewFolderName('');
    setShowNewFolderDialog(false);
    toast({ title: `Pasta ${newFolderName} selecionada. Envie um arquivo para criar.` });
  };

  const filteredFiles = files.filter(file => {
    const matchesSearch = file.originalName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || file.fileType === filterType;
    const matchesFolder = selectedFolder === '/' || file.folder === selectedFolder;
    return matchesSearch && matchesType && matchesFolder;
  });

  const allFolders = ['/', ...folders.filter(f => f !== '/')];

  const renderPreview = () => {
    if (!previewFile || !previewUrl) return null;

    switch (previewFile.fileType) {
      case 'image':
        return (
          <img 
            src={previewUrl} 
            alt={previewFile.originalName} 
            className="max-w-full max-h-[70vh] object-contain"
          />
        );
      case 'pdf':
        return (
          <div className="flex flex-col items-center gap-4 py-8">
            <FileText className="h-20 w-20 text-red-500" />
            <p className="text-lg font-medium">{previewFile.originalName}</p>
            <p className="text-muted-foreground text-center max-w-md">
              Por questoes de seguranca do navegador, PDFs sao abertos em uma nova aba.
            </p>
            <Button onClick={() => window.open(previewUrl, '_blank')}>
              <Eye className="h-4 w-4 mr-2" />
              Abrir PDF
            </Button>
          </div>
        );
      case 'video':
        return (
          <video 
            src={previewUrl} 
            controls 
            className="max-w-full max-h-[70vh]"
          >
            Seu navegador nao suporta videos.
          </video>
        );
      case 'audio':
        return (
          <div className="flex flex-col items-center gap-4 py-8">
            <Music className="h-20 w-20 text-pink-500" />
            <p className="text-lg font-medium">{previewFile.originalName}</p>
            <audio src={previewUrl} controls className="w-full max-w-md">
              Seu navegador nao suporta audio.
            </audio>
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center gap-4 py-8">
            {getFileIcon(previewFile.fileType || '')}
            <p>Visualizacao nao disponivel para este tipo de arquivo.</p>
            <Button onClick={() => handleDownload(previewFile)}>
              <Download className="h-4 w-4 mr-2" />
              Baixar Arquivo
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedFolder} onValueChange={setSelectedFolder}>
            <SelectTrigger className="w-[180px]" data-testid="select-folder">
              <Folder className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Pasta" />
            </SelectTrigger>
            <SelectContent>
              {allFolders.map(folder => (
                <SelectItem key={folder} value={folder}>
                  {folder === '/' ? 'Raiz' : folder.replace(/^\//, '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button 
            size="icon" 
            variant="outline" 
            onClick={() => setShowNewFolderDialog(true)}
            data-testid="button-new-folder"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>

          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar arquivos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-[200px]"
              data-testid="input-search-files"
            />
          </div>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[140px]" data-testid="select-filter-type">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pdf">PDF</SelectItem>
              <SelectItem value="image">Imagens</SelectItem>
              <SelectItem value="document">Documentos</SelectItem>
              <SelectItem value="spreadsheet">Planilhas</SelectItem>
              <SelectItem value="presentation">Apresentacoes</SelectItem>
              <SelectItem value="video">Videos</SelectItem>
              <SelectItem value="audio">Audios</SelectItem>
              <SelectItem value="ofx">OFX</SelectItem>
              <SelectItem value="other">Outros</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label>
          <input
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            multiple
            disabled={isUploading}
            data-testid="input-file-upload"
          />
          <Button asChild disabled={isUploading}>
            <span className="cursor-pointer flex items-center gap-2">
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Enviar Arquivo
            </span>
          </Button>
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Folder className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {searchTerm || filterType !== 'all' 
                ? 'Nenhum arquivo encontrado com os filtros aplicados.' 
                : 'Nenhum arquivo nesta pasta. Clique em "Enviar Arquivo" para adicionar.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">Tipo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="w-[100px]">Tamanho</TableHead>
                <TableHead className="w-[160px]">Data</TableHead>
                <TableHead className="w-[120px] text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFiles.map((file) => (
                <TableRow key={file.id} data-testid={`row-file-${file.id}`}>
                  <TableCell>
                    {getFileIcon(file.fileType || '')}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium truncate max-w-[300px]" title={file.originalName}>
                        {file.originalName}
                      </span>
                      <Badge variant="secondary" className="w-fit mt-1">
                        {getFileTypeLabel(file.fileType || '')}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatFileSize(file.fileSize || 0)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(file.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {canPreview(file) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handlePreview(file)}
                          title="Visualizar"
                          data-testid={`button-preview-${file.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(file)}
                        title="Baixar"
                        data-testid={`button-download-${file.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(file.id)}
                        disabled={deleteMutation.isPending}
                        title="Remover"
                        data-testid={`button-delete-${file.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewFile && getFileIcon(previewFile.fileType || '')}
              {previewFile?.originalName}
            </DialogTitle>
          </DialogHeader>
          {renderPreview()}
        </DialogContent>
      </Dialog>

      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Pasta</DialogTitle>
            <DialogDescription>
              Digite o nome da nova pasta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Nome da pasta"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              data-testid="input-folder-name"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowNewFolderDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={createFolder} disabled={!newFolderName.trim()}>
                Criar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
