import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  FileText, 
  FileSpreadsheet, 
  Download, 
  Printer, 
  Edit3,
  Check,
  X,
  Building2,
  Calendar,
  User,
  BarChart3,
  AlertCircle,
  CheckCircle2,
  Settings,
  Code,
  XCircle,
  Paperclip,
  Eye,
  File,
  Image
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ERP_MODULES, ERP_ADHERENCE_STATUS, ERP_PRIORITY } from "@/lib/constants";
import type { ErpRequirement, Project, Client, ErpRequirementAttachment } from "@shared/schema";

interface AttachmentWithUrl extends ErpRequirementAttachment {
  signedUrl?: string | null;
}

function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText className="h-4 w-4 text-red-500" />;
    case 'image':
      return <Image className="h-4 w-4 text-blue-500" />;
    case 'word':
      return <FileText className="h-4 w-4 text-blue-600" />;
    case 'excel':
      return <FileText className="h-4 w-4 text-green-600" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface ErpReportsEditorProps {
  projectId: string;
  project?: Project;
  client?: Client;
  requirements: ErpRequirement[];
}

interface ReportData {
  title: string;
  subtitle: string;
  date: string;
  preparedBy: string;
  clientName: string;
  projectName: string;
  executiveSummary: string;
  conclusions: string;
  recommendations: string;
}

interface RequirementEditData {
  requirement: string;
  description: string;
  customizationNotes: string;
  observations: string;
}

