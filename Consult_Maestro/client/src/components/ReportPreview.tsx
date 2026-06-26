import { useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { 
  Printer, 
  Download,
  Grid3X3,
  GitBranch,
  Target,
  CheckCircle2,
  AlertCircle,
  Building2,
  Workflow,
  ListOrdered
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { CANVAS_BLOCK_TYPES, CANVAS_LEVELS } from "@/lib/constants";
import type { Project, Client, CanvasBlock, Process, ProcessStep } from "@shared/schema";

interface ReportPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  reportType: string;
  reportTitle: string;
}

export function ReportPreview({ 
  open, 
  onOpenChange, 
  projectId, 
  reportType,
  reportTitle 
}: ReportPreviewProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const { data: project } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId && open,
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: open,
  });

  const { data: canvasBlocks = [] } = useQuery<CanvasBlock[]>({
    queryKey: ["/api/projects", projectId, "canvas"],
    enabled: !!projectId && open,
  });

  const { data: processes = [] } = useQuery<Process[]>({
    queryKey: ["/api/projects", projectId, "processes"],
    enabled: !!projectId && open,
  });

  const processStepsQueries = useQueries({
    queries: processes.map((process) => ({
      queryKey: ["/api/processes", process.id, "steps"],
      enabled: !!process.id && open && reportType === 'relatorio_geral',
    })),
  });

  const processStepsMap = new Map<string, ProcessStep[]>();
  processes.forEach((process, index) => {
    const stepsData = processStepsQueries[index]?.data as ProcessStep[] | undefined;
    if (stepsData) {
      processStepsMap.set(process.id, stepsData);
    }
  });

  const client = project ? clients.find(c => c.id === project.clientId) : null;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${reportTitle} - ${project?.name || 'Relatório'}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              padding: 40px;
              color: #1a1a1a;
              line-height: 1.6;
            }
            .header { 
              text-align: center;
              margin-bottom: 32px;
              padding-bottom: 24px;
              border-bottom: 2px solid #e5e5e5;
            }
            .header h1 { 
              font-size: 28px;
              font-weight: 700;
              margin-bottom: 8px;
            }
            .header .subtitle { 
              color: #666;
              font-size: 14px;
            }
            .header .meta {
              margin-top: 16px;
              font-size: 12px;
              color: #888;
            }
            .section { margin-bottom: 32px; }
            .section-title { 
              font-size: 18px;
              font-weight: 600;
              margin-bottom: 16px;
              padding-bottom: 8px;
              border-bottom: 1px solid #e5e5e5;
            }
            .block { 
              margin-bottom: 20px;
              padding: 16px;
              background: #f9f9f9;
              border-radius: 8px;
            }
            .block-title { 
              font-weight: 600;
              font-size: 14px;
              margin-bottom: 8px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .block-content { 
              font-size: 13px;
              color: #444;
            }
            .level-badge {
              display: inline-block;
              padding: 2px 8px;
              background: #e5e5e5;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 500;
            }
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 16px;
              margin-bottom: 24px;
            }
            .stat-box {
              padding: 16px;
              background: #f5f5f5;
              border-radius: 8px;
              text-align: center;
            }
            .stat-value { 
              font-size: 24px;
              font-weight: 700;
            }
            .stat-label { 
              font-size: 12px;
              color: #666;
            }
            .progress-bar {
              height: 8px;
              background: #e5e5e5;
              border-radius: 4px;
              overflow: hidden;
              margin-top: 8px;
            }
            .progress-fill {
              height: 100%;
              background: #3b82f6;
              border-radius: 4px;
            }
            .gap-item {
              padding: 12px;
              margin-bottom: 8px;
              background: #fff3cd;
              border-left: 3px solid #ffc107;
              border-radius: 0 4px 4px 0;
            }
            .action-item {
              padding: 12px;
              margin-bottom: 8px;
              background: #d1e7dd;
              border-left: 3px solid #198754;
              border-radius: 0 4px 4px 0;
            }
            @media print {
              body { padding: 20px; }
              .no-print { display: none; }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const getBlocksByLevel = (level: string) => 
    canvasBlocks.filter(b => b.level === level);

  const getCompletedBlockTypes = () => {
    const completed = new Set<string>();
    canvasBlocks.forEach(b => {
      if (b.content && b.content.trim()) {
        completed.add(b.blockType);
      }
    });
    return completed.size;
  };

  const overallProgress = Math.round((getCompletedBlockTypes() / CANVAS_BLOCK_TYPES.length) * 100);

  const renderCanvasRealReport = () => (
    <>
      <div className="section">
        <h3 className="section-title">Resumo do Canvas</h3>
        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-value">{canvasBlocks.length}</div>
            <div className="stat-label">Blocos Preenchidos</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{getCompletedBlockTypes()}/9</div>
            <div className="stat-label">Categorias Completas</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{processes.length}</div>
            <div className="stat-label">Processos Mapeados</div>
          </div>
          <div className="stat-box">
            <div className="stat-value">{overallProgress}%</div>
            <div className="stat-label">Progresso Geral</div>
          </div>
        </div>
      </div>

      {CANVAS_BLOCK_TYPES.map((blockType) => {
        const blocks = canvasBlocks.filter(b => b.blockType === blockType.value);
        if (blocks.length === 0) return null;

        return (
          <div key={blockType.value} className="section">
            <h3 className="section-title">{blockType.label}</h3>
            <p className="text-sm text-muted-foreground mb-3">{blockType.arcadiaLabel}</p>
            {blocks.map((block) => {
              const level = CANVAS_LEVELS.find(l => l.value === block.level);
              return (
                <div key={block.id} className="block">
                  <div className="block-title">
                    <span className="level-badge">{level?.label || block.level}</span>
                    <span>Completude: {block.completeness || 0}%</span>
                  </div>
                  <div className="block-content">
                    {block.content || "Sem conteúdo"}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );

  const renderLacunasReport = () => {
    const gaps = canvasBlocks.filter(b => (b.completeness || 0) < 50);
    const incomplete = CANVAS_BLOCK_TYPES.filter(bt => 
      !canvasBlocks.some(b => b.blockType === bt.value)
    );

    return (
      <>
        <div className="section">
          <h3 className="section-title">Lacunas Identificadas</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Áreas que precisam de atenção e desenvolvimento
          </p>

          {incomplete.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-500" />
                Blocos Não Preenchidos ({incomplete.length})
              </h4>
              {incomplete.map((bt) => (
                <div key={bt.value} className="gap-item">
                  <strong>{bt.label}</strong>
                  <p className="text-sm">{bt.arcadiaLabel}</p>
                </div>
              ))}
            </div>
          )}

          {gaps.length > 0 && (
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                Blocos com Baixa Completude ({gaps.length})
              </h4>
              {gaps.map((block) => {
                const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
                return (
                  <div key={block.id} className="gap-item">
                    <strong>{blockType?.label || block.blockType}</strong>
                    <p className="text-sm">Completude: {block.completeness || 0}%</p>
                  </div>
                );
              })}
            </div>
          )}

          {incomplete.length === 0 && gaps.length === 0 && (
            <div className="action-item">
              <CheckCircle2 className="h-4 w-4 text-green-500 inline mr-2" />
              Nenhuma lacuna crítica identificada!
            </div>
          )}
        </div>
      </>
    );
  };

  const renderTransformacaoReport = () => {
    const highPriority = canvasBlocks.filter(b => 
      b.level === 'sistemico' || (b.completeness || 0) >= 80
    );
    const quickWins = canvasBlocks.filter(b => 
      b.level === 'intencao' && (b.completeness || 0) >= 60
    );

    return (
      <>
        <div className="section">
          <h3 className="section-title">Plano de Ação PDCA</h3>
          
          <div className="mb-6">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-500" />
              Prioridades Estratégicas
            </h4>
            {highPriority.length > 0 ? (
              highPriority.map((block) => {
                const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
                return (
                  <div key={block.id} className="action-item">
                    <strong>{blockType?.label}</strong>
                    <p className="text-sm">{block.content?.substring(0, 150)}...</p>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                Complete mais blocos no nível sistêmico para ver prioridades.
              </p>
            )}
          </div>

          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Quick Wins Identificados
            </h4>
            {quickWins.length > 0 ? (
              quickWins.map((block) => {
                const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
                return (
                  <div key={block.id} className="action-item">
                    <strong>{blockType?.label}</strong>
                    <p className="text-sm">{block.content?.substring(0, 150)}...</p>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                Quick wins serão identificados conforme o diagnóstico avança.
              </p>
            )}
          </div>
        </div>
      </>
    );
  };

  const renderSistemicoReport = () => (
    <>
      <div className="section">
        <h3 className="section-title">Visão Sistêmica</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Integração entre sistemas e processos mapeados
        </p>

        <div className="mb-6">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-green-500" />
            Processos Mapeados ({processes.length})
          </h4>
          {processes.length > 0 ? (
            processes.map((process) => (
              <div key={process.id} className="block">
                <div className="block-title">{process.name}</div>
                <div className="block-content">
                  {process.description || "Sem descrição"}
                  {process.isAutomatable === 1 && (
                    <Badge variant="secondary" className="ml-2">Automatizado</Badge>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum processo mapeado ainda.
            </p>
          )}
        </div>

        {getBlocksByLevel('sistemico').length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Análise Sistêmica do Canvas</h4>
            {getBlocksByLevel('sistemico').map((block) => {
              const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
              return (
                <div key={block.id} className="block">
                  <div className="block-title">{blockType?.label}</div>
                  <div className="block-content">{block.content}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  const renderGeneralReport = () => {
    const statusLabels: Record<string, string> = {
      backlog: 'Backlog',
      diagnostico: 'Diagnóstico',
      andamento: 'Em Andamento',
      revisao: 'Revisão',
      concluido: 'Concluído'
    };

    const automatedProcesses = processes.filter(p => p.isAutomatable === 1);
    const manualProcesses = processes.filter(p => p.isAutomatable !== 1);

    return (
      <>
        <div className="section">
          <h3 className="section-title flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Informações do Projeto
          </h3>
          <div className="block">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Cliente</div>
                <div className="font-medium">{client?.name || 'Não informado'}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <Badge variant="secondary">
                  {statusLabels[project?.status || 'backlog'] || project?.status}
                </Badge>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Data Início</div>
                <div className="font-medium">
                  {project?.startDate 
                    ? new Date(project.startDate).toLocaleDateString('pt-BR') 
                    : 'Não definida'}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Data Término</div>
                <div className="font-medium">
                  {project?.dueDate 
                    ? new Date(project.dueDate).toLocaleDateString('pt-BR') 
                    : 'Não definida'}
                </div>
              </div>
            </div>
            {project?.description && (
              <div className="mt-4">
                <div className="text-sm text-muted-foreground">Descrição</div>
                <div className="text-sm mt-1">{project.description}</div>
              </div>
            )}
          </div>
        </div>

        <div className="section">
          <h3 className="section-title flex items-center gap-2">
            <Grid3X3 className="h-5 w-5 text-blue-500" />
            Resumo do Diagnóstico
          </h3>
          <div className="stats-grid">
            <div className="stat-box">
              <div className="stat-value">{canvasBlocks.length}</div>
              <div className="stat-label">Blocos Preenchidos</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{getCompletedBlockTypes()}/9</div>
              <div className="stat-label">Categorias Completas</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{processes.length}</div>
              <div className="stat-label">Processos Mapeados</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{overallProgress}%</div>
              <div className="stat-label">Progresso Geral</div>
            </div>
          </div>
        </div>

        <div className="section">
          <h3 className="section-title flex items-center gap-2">
            <Grid3X3 className="h-5 w-5 text-blue-500" />
            Canvas BMC - Todos os Níveis
          </h3>
          {CANVAS_BLOCK_TYPES.map((blockType) => {
            const blocks = canvasBlocks.filter(b => b.blockType === blockType.value);
            if (blocks.length === 0) return null;

            return (
              <div key={blockType.value} className="mb-6">
                <h4 className="font-semibold mb-2">{blockType.label}</h4>
                <p className="text-xs text-muted-foreground mb-3">{blockType.arcadiaLabel}</p>
                {CANVAS_LEVELS.map((level) => {
                  const levelBlocks = blocks.filter(b => b.level === level.value);
                  if (levelBlocks.length === 0) return null;
                  
                  return levelBlocks.map((block) => (
                    <div key={block.id} className="block">
                      <div className="block-title">
                        <span className="level-badge">{level.label}</span>
                        <span className="text-xs text-muted-foreground">
                          Completude: {block.completeness || 0}%
                        </span>
                      </div>
                      <div className="block-content mt-2">
                        {block.content || "Sem conteúdo"}
                      </div>
                    </div>
                  ));
                })}
              </div>
            );
          })}
          {canvasBlocks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum bloco do Canvas foi preenchido ainda.
            </p>
          )}
        </div>

        <div className="section">
          <h3 className="section-title flex items-center gap-2">
            <Workflow className="h-5 w-5 text-green-500" />
            Processos Mapeados ({processes.length})
          </h3>
          
          {processes.length > 0 ? (
            processes.map((process) => {
              const steps = processStepsMap.get(process.id) || [];
              const sortedSteps = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
              
              return (
                <div key={process.id} className="mb-6">
                  <div className="block">
                    <div className="block-title flex items-center gap-2">
                      {process.name}
                      {process.isAutomatable === 1 ? (
                        <Badge variant="secondary" className="text-xs">Automatizado</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs">Manual</Badge>
                      )}
                    </div>
                    <div className="block-content">
                      {process.description || "Sem descrição"}
                    </div>
                    {process.category && (
                      <div className="text-xs text-muted-foreground mt-2">
                        Categoria: {process.category}
                      </div>
                    )}
                  </div>
                  
                  {sortedSteps.length > 0 && (
                    <div className="mt-3 ml-4">
                      <h5 className="text-sm font-medium mb-2 flex items-center gap-2">
                        <ListOrdered className="h-4 w-4 text-muted-foreground" />
                        Etapas do Processo ({sortedSteps.length})
                      </h5>
                      <div className="space-y-2">
                        {sortedSteps.map((step, idx) => (
                          <div key={step.id} className="flex gap-3 items-start p-2 bg-muted/30 rounded-md">
                            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
                              {idx + 1}
                            </div>
                            <div className="flex-1">
                              <div className="font-medium text-sm">{step.name}</div>
                              {step.description && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {step.description}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2 mt-1">
                                {step.responsible && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                    Responsável: {step.responsible}
                                  </span>
                                )}
                                {step.duration && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                    Duração: {step.duration}
                                  </span>
                                )}
                                {step.stepType && (
                                  <span className="text-xs bg-muted px-2 py-0.5 rounded">
                                    Tipo: {step.stepType}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum processo foi mapeado ainda.
            </p>
          )}
        </div>

        <div className="section">
          <h3 className="section-title flex items-center gap-2">
            <Target className="h-5 w-5 text-orange-500" />
            Lacunas e Oportunidades
          </h3>
          {(() => {
            const gaps = canvasBlocks.filter(b => (b.completeness || 0) < 50);
            const incomplete = CANVAS_BLOCK_TYPES.filter(bt => 
              !canvasBlocks.some(b => b.blockType === bt.value)
            );

            if (incomplete.length === 0 && gaps.length === 0) {
              return (
                <div className="action-item">
                  <CheckCircle2 className="h-4 w-4 text-green-500 inline mr-2" />
                  Nenhuma lacuna crítica identificada!
                </div>
              );
            }

            return (
              <>
                {incomplete.length > 0 && (
                  <div className="mb-4">
                    <h4 className="font-medium mb-2">Blocos Não Preenchidos ({incomplete.length})</h4>
                    {incomplete.map((bt) => (
                      <div key={bt.value} className="gap-item">
                        <strong>{bt.label}</strong>
                        <p className="text-sm">{bt.arcadiaLabel}</p>
                      </div>
                    ))}
                  </div>
                )}
                {gaps.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Blocos com Baixa Completude ({gaps.length})</h4>
                    {gaps.map((block) => {
                      const blockType = CANVAS_BLOCK_TYPES.find(bt => bt.value === block.blockType);
                      return (
                        <div key={block.id} className="gap-item">
                          <strong>{blockType?.label || block.blockType}</strong>
                          <p className="text-sm">Completude: {block.completeness || 0}%</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </>
    );
  };

  const renderReportContent = () => {
    switch (reportType) {
      case 'relatorio_geral':
        return renderGeneralReport();
      case 'canvas_real':
        return renderCanvasRealReport();
      case 'lacunas':
        return renderLacunasReport();
      case 'roadmap':
        return renderTransformacaoReport();
      case 'canvas_sistemico':
        return renderSistemicoReport();
      default:
        return renderCanvasRealReport();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between gap-4">
          <DialogTitle className="text-xl">{reportTitle}</DialogTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handlePrint} data-testid="button-print-report">
              <Printer className="h-4 w-4 mr-2" />
              Imprimir
            </Button>
            <Button variant="outline" onClick={handlePrint} data-testid="button-export-report">
              <Download className="h-4 w-4 mr-2" />
              Exportar PDF
            </Button>
          </div>
        </DialogHeader>

        <Separator className="my-4" />

        <div ref={printRef} className="space-y-6">
          <div className="header text-center pb-4 border-b">
            <h1 className="text-2xl font-bold">{reportTitle}</h1>
            <p className="subtitle text-muted-foreground">
              {project?.name} {client && `- ${client.name}`}
            </p>
            <p className="meta text-sm text-muted-foreground mt-2">
              Gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}
            </p>
          </div>

          {renderReportContent()}

          <div className="text-center text-xs text-muted-foreground pt-6 border-t">
            Arcádia Consulting - Plataforma de Diagnóstico
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
