import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentPanel } from "@/components/AgentPanel";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Settings,
  Eye,
  Printer,
  ChevronRight,
  ArrowLeft,
  Briefcase,
  Target,
  GitBranch,
  Package,
  CheckSquare,
  Layers,
  Trash2,
  Save,
  FileBarChart,
  BookOpen,
  Clock,
  RefreshCcw,
} from "lucide-react";
import type { Project, ReportConfiguration } from "@shared/schema";

const REPORT_TEMPLATES = [
  { id: 'executive_summary', name: 'Resumo Executivo', description: 'Visao geral do projeto com principais insights e recomendacoes', icon: FileBarChart },
  { id: 'full_diagnostic', name: 'Diagnostico Completo', description: 'Relatorio completo com todas as analises do projeto', icon: BookOpen },
  { id: 'swot_report', name: 'Relatorio SWOT', description: 'Analise SWOT detalhada com planos de acao PDCA', icon: Target },
  { id: 'process_analysis', name: 'Analise de Processos', description: 'Mapeamento AS-IS/TO-BE com diagnosticos e recomendacoes', icon: GitBranch },
  { id: 'canvas_report', name: 'Canvas BMC', description: 'Business Model Canvas com os 4 niveis evolutivos', icon: Layers },
  { id: 'custom', name: 'Personalizado', description: 'Crie um relatorio customizado selecionando as secoes desejadas', icon: Settings },
];

const REPORT_SECTIONS = [
  { id: 'project_info', name: 'Informacoes do Projeto', description: 'Dados basicos do projeto e cliente', icon: Briefcase, defaultEnabled: true },
  { id: 'project_history', name: 'Historia do Projeto', description: 'Contexto, evolucao e documentacao do projeto', icon: BookOpen },
  { id: 'canvas', name: 'Canvas BMC - Atual', description: 'Business Model Canvas nivel Atual (Intencao)', icon: Layers },
  { id: 'canvas_sistemico', name: 'Canvas BMC - Sistemico', description: 'Business Model Canvas nivel Sistemico', icon: Layers },
  { id: 'swot', name: 'Analise SWOT', description: 'Matriz SWOT com ciclo PDCA', icon: Target },
  { id: 'processes', name: 'Processos', description: 'Mapeamento de processos AS-IS/TO-BE', icon: GitBranch },
  { id: 'pdca', name: 'Plano PDCA Consolidado', description: 'Ciclo PDCA consolidado de todas as fontes', icon: RefreshCcw },
  { id: 'deliverables', name: 'Entregas', description: 'Entregas e documentos do projeto', icon: Package },
  { id: 'tasks', name: 'Tarefas', description: 'Lista de tarefas e progresso', icon: CheckSquare },
  { id: 'erp', name: 'Requisitos ERP', description: 'Avaliacao de aderencia ERP', icon: Settings },
];