export function ErpReportsEditor({ projectId, project, client, requirements }: ErpReportsEditorProps) {
  const { toast } = useToast();
  const reportRef = useRef<HTMLDivElement>(null);
  const [reportType, setReportType] = useState<"general" | "individual">("general");
  const [selectedRequirementId, setSelectedRequirementId] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentWithUrl | null>(null);

  // Query attachments for selected requirement
  const attachmentsQueryKey = selectedRequirementId ? `/api/erp-attachments/${selectedRequirementId}/view` : '';
  const { data: attachments = [] } = useQuery<AttachmentWithUrl[]>({
    queryKey: [attachmentsQueryKey],
    queryFn: async () => {
      if (!attachmentsQueryKey) return [];
      const res = await fetch(attachmentsQueryKey, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch attachments');
      return res.json();
    },
    enabled: !!selectedRequirementId && reportType === "individual",
  });

  // Query all attachments for all requirements (for general report)
  const allAttachmentsQueryKey = projectId ? `/api/projects/${projectId}/all-attachments` : '';
  const { data: allAttachments = [] } = useQuery<AttachmentWithUrl[]>({
    queryKey: [allAttachmentsQueryKey],
    queryFn: async () => {
      if (!allAttachmentsQueryKey) return [];
      const res = await fetch(allAttachmentsQueryKey, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch project attachments');
      return res.json();
    },
    enabled: !!projectId && reportType === "general",
  });
  
  const [reportData, setReportData] = useState<ReportData>({
    title: "Relatorio de Requisitos ERP",
    subtitle: "Avaliacao de Prontidao para Implantacao",
    date: new Date().toLocaleDateString('pt-BR'),
    preparedBy: "",
    clientName: client?.name || "",
    projectName: project?.name || "",
    executiveSummary: "Este relatorio apresenta a analise completa dos requisitos de ERP identificados para o projeto, incluindo a avaliacao de aderencia do sistema proposto e as recomendacoes para implantacao.",
    conclusions: "",
    recommendations: "",
  });

  const [requirementEdits, setRequirementEdits] = useState<Record<string, RequirementEditData>>({});

  // Initialize requirement edits
  const initRequirementEdit = (req: ErpRequirement) => {
    if (!requirementEdits[req.id]) {
      setRequirementEdits(prev => ({
        ...prev,
        [req.id]: {
          requirement: req.requirement,
          description: req.description || "",
          customizationNotes: req.customizationNotes || "",
          observations: "",
        }
      }));
    }
  };

  // Calculate statistics
  const stats = {
    total: requirements.length,
    nativo: requirements.filter(r => r.adherenceStatus === 'nativo').length,
    configuravel: requirements.filter(r => r.adherenceStatus === 'configuravel').length,
    customizavel: requirements.filter(r => r.adherenceStatus === 'customizavel').length,
    naoAtendido: requirements.filter(r => r.adherenceStatus === 'nao_atendido').length,
  };

  const adherencePercent = stats.total > 0 
    ? Math.round(((stats.nativo + stats.configuravel) / stats.total) * 100)
    : 0;

  // Group by module
  const moduleStats = ERP_MODULES.map(mod => ({
    ...mod,
    total: requirements.filter(r => r.erpModule === mod.value).length,
    nativo: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'nativo').length,
    configuravel: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'configuravel').length,
    customizavel: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'customizavel').length,
    naoAtendido: requirements.filter(r => r.erpModule === mod.value && r.adherenceStatus === 'nao_atendido').length,
  })).filter(m => m.total > 0);

  const selectedRequirement = requirements.find(r => r.id === selectedRequirementId);

  // Export functions
  const exportToPDF = useCallback(() => {
    if (typeof window === 'undefined') {
      toast({ title: "Exportacao nao disponivel neste ambiente", variant: "destructive" });
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow || !reportRef.current) return;

    const styles = `
      <style>
        body { font-family: 'Inter', sans-serif; padding: 40px; color: #1a1a1a; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        h2 { font-size: 18px; margin-top: 24px; margin-bottom: 12px; border-bottom: 2px solid #e5e5e5; padding-bottom: 8px; }
        h3 { font-size: 14px; margin-top: 16px; margin-bottom: 8px; }
        p { font-size: 12px; line-height: 1.6; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11px; }
        th, td { border: 1px solid #e5e5e5; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; font-weight: 600; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 500; }
        .badge-green { background: #dcfce7; color: #166534; }
        .badge-blue { background: #dbeafe; color: #1e40af; }
        .badge-yellow { background: #fef3c7; color: #92400e; }
        .badge-red { background: #fee2e2; color: #991b1b; }
        .stat-box { display: inline-block; padding: 12px 20px; margin: 4px; border: 1px solid #e5e5e5; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 24px; font-weight: 700; }
        .stat-label { font-size: 10px; color: #666; }
        .header-info { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 11px; color: #666; }
        .section { margin-bottom: 24px; }
        @media print { body { padding: 20px; } }
      </style>
    `;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${reportData.title}</title>
          ${styles}
        </head>
        <body>
          ${reportRef.current.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    
    setTimeout(() => {
      printWindow.print();
    }, 250);

    toast({ title: "Abrindo visualizacao para impressao/PDF" });
  }, [reportData.title, toast]);

  const exportToWord = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      toast({ title: "Exportacao nao disponivel neste ambiente", variant: "destructive" });
      return;
    }
    if (!reportRef.current) return;

    const styles = `
      <style>
        body { font-family: 'Arial', sans-serif; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ccc; padding: 8px; }
        th { background-color: #f0f0f0; }
      </style>
    `;

    const html = `
      <!DOCTYPE html>
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
        <head>
          <meta charset="utf-8">
          <title>${reportData.title}</title>
          ${styles}
        </head>
        <body>
          ${reportRef.current.innerHTML}
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-erp-${project?.name?.replace(/\s+/g, '-').toLowerCase() || 'projeto'}.doc`;
    link.click();
    URL.revokeObjectURL(url);

    toast({ title: "Relatorio exportado para Word" });
  }, [reportData.title, project?.name, toast]);

  const exportToExcel = useCallback(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      toast({ title: "Exportacao nao disponivel neste ambiente", variant: "destructive" });
      return;
    }
    const headers = ['Requisito', 'Modulo', 'Status', 'Prioridade', 'Esforco', 'Redesenho Processo', 'Notas Customizacao', 'Observacoes'];
    const rows = requirements.map(req => [
      requirementEdits[req.id]?.requirement || req.requirement,
      ERP_MODULES.find(m => m.value === req.erpModule)?.label || req.erpModule || '',
      ERP_ADHERENCE_STATUS.find(s => s.value === req.adherenceStatus)?.label || req.adherenceStatus || '',
      ERP_PRIORITY.find(p => p.value === req.priority)?.label || req.priority || '',
      req.estimatedEffort || '',
      req.processRedesignRequired ? 'Sim' : 'Nao',
      requirementEdits[req.id]?.customizationNotes || req.customizationNotes || '',
      requirementEdits[req.id]?.observations || '',
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `requisitos-erp-${project?.name?.replace(/\s+/g, '-').toLowerCase() || 'projeto'}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    toast({ title: "Dados exportados para Excel (CSV)" });
  }, [requirements, requirementEdits, project?.name, toast]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'nativo': return 'badge-green';
      case 'configuravel': return 'badge-blue';
      case 'customizavel': return 'badge-yellow';
      default: return 'badge-red';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'nativo': return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'configuravel': return <Settings className="h-4 w-4 text-blue-600" />;
      case 'customizavel': return <Code className="h-4 w-4 text-yellow-600" />;
      default: return <XCircle className="h-4 w-4 text-red-600" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Report Controls */}
      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Configuracao do Relatorio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">Tipo de Relatorio</label>
              <Select value={reportType} onValueChange={(v: "general" | "individual") => setReportType(v)}>
                <SelectTrigger data-testid="select-report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">Relatorio Geral</SelectItem>
                  <SelectItem value="individual">Relatorio Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {reportType === "individual" && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1 block">Requisito</label>
                <Select value={selectedRequirementId} onValueChange={(v) => {
                  setSelectedRequirementId(v);
                  const req = requirements.find(r => r.id === v);
                  if (req) initRequirementEdit(req);
                }}>
                  <SelectTrigger data-testid="select-requirement">
                    <SelectValue placeholder="Selecione um requisito" />
                  </SelectTrigger>
                  <SelectContent>
                    {requirements.map(req => (
                      <SelectItem key={req.id} value={req.id}>{req.requirement}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-end gap-2">
              <Button
                variant={isEditing ? "default" : "outline"}
                onClick={() => setIsEditing(!isEditing)}
                data-testid="button-toggle-edit"
              >
                {isEditing ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Concluir Edicao
                  </>
                ) : (
                  <>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Editar Relatorio
                  </>
                )}
              </Button>
            </div>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button onClick={exportToPDF} variant="outline" data-testid="button-export-pdf">
              <Printer className="h-4 w-4 mr-2" />
              Imprimir / PDF
            </Button>
            <Button onClick={exportToWord} variant="outline" data-testid="button-export-word">
              <FileText className="h-4 w-4 mr-2" />
              Exportar Word
            </Button>
            <Button onClick={exportToExcel} variant="outline" data-testid="button-export-excel">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Exportar Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Report Preview */}
      <Card className="border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pre-visualizacao do Relatorio</CardTitle>
        </CardHeader>
        <CardContent>
          <div 
            ref={reportRef} 
            className="bg-white dark:bg-gray-900 p-8 rounded-lg border min-h-[600px]"
            style={{ fontFamily: "'Inter', sans-serif" }}
          >
            {reportType === "general" ? (
              /* General Report */
              <div className="space-y-6">
                {/* Header */}
                <div className="text-center border-b pb-6">
                  {isEditing ? (
                    <Input
                      value={reportData.title}
                      onChange={(e) => setReportData(prev => ({ ...prev, title: e.target.value }))}
                      className="text-2xl font-bold text-center mb-2"
                      data-testid="input-report-title"
                    />
                  ) : (
                    <h1 className="text-2xl font-bold mb-2">{reportData.title}</h1>
                  )}
                  {isEditing ? (
                    <Input
                      value={reportData.subtitle}
                      onChange={(e) => setReportData(prev => ({ ...prev, subtitle: e.target.value }))}
                      className="text-center text-muted-foreground"
                      data-testid="input-report-subtitle"
                    />
                  ) : (
                    <p className="text-muted-foreground">{reportData.subtitle}</p>
                  )}
                </div>

                {/* Meta info */}
                <div className="flex flex-wrap justify-between text-sm text-muted-foreground gap-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    <span>Cliente: </span>
                    {isEditing ? (
                      <Input
                        value={reportData.clientName}
                        onChange={(e) => setReportData(prev => ({ ...prev, clientName: e.target.value }))}
                        className="w-40 h-7 text-sm"
                        data-testid="input-client-name"
                      />
                    ) : (
                      <strong>{reportData.clientName || client?.name || '-'}</strong>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Projeto: </span>
                    {isEditing ? (
                      <Input
                        value={reportData.projectName}
                        onChange={(e) => setReportData(prev => ({ ...prev, projectName: e.target.value }))}
                        className="w-40 h-7 text-sm"
                        data-testid="input-project-name"
                      />
                    ) : (
                      <strong>{reportData.projectName || project?.name || '-'}</strong>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span>Data: </span>
                    {isEditing ? (
                      <Input
                        value={reportData.date}
                        onChange={(e) => setReportData(prev => ({ ...prev, date: e.target.value }))}
                        className="w-32 h-7 text-sm"
                        data-testid="input-report-date"
                      />
                    ) : (
                      <strong>{reportData.date}</strong>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    <span>Elaborado por: </span>
                    {isEditing ? (
                      <Input
                        value={reportData.preparedBy}
                        onChange={(e) => setReportData(prev => ({ ...prev, preparedBy: e.target.value }))}
                        className="w-40 h-7 text-sm"
                        placeholder="Nome do consultor"
                        data-testid="input-prepared-by"
                      />
                    ) : (
                      <strong>{reportData.preparedBy || '-'}</strong>
                    )}
                  </div>
                </div>

                {/* Executive Summary */}
                <div className="section">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3 flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Sumario Executivo
                  </h2>
                  {isEditing ? (
                    <Textarea
                      value={reportData.executiveSummary}
                      onChange={(e) => setReportData(prev => ({ ...prev, executiveSummary: e.target.value }))}
                      className="min-h-[100px]"
                      data-testid="textarea-executive-summary"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed">{reportData.executiveSummary}</p>
                  )}
                </div>

                {/* Statistics */}
                <div className="section">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3">Resumo de Aderencia</h2>
                  <div className="flex flex-wrap gap-4 justify-center mb-4">
                    <div className="stat-box text-center p-4 border rounded-lg min-w-[100px]">
                      <div className="stat-value text-2xl font-bold">{stats.total}</div>
                      <div className="stat-label text-xs text-muted-foreground">Total</div>
                    </div>
                    <div className="stat-box text-center p-4 border rounded-lg min-w-[100px]">
                      <div className="stat-value text-2xl font-bold text-green-600">{stats.nativo}</div>
                      <div className="stat-label text-xs text-muted-foreground">Nativos</div>
                    </div>
                    <div className="stat-box text-center p-4 border rounded-lg min-w-[100px]">
                      <div className="stat-value text-2xl font-bold text-blue-600">{stats.configuravel}</div>
                      <div className="stat-label text-xs text-muted-foreground">Configuraveis</div>
                    </div>
                    <div className="stat-box text-center p-4 border rounded-lg min-w-[100px]">
                      <div className="stat-value text-2xl font-bold text-yellow-600">{stats.customizavel}</div>
                      <div className="stat-label text-xs text-muted-foreground">Customizaveis</div>
                    </div>
                    <div className="stat-box text-center p-4 border rounded-lg min-w-[100px]">
                      <div className="stat-value text-2xl font-bold text-red-600">{stats.naoAtendido}</div>
                      <div className="stat-label text-xs text-muted-foreground">Nao Atendidos</div>
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-primary">{adherencePercent}%</div>
                    <div className="text-sm text-muted-foreground">Indice de Aderencia (Nativo + Configuravel)</div>
                  </div>
                </div>

                {/* Module Matrix */}
                {moduleStats.length > 0 && (
                  <div className="section">
                    <h2 className="text-lg font-semibold border-b pb-2 mb-3">Aderencia por Modulo</h2>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Modulo</TableHead>
                          <TableHead className="text-center">Total</TableHead>
                          <TableHead className="text-center">Nativo</TableHead>
                          <TableHead className="text-center">Config.</TableHead>
                          <TableHead className="text-center">Custom.</TableHead>
                          <TableHead className="text-center">Nao Atend.</TableHead>
                          <TableHead className="text-center">Aderencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {moduleStats.map(mod => {
                          const modAdherence = mod.total > 0 
                            ? Math.round(((mod.nativo + mod.configuravel) / mod.total) * 100)
                            : 0;
                          return (
                            <TableRow key={mod.value}>
                              <TableCell className="font-medium">{mod.label}</TableCell>
                              <TableCell className="text-center">{mod.total}</TableCell>
                              <TableCell className="text-center text-green-600">{mod.nativo}</TableCell>
                              <TableCell className="text-center text-blue-600">{mod.configuravel}</TableCell>
                              <TableCell className="text-center text-yellow-600">{mod.customizavel}</TableCell>
                              <TableCell className="text-center text-red-600">{mod.naoAtendido}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant={modAdherence >= 70 ? "default" : modAdherence >= 40 ? "secondary" : "destructive"}>
                                  {modAdherence}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Requirements List */}
                <div className="section">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3">Detalhamento dos Requisitos</h2>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Requisito</TableHead>
                        <TableHead>Modulo</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Prioridade</TableHead>
                        <TableHead>Esforco</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {requirements.map(req => {
                        const edit = requirementEdits[req.id];
                        return (
                          <TableRow key={req.id}>
                            <TableCell>
                              {isEditing ? (
                                <Input
                                  value={edit?.requirement || req.requirement}
                                  onChange={(e) => {
                                    initRequirementEdit(req);
                                    setRequirementEdits(prev => ({
                                      ...prev,
                                      [req.id]: { ...prev[req.id], requirement: e.target.value }
                                    }));
                                  }}
                                  className="h-7 text-sm"
                                  data-testid={`input-req-name-${req.id}`}
                                />
                              ) : (
                                <div>
                                  <div className="font-medium">{edit?.requirement || req.requirement}</div>
                                  {(edit?.description || req.description) && (
                                    <div className="text-xs text-muted-foreground">{edit?.description || req.description}</div>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" size="sm">
                                {ERP_MODULES.find(m => m.value === req.erpModule)?.label || req.erpModule || '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {getStatusIcon(req.adherenceStatus || 'nao_atendido')}
                                <span className="text-sm">
                                  {ERP_ADHERENCE_STATUS.find(s => s.value === req.adherenceStatus)?.label || req.adherenceStatus}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm">
                                {ERP_PRIORITY.find(p => p.value === req.priority)?.label || req.priority || '-'}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">{req.estimatedEffort || '-'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Conclusions */}
                <div className="section">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3">Conclusoes</h2>
                  {isEditing ? (
                    <Textarea
                      value={reportData.conclusions}
                      onChange={(e) => setReportData(prev => ({ ...prev, conclusions: e.target.value }))}
                      className="min-h-[100px]"
                      placeholder="Digite as conclusoes do relatorio..."
                      data-testid="textarea-conclusions"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed">{reportData.conclusions || 'Nenhuma conclusao adicionada.'}</p>
                  )}
                </div>

                {/* Recommendations */}
                <div className="section">
                  <h2 className="text-lg font-semibold border-b pb-2 mb-3">Recomendacoes</h2>
                  {isEditing ? (
                    <Textarea
                      value={reportData.recommendations}
                      onChange={(e) => setReportData(prev => ({ ...prev, recommendations: e.target.value }))}
                      className="min-h-[100px]"
                      placeholder="Digite as recomendacoes..."
                      data-testid="textarea-recommendations"
                    />
                  ) : (
                    <p className="text-sm leading-relaxed">{reportData.recommendations || 'Nenhuma recomendacao adicionada.'}</p>
                  )}
                </div>
              </div>
            ) : (
              /* Individual Report */
              selectedRequirement ? (
                <div className="space-y-6">
                  {/* Header */}
                  <div className="text-center border-b pb-6">
                    <h1 className="text-2xl font-bold mb-2">Relatorio de Requisito ERP</h1>
                    <p className="text-muted-foreground">Analise Detalhada</p>
                  </div>

                  {/* Meta info */}
                  <div className="flex flex-wrap justify-between text-sm text-muted-foreground gap-4">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      <span>Cliente: <strong>{client?.name || '-'}</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span>Projeto: <strong>{project?.name || '-'}</strong></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>Data: <strong>{reportData.date}</strong></span>
                    </div>
                  </div>

                  {/* Requirement Details */}
                  <div className="section">
                    <h2 className="text-lg font-semibold border-b pb-2 mb-4">Informacoes do Requisito</h2>
                    
                    <div className="grid gap-4">
                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Requisito</label>
                        {isEditing ? (
                          <Input
                            value={requirementEdits[selectedRequirement.id]?.requirement || selectedRequirement.requirement}
                            onChange={(e) => {
                              initRequirementEdit(selectedRequirement);
                              setRequirementEdits(prev => ({
                                ...prev,
                                [selectedRequirement.id]: { ...prev[selectedRequirement.id], requirement: e.target.value }
                              }));
                            }}
                            className="mt-1"
                            data-testid="input-individual-req-name"
                          />
                        ) : (
                          <p className="text-lg font-medium mt-1">
                            {requirementEdits[selectedRequirement.id]?.requirement || selectedRequirement.requirement}
                          </p>
                        )}
                      </div>

                      <div className="grid md:grid-cols-3 gap-4">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Modulo ERP</label>
                          <div className="mt-1">
                            <Badge variant="outline">
                              {ERP_MODULES.find(m => m.value === selectedRequirement.erpModule)?.label || selectedRequirement.erpModule || '-'}
                            </Badge>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Status de Aderencia</label>
                          <div className="flex items-center gap-2 mt-1">
                            {getStatusIcon(selectedRequirement.adherenceStatus || 'nao_atendido')}
                            <span className="font-medium">
                              {ERP_ADHERENCE_STATUS.find(s => s.value === selectedRequirement.adherenceStatus)?.label || selectedRequirement.adherenceStatus}
                            </span>
                          </div>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Prioridade</label>
                          <p className="mt-1 font-medium">
                            {ERP_PRIORITY.find(p => p.value === selectedRequirement.priority)?.label || selectedRequirement.priority || '-'}
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Descricao</label>
                        {isEditing ? (
                          <Textarea
                            value={requirementEdits[selectedRequirement.id]?.description || selectedRequirement.description || ''}
                            onChange={(e) => {
                              initRequirementEdit(selectedRequirement);
                              setRequirementEdits(prev => ({
                                ...prev,
                                [selectedRequirement.id]: { ...prev[selectedRequirement.id], description: e.target.value }
                              }));
                            }}
                            className="mt-1 min-h-[80px]"
                            data-testid="textarea-individual-description"
                          />
                        ) : (
                          <p className="text-sm mt-1">
                            {requirementEdits[selectedRequirement.id]?.description || selectedRequirement.description || 'Sem descricao.'}
                          </p>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Esforco Estimado</label>
                          <p className="mt-1">{selectedRequirement.estimatedEffort || '-'}</p>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Requer Redesenho de Processo</label>
                          <p className="mt-1">{selectedRequirement.processRedesignRequired ? 'Sim' : 'Nao'}</p>
                        </div>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Notas de Customizacao</label>
                        {isEditing ? (
                          <Textarea
                            value={requirementEdits[selectedRequirement.id]?.customizationNotes || selectedRequirement.customizationNotes || ''}
                            onChange={(e) => {
                              initRequirementEdit(selectedRequirement);
                              setRequirementEdits(prev => ({
                                ...prev,
                                [selectedRequirement.id]: { ...prev[selectedRequirement.id], customizationNotes: e.target.value }
                              }));
                            }}
                            className="mt-1 min-h-[80px]"
                            data-testid="textarea-individual-notes"
                          />
                        ) : (
                          <p className="text-sm mt-1">
                            {requirementEdits[selectedRequirement.id]?.customizationNotes || selectedRequirement.customizationNotes || 'Nenhuma nota.'}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="text-sm font-medium text-muted-foreground">Observacoes Adicionais</label>
                        {isEditing ? (
                          <Textarea
                            value={requirementEdits[selectedRequirement.id]?.observations || ''}
                            onChange={(e) => {
                              initRequirementEdit(selectedRequirement);
                              setRequirementEdits(prev => ({
                                ...prev,
                                [selectedRequirement.id]: { ...prev[selectedRequirement.id], observations: e.target.value }
                              }));
                            }}
                            className="mt-1 min-h-[80px]"
                            placeholder="Adicione observacoes para o relatorio..."
                            data-testid="textarea-individual-observations"
                          />
                        ) : (
                          <p className="text-sm mt-1">
                            {requirementEdits[selectedRequirement.id]?.observations || 'Nenhuma observacao.'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Attachments Section */}
                  <div className="section">
                    <h2 className="text-lg font-semibold border-b pb-2 mb-4 flex items-center gap-2">
                      <Paperclip className="h-5 w-5" />
                      Anexos do Requisito
                    </h2>
                    {attachments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum anexo vinculado a este requisito.</p>
                    ) : (
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <div 
                            key={attachment.id}
                            className="flex items-center gap-3 p-3 rounded-md border border-border hover-elevate"
                          >
                            {getFileIcon(attachment.fileType || 'other')}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{attachment.fileName}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatFileSize(attachment.fileSize || 0)}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {(attachment.fileType === 'pdf' || attachment.fileType === 'image') && attachment.signedUrl && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setPreviewAttachment(attachment)}
                                  data-testid={`button-preview-report-${attachment.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              )}
                              {attachment.signedUrl && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    if (typeof window !== 'undefined' && attachment.signedUrl) {
                                      window.open(attachment.signedUrl, '_blank');
                                    }
                                  }}
                                  data-testid={`button-download-report-${attachment.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Selecione um Requisito</h3>
                  <p className="text-muted-foreground max-w-sm">
                    Escolha um requisito na lista acima para visualizar seu relatorio individual.
                  </p>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>

      {/* Attachment Preview Dialog */}
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