export default function Reports() {
  const { projectId } = useParams<{ projectId?: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId || null);
  const [wizardStep, setWizardStep] = useState<'select' | 'configure' | 'preview'>('select');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('custom');
  const [selectedSections, setSelectedSections] = useState<string[]>(['project_info']);
  const [reportName, setReportName] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [isNewReportOpen, setIsNewReportOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  const { data: projects = [], isLoading: loadingProjects } = useQuery<Project[]>({
    queryKey: ['/api/projects', '?scope=production'],
  });

  const { data: savedConfigs = [] } = useQuery<ReportConfiguration[]>({
    queryKey: ['/api/projects', selectedProjectId, 'reports'],
    enabled: !!selectedProjectId,
  });

  const createConfigMutation = useMutation({
    mutationFn: async (config: any) => {
      return await apiRequest('POST', `/api/projects/${selectedProjectId}/reports`, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProjectId, 'reports'] });
      toast({ title: "Configuracao salva", description: "A configuracao do relatorio foi salva com sucesso." });
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao salvar configuracao.", variant: "destructive" });
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/projects', selectedProjectId, 'reports'] });
      toast({ title: "Configuracao excluida", description: "A configuracao foi removida." });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', `/api/projects/${selectedProjectId}/reports/preview`, {
        sections: selectedSections,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setWizardStep('preview');
    },
    onError: () => {
      toast({ title: "Erro", description: "Falha ao gerar preview do relatorio.", variant: "destructive" });
    },
  });

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    switch (templateId) {
      case 'executive_summary':
        setSelectedSections(['project_info', 'canvas', 'swot']);
        break;
      case 'full_diagnostic':
        setSelectedSections(['project_info', 'canvas', 'swot', 'processes', 'pdca', 'deliverables', 'tasks', 'erp']);
        break;
      case 'swot_report':
        setSelectedSections(['project_info', 'swot']);
        break;
      case 'process_analysis':
        setSelectedSections(['project_info', 'processes']);
        break;
      case 'canvas_report':
        setSelectedSections(['project_info', 'canvas']);
        break;
      case 'custom':
      default:
        setSelectedSections(['project_info']);
        break;
    }
    setWizardStep('configure');
  };

  const handleSectionToggle = (sectionId: string) => {
    setSelectedSections(prev => 
      prev.includes(sectionId)
        ? prev.filter(s => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const handleSaveConfig = () => {
    if (!reportName.trim()) {
      toast({ title: "Nome obrigatorio", description: "Informe um nome para a configuracao.", variant: "destructive" });
      return;
    }
    createConfigMutation.mutate({
      name: reportName,
      description: reportDescription,
      templateType: selectedTemplate,
      sections: selectedSections,
    });
    setIsNewReportOpen(false);
    setReportName('');
    setReportDescription('');
  };

  const handleLoadConfig = (config: ReportConfiguration) => {
    setSelectedTemplate(config.templateType);
    setSelectedSections(config.sections as string[] || ['project_info']);
    setWizardStep('configure');
    toast({ title: "Configuracao carregada", description: `"${config.name}" foi carregada.` });
  };

  const handlePrint = () => {
    window.print();
  };

  const selectedProject = useMemo(() => 
    projects.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  if (!selectedProjectId) {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Relatorios
          </h1>
          <p className="text-muted-foreground">Gere relatorios customizados dos seus projetos</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Selecione um Projeto</CardTitle>
            <CardDescription>Escolha um projeto para gerar relatorios</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingProjects ? (
              <p className="text-muted-foreground">Carregando projetos...</p>
            ) : projects.length === 0 ? (
              <p className="text-muted-foreground">Nenhum projeto encontrado.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((project) => (
                  <Card
                    key={project.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      navigate(`/relatorios/${project.id}`);
                    }}
                    data-testid={`card-project-${project.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Briefcase className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div>
                          <h3 className="font-medium">{project.name}</h3>
                          {project.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                              {project.description}
                            </p>
                          )}
                          <Badge variant="outline" className="mt-2">
                            {project.status}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (wizardStep === 'select') {
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => {
            setSelectedProjectId(null);
            navigate('/relatorios');
          }} data-testid="button-back-projects">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Novo Relatorio</h1>
            <p className="text-muted-foreground">{selectedProject?.name}</p>
          </div>
        </div>

        {selectedProjectId && (
          <div className="mb-6">
            <AgentPanel
              projectId={selectedProjectId}
              agentType="generic"
              label="Gerar resumo executivo com IA"
              description="Sintetiza diagnóstico, processos, SWOT e PDCA em um relatório executivo"
              visibleIn="reports"
              defaultPrompt="Gere um resumo executivo do projeto destacando: 1) principais achados do diagnóstico, 2) gaps críticos identificados, 3) recomendações priorizadas e 4) próximos passos."
            />
          </div>
        )}

        {savedConfigs.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Configuracoes Salvas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {savedConfigs.map((config) => (
                  <div key={config.id} className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadConfig(config)}
                      data-testid={`button-load-config-${config.id}`}
                    >
                      {config.name}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => deleteConfigMutation.mutate(config.id)}
                      data-testid={`button-delete-config-${config.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Escolha um Template</CardTitle>
            <CardDescription>Selecione o tipo de relatorio que deseja gerar</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {REPORT_TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <Card
                    key={template.id}
                    className="hover-elevate cursor-pointer"
                    onClick={() => handleTemplateSelect(template.id)}
                    data-testid={`card-template-${template.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-md bg-primary/10">
                          <Icon className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-medium">{template.name}</h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            {template.description}
                          </p>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (wizardStep === 'configure') {
    const templateInfo = REPORT_TEMPLATES.find(t => t.id === selectedTemplate);
    
    return (
      <div className="flex-1 p-6 overflow-auto">
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setWizardStep('select')} data-testid="button-back-template">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Configurar Relatorio</h1>
            <p className="text-muted-foreground">
              {templateInfo?.name} - {selectedProject?.name}
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Secoes do Relatorio</CardTitle>
                <CardDescription>Selecione as secoes que deseja incluir</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {REPORT_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    const isSelected = selectedSections.includes(section.id);
                    
                    return (
                      <div
                        key={section.id}
                        className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                          isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => handleSectionToggle(section.id)}
                        data-testid={`section-toggle-${section.id}`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSectionToggle(section.id)}
                        />
                        <Icon className={`h-5 w-5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                        <div className="flex-1">
                          <p className="font-medium">{section.name}</p>
                          <p className="text-sm text-muted-foreground">{section.description}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Resumo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Template</p>
                  <p className="font-medium">{templateInfo?.name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Secoes selecionadas</p>
                  <p className="font-medium">{selectedSections.length} de {REPORT_SECTIONS.length}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedSections.map((sectionId) => {
                    const section = REPORT_SECTIONS.find(s => s.id === sectionId);
                    return section ? (
                      <Badge key={sectionId} variant="secondary">
                        {section.name}
                      </Badge>
                    ) : null;
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="mt-4 space-y-2">
              <Button
                className="w-full"
                onClick={() => previewMutation.mutate()}
                disabled={selectedSections.length === 0 || previewMutation.isPending}
                data-testid="button-generate-preview"
              >
                <Eye className="h-4 w-4 mr-2" />
                {previewMutation.isPending ? 'Gerando...' : 'Visualizar Relatorio'}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setIsNewReportOpen(true)}
                data-testid="button-save-config"
              >
                <Save className="h-4 w-4 mr-2" />
                Salvar Configuracao
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={isNewReportOpen} onOpenChange={setIsNewReportOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Salvar Configuracao</DialogTitle>
              <DialogDescription>
                Salve esta configuracao para reutilizar em futuros relatorios
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="config-name">Nome</Label>
                <Input
                  id="config-name"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="Ex: Relatorio Mensal"
                  data-testid="input-config-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="config-description">Descricao (opcional)</Label>
                <Textarea
                  id="config-description"
                  value={reportDescription}
                  onChange={(e) => setReportDescription(e.target.value)}
                  placeholder="Descreva o proposito desta configuracao..."
                  data-testid="input-config-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsNewReportOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveConfig} disabled={createConfigMutation.isPending} data-testid="button-confirm-save">
                {createConfigMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (wizardStep === 'preview' && previewData) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="p-4 border-b flex items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setWizardStep('configure')} data-testid="button-back-configure">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Preview do Relatorio</h1>
              <p className="text-sm text-muted-foreground">{selectedProject?.name}</p>
            </div>
          </div>
          <Button variant="outline" onClick={handlePrint} data-testid="button-print">
            <Printer className="h-4 w-4 mr-2" />
            Imprimir
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-8 max-w-4xl mx-auto print:max-w-none print:p-0">
            <div className="mb-12 text-center print:page-break-after">
              <h1 className="text-4xl font-bold mb-4">{previewData.project?.name || 'Relatorio'}</h1>
              <p className="text-xl text-muted-foreground mb-8">{previewData.project?.description}</p>
              <div className="text-sm text-muted-foreground">
                Gerado em: {new Date(previewData.generatedAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>

            {previewData.project?.history && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <BookOpen className="h-6 w-6" />
                  Historia do Projeto
                </h2>
                <Card>
                  <CardContent className="pt-6">
                    <div 
                      className="prose prose-sm dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: previewData.project.history }}
                    />
                  </CardContent>
                </Card>
              </section>
            )}

            {previewData.canvas && previewData.canvas.blocks?.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Layers className="h-6 w-6" />
                  Canvas BMC - Atual
                </h2>
                <div className="grid gap-4">
                  {previewData.canvas.blocks.map((block: any) => (
                    <Card key={block.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">{block.title}</CardTitle>
                        <Badge variant="outline">{block.blockType}</Badge>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground">{block.content || 'Sem conteudo'}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {previewData.canvasSistemico && previewData.canvasSistemico.blocks?.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Layers className="h-6 w-6" />
                  Canvas BMC - Sistemico
                </h2>
                <div className="grid gap-4">
                  {previewData.canvasSistemico.blocks.map((block: any) => (
                    <Card key={block.id}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-lg">{block.title}</CardTitle>
                        <Badge variant="outline">{block.blockType}</Badge>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground">{block.content || 'Sem conteudo'}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {previewData.swot && previewData.swot.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Target className="h-6 w-6" />
                  Analise SWOT
                </h2>
                {previewData.swot.map((swotAnalysis: any, idx: number) => (
                  <div key={swotAnalysis.analysis?.id || idx} className="mb-8">
                    <p className="text-lg font-medium mb-4">{swotAnalysis.analysis?.name || 'Analise SWOT'}</p>
                    <div className="grid grid-cols-2 gap-4">
                      {['strength', 'weakness', 'opportunity', 'threat'].map((type) => {
                        const items = swotAnalysis[type === 'strength' ? 'strengths' : type === 'weakness' ? 'weaknesses' : type === 'opportunity' ? 'opportunities' : 'threats'] || [];
                        const labels: Record<string, string> = {
                          strength: 'Forcas',
                          weakness: 'Fraquezas',
                          opportunity: 'Oportunidades',
                          threat: 'Ameacas',
                        };
                        const colors: Record<string, string> = {
                          strength: 'bg-emerald-50 dark:bg-emerald-950/30',
                          weakness: 'bg-rose-50 dark:bg-rose-950/30',
                          opportunity: 'bg-blue-50 dark:bg-blue-950/30',
                          threat: 'bg-amber-50 dark:bg-amber-950/30',
                        };
                        
                        return (
                          <Card key={type} className={colors[type]}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-lg">{labels[type]} ({items.length})</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ul className="space-y-2">
                                {items.map((item: any) => (
                                  <li key={item.id} className="flex items-start gap-2">
                                    <span className="text-sm">-</span>
                                    <span className="text-sm">{item.content || item.title}</span>
                                  </li>
                                ))}
                                {items.length === 0 && (
                                  <li className="text-sm text-muted-foreground">Nenhum item</li>
                                )}
                              </ul>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {previewData.processes && previewData.processes.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <GitBranch className="h-6 w-6" />
                  Processos
                </h2>
                <div className="space-y-4">
                  {previewData.processes.map((processData: any, idx: number) => {
                    const process = processData.process || processData;
                    const steps = processData.steps || [];
                    return (
                      <Card key={process.id || idx}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <CardTitle className="text-lg">{process.name}</CardTitle>
                            <Badge variant={process.variantType === 'to_be' ? 'default' : 'secondary'}>
                              {process.variantType === 'to_be' ? 'TO-BE' : 'AS-IS'}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-muted-foreground mb-4">{process.description || 'Sem descricao'}</p>
                          {steps.length > 0 && (
                            <div className="mt-4">
                              <p className="text-sm font-medium mb-2">Etapas do processo:</p>
                              <ol className="list-decimal list-inside space-y-1">
                                {steps.map((step: any, stepIdx: number) => (
                                  <li key={step.id || stepIdx} className="text-sm text-muted-foreground">
                                    {step.name}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}

            {previewData.pdca && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <RefreshCcw className="h-6 w-6" />
                  Plano PDCA Consolidado
                </h2>
                
                {previewData.pdca.summary && (
                  <div className="grid grid-cols-5 gap-4 mb-6">
                    {Object.entries(previewData.pdca.summary.byStatus).map(([status, count]) => {
                      const statusLabels: Record<string, string> = {
                        plan: 'Planejar',
                        do: 'Executar',
                        check: 'Verificar',
                        act: 'Agir',
                        done: 'Concluido',
                      };
                      const statusColors: Record<string, string> = {
                        plan: 'bg-blue-50 dark:bg-blue-950/30',
                        do: 'bg-amber-50 dark:bg-amber-950/30',
                        check: 'bg-purple-50 dark:bg-purple-950/30',
                        act: 'bg-orange-50 dark:bg-orange-950/30',
                        done: 'bg-emerald-50 dark:bg-emerald-950/30',
                      };
                      return (
                        <Card key={status} className={statusColors[status]}>
                          <CardContent className="pt-4 text-center">
                            <p className="text-2xl font-bold">{count as number}</p>
                            <p className="text-sm text-muted-foreground">{statusLabels[status]}</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {previewData.pdca.canvas && previewData.pdca.canvas.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-3">PDCA do Canvas</h3>
                    <div className="space-y-2">
                      {previewData.pdca.canvas.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 p-3 border rounded-md">
                          <div>
                            <p className="font-medium">{item.title}</p>
                            <p className="text-sm text-muted-foreground">{item.description}</p>
                          </div>
                          <Badge variant="outline">{item.status}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewData.pdca.swot && previewData.pdca.swot.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-3">PDCA do SWOT</h3>
                    <div className="space-y-2">
                      {previewData.pdca.swot.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 p-3 border rounded-md">
                          <div>
                            <p className="font-medium">{item.content}</p>
                            <p className="text-sm text-muted-foreground">{item.actionPlan}</p>
                          </div>
                          <Badge variant="outline">{item.pdcaStatus}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewData.pdca.erp && previewData.pdca.erp.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-lg font-semibold mb-3">PDCA de Requisitos ERP</h3>
                    <div className="space-y-2">
                      {previewData.pdca.erp.map((item: any) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 p-3 border rounded-md">
                          <div>
                            <p className="font-medium">{item.requirement}</p>
                            <p className="text-sm text-muted-foreground">{item.recommendation}</p>
                          </div>
                          <Badge variant="outline">{item.pdcaStatus}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {previewData.deliverables && previewData.deliverables.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Package className="h-6 w-6" />
                  Entregas
                </h2>
                <div className="space-y-4">
                  {previewData.deliverables.map((deliverable: any) => (
                    <Card key={deliverable.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <CardTitle className="text-lg">{deliverable.title}</CardTitle>
                          <Badge variant="outline">{deliverable.status}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-muted-foreground">{deliverable.content || 'Sem conteudo'}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {previewData.tasks && previewData.tasks.length > 0 && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <CheckSquare className="h-6 w-6" />
                  Tarefas
                </h2>
                <div className="space-y-2">
                  {previewData.tasks.map((task: any) => (
                    <div key={task.id} className="flex items-center justify-between gap-2 p-3 border rounded-md">
                      <span>{task.title}</span>
                      <Badge variant={task.status === 'done' ? 'default' : 'secondary'}>
                        {task.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {previewData.erpRequirements && (previewData.erpRequirements.all?.length > 0 || previewData.erpRequirements.length > 0) && (
              <section className="mb-12 print:page-break-before">
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                  <Settings className="h-6 w-6" />
                  Requisitos ERP
                </h2>
                
                {previewData.erpRequirements.summary && (
                  <div className="grid grid-cols-5 gap-4 mb-6">
                    {Object.entries(previewData.erpRequirements.summary.byStatus).map(([status, count]) => {
                      const statusLabels: Record<string, string> = {
                        native: 'Nativo',
                        customization: 'Customizacao',
                        development: 'Desenvolvimento',
                        thirdParty: 'Terceiros',
                        notSupported: 'Nao Suportado',
                      };
                      return (
                        <Card key={status}>
                          <CardContent className="pt-4 text-center">
                            <p className="text-2xl font-bold">{count as number}</p>
                            <p className="text-xs text-muted-foreground">{statusLabels[status]}</p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {previewData.erpRequirements.byModule && Object.entries(previewData.erpRequirements.byModule).map(([moduleName, reqs]) => (
                  <div key={moduleName} className="mb-6">
                    <h3 className="text-lg font-semibold mb-3">{moduleName}</h3>
                    <div className="space-y-2">
                      {(reqs as any[]).map((req: any) => (
                        <div key={req.id} className="flex items-center justify-between gap-2 p-3 border rounded-md">
                          <div>
                            <p className="font-medium">{req.requirement}</p>
                            {req.recommendation && <p className="text-sm text-muted-foreground">{req.recommendation}</p>}
                          </div>
                          <Badge variant={req.adherenceStatus === 'native' ? 'default' : 'secondary'}>
                            {req.adherenceStatus}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {!previewData.erpRequirements.byModule && (previewData.erpRequirements.all || previewData.erpRequirements).map((req: any) => (
                  <div key={req.id} className="flex items-center justify-between gap-2 p-3 border rounded-md mb-2">
                    <div>
                      <p className="font-medium">{req.requirement}</p>
                      <p className="text-sm text-muted-foreground">{req.erpModule}</p>
                    </div>
                    <Badge variant={req.adherenceStatus === 'native' ? 'default' : 'secondary'}>
                      {req.adherenceStatus}
                    </Badge>
                  </div>
                ))}
              </section>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return null;
}
