import { useCallback, useState, useMemo, useEffect, useRef } from "react";
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  NodeProps,
  Handle,
  Position,
  MarkerType,
} from "reactflow";
import "reactflow/dist/style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Circle, Square, Diamond, Plus, Save, Trash2, Edit, X, Printer, Wand2 } from "lucide-react";
import { generateDiagramFromDescription, hasDescription, generateDiagramFromSteps, hasSteps } from "@/lib/diagramGenerator";

interface DiagramData {
  nodes: Node[];
  edges: Edge[];
}

interface ProcessStepForDiagram {
  id: string;
  name: string;
  stepType: string | null;
  order: number | null;
}

interface ProcessDiagramEditorProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onSave: (data: DiagramData) => void;
  isSaving?: boolean;
  processDescription?: string | null;
  processSteps?: ProcessStepForDiagram[];
  onNodeDoubleClick?: (stepId: string | null, nodeType: string) => void;
  onAddStepFromDiagram?: (stepType: string) => void;
}

function StartNode({ data, id }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || "Início");

  const handleSave = () => {
    if (data.onLabelChange) {
      data.onLabelChange(id, label);
    }
    setIsEditing(false);
  };

  return (
    <div className="relative">
      <Handle type="source" position={Position.Bottom} className="!bg-green-600" />
      <div 
        className="flex flex-col items-center justify-center w-20 h-20 rounded-full bg-green-500 text-white shadow-md cursor-pointer"
        onDoubleClick={() => setIsEditing(true)}
      >
        <Circle className="h-6 w-6 mb-1" />
        {isEditing ? (
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-16 h-5 text-xs text-center bg-transparent border-white text-white"
            autoFocus
          />
        ) : (
          <span className="text-xs font-medium">{data.label || "Início"}</span>
        )}
      </div>
    </div>
  );
}

function TaskNode({ data, id }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || "Tarefa");

  const handleSave = () => {
    if (data.onLabelChange) {
      data.onLabelChange(id, label);
    }
    setIsEditing(false);
  };

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className="!bg-blue-600" />
      <Handle type="source" position={Position.Bottom} className="!bg-blue-600" />
      <div 
        className="flex flex-col items-center justify-center min-w-32 min-h-16 px-4 py-3 rounded-md bg-blue-500 text-white shadow-md cursor-pointer"
        onDoubleClick={() => setIsEditing(true)}
      >
        <Square className="h-4 w-4 mb-1" />
        {isEditing ? (
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-24 h-5 text-xs text-center bg-transparent border-white text-white"
            autoFocus
          />
        ) : (
          <span className="text-xs font-medium text-center">{data.label || "Tarefa"}</span>
        )}
      </div>
    </div>
  );
}

function DecisionNode({ data, id }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || "Decisão");

  const handleSave = () => {
    if (data.onLabelChange) {
      data.onLabelChange(id, label);
    }
    setIsEditing(false);
  };

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className="!bg-amber-600" />
      <Handle type="source" position={Position.Bottom} className="!bg-amber-600" id="bottom" />
      <Handle type="source" position={Position.Right} className="!bg-amber-600" id="right" />
      <Handle type="source" position={Position.Left} className="!bg-amber-600" id="left" />
      <div 
        className="flex flex-col items-center justify-center w-24 h-24 rotate-45 bg-amber-500 text-white shadow-md cursor-pointer"
        onDoubleClick={() => setIsEditing(true)}
      >
        <div className="-rotate-45 flex flex-col items-center">
          <Diamond className="h-4 w-4 mb-1" />
          {isEditing ? (
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="w-16 h-5 text-xs text-center bg-transparent border-white text-white"
              autoFocus
            />
          ) : (
            <span className="text-xs font-medium text-center max-w-16 truncate">{data.label || "Decisão"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function EndNode({ data, id }: NodeProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(data.label || "Fim");

  const handleSave = () => {
    if (data.onLabelChange) {
      data.onLabelChange(id, label);
    }
    setIsEditing(false);
  };

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className="!bg-red-600" />
      <div 
        className="flex flex-col items-center justify-center w-20 h-20 rounded-full bg-red-500 text-white shadow-md cursor-pointer"
        onDoubleClick={() => setIsEditing(true)}
      >
        <Circle className="h-6 w-6 mb-1" />
        {isEditing ? (
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-16 h-5 text-xs text-center bg-transparent border-white text-white"
            autoFocus
          />
        ) : (
          <span className="text-xs font-medium">{data.label || "Fim"}</span>
        )}
      </div>
    </div>
  );
}

const NODE_TYPES = {
  start: { type: "start", label: "Início", icon: Circle, color: "bg-green-500", Component: StartNode },
  task: { type: "task", label: "Tarefa", icon: Square, color: "bg-blue-500", Component: TaskNode },
  decision: { type: "decision", label: "Decisão", icon: Diamond, color: "bg-amber-500", Component: DecisionNode },
  end: { type: "end", label: "Fim", icon: Circle, color: "bg-red-500", Component: EndNode },
};

export default function ProcessDiagramEditor({
  initialNodes = [],
  initialEdges = [],
  onSave,
  isSaving = false,
  processDescription = null,
  processSteps = [],
  onNodeDoubleClick,
  onAddStepFromDiagram,
}: ProcessDiagramEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current && (initialNodes.length > 0 || initialEdges.length > 0)) {
      setNodes(initialNodes);
      setEdges(initialEdges);
      initializedRef.current = true;
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const nodeTypes = useMemo(() => {
    const handleLabelChange = (nodeId: string, newLabel: string) => {
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? { ...node, data: { ...node.data, label: newLabel } }
            : node
        )
      );
      setHasChanges(true);
    };

    return {
      start: (props: NodeProps) => <StartNode {...props} data={{ ...props.data, onLabelChange: handleLabelChange }} />,
      task: (props: NodeProps) => <TaskNode {...props} data={{ ...props.data, onLabelChange: handleLabelChange }} />,
      decision: (props: NodeProps) => <DecisionNode {...props} data={{ ...props.data, onLabelChange: handleLabelChange }} />,
      end: (props: NodeProps) => <EndNode {...props} data={{ ...props.data, onLabelChange: handleLabelChange }} />,
    };
  }, [setNodes]);

  useEffect(() => {
    if (hasChanges) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        onSave({ nodes, edges });
        setHasChanges(false);
      }, 1500);
    }
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [hasChanges, nodes, edges, onSave]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          },
          eds
        )
      );
      setHasChanges(true);
    },
    [setEdges]
  );

  const addNode = (type: keyof typeof NODE_TYPES) => {
    const newNode: Node = {
      id: `${type}-${Date.now()}`,
      type,
      position: { x: 250, y: nodes.length * 100 + 50 },
      data: { label: NODE_TYPES[type].label },
    };
    setNodes((nds) => [...nds, newNode]);
    setHasChanges(true);
  };

  const deleteSelectedNode = () => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNode && e.target !== selectedNode));
      setSelectedNode(null);
      setHasChanges(true);
    }
  };

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, []);

  const handleNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (onNodeDoubleClick) {
      // Extract stepId from node id (format: "step-{stepId}")
      const stepId = node.id.startsWith('step-') ? node.id.replace('step-', '') : null;
      onNodeDoubleClick(stepId, node.type || 'task');
    }
  }, [onNodeDoubleClick]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleManualSave = () => {
    onSave({ nodes, edges });
    setHasChanges(false);
  };

  const handleGenerateFromDescription = () => {
    if (!processDescription || !hasDescription(processDescription)) {
      return;
    }
    
    const generated = generateDiagramFromDescription(processDescription);
    
    if (generated.nodes.length > 0) {
      setNodes(generated.nodes);
      setEdges(generated.edges);
      onSave(generated);
    }
  };

  const handleGenerateFromSteps = () => {
    if (!processSteps || !hasSteps(processSteps)) {
      return;
    }
    
    const generated = generateDiagramFromSteps(processSteps);
    
    if (generated.nodes.length > 0) {
      setNodes(generated.nodes);
      setEdges(generated.edges);
      onSave(generated);
    }
  };

  const canGenerateFromDescription = hasDescription(processDescription);
  const canGenerateFromSteps = hasSteps(processSteps);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const nodeWidths: Record<string, number> = { start: 80, task: 120, decision: 80, end: 80 };
    const nodeHeights: Record<string, number> = { start: 80, task: 50, decision: 80, end: 80 };

    const edgesSvg = edges.map(edge => {
      const sourceNode = nodeMap.get(edge.source);
      const targetNode = nodeMap.get(edge.target);
      if (!sourceNode || !targetNode) return '';

      const sourceW = nodeWidths[sourceNode.type || 'task'] || 120;
      const sourceH = nodeHeights[sourceNode.type || 'task'] || 50;
      const targetW = nodeWidths[targetNode.type || 'task'] || 120;

      const x1 = sourceNode.position.x + sourceW / 2;
      const y1 = sourceNode.position.y + sourceH;
      const x2 = targetNode.position.x + targetW / 2;
      const y2 = targetNode.position.y;

      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666" stroke-width="2" marker-end="url(#arrowhead)" />`;
    }).join('');

    const nodeHtml = nodes.map(node => {
      const colors: Record<string, string> = {
        start: '#22c55e',
        task: '#3b82f6',
        decision: '#f59e0b',
        end: '#ef4444',
      };
      const bgColor = colors[node.type || 'task'] || '#3b82f6';
      const isCircle = node.type === 'start' || node.type === 'end';
      const isDiamond = node.type === 'decision';
      
      return `
        <div style="
          position: absolute;
          left: ${node.position.x}px;
          top: ${node.position.y}px;
          background: ${bgColor};
          color: white;
          padding: ${isDiamond ? '20px' : '12px 16px'};
          border-radius: ${isCircle ? '50%' : isDiamond ? '0' : '6px'};
          min-width: ${isCircle ? '80px' : '120px'};
          min-height: ${isCircle ? '80px' : isDiamond ? '80px' : '50px'};
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          font-size: 12px;
          font-weight: 500;
          ${isDiamond ? 'transform: rotate(45deg);' : ''}
        ">
          <span ${isDiamond ? 'style="transform: rotate(-45deg);"' : ''}>${node.data?.label || ''}</span>
        </div>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Diagrama de Processo</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
              padding: 40px;
            }
            .header { 
              text-align: center;
              margin-bottom: 32px;
              padding-bottom: 16px;
              border-bottom: 2px solid #e5e5e5;
            }
            .header h1 { font-size: 24px; font-weight: 700; }
            .header .meta { margin-top: 8px; font-size: 12px; color: #888; }
            .diagram-container {
              position: relative;
              width: 100%;
              min-height: 600px;
              background: #fafafa;
              border: 1px solid #e5e5e5;
              border-radius: 8px;
              overflow: visible;
            }
            .edges-layer {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
            }
            .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #888; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Diagrama de Processo</h1>
            <p class="meta">Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}</p>
          </div>
          <div class="diagram-container">
            <svg class="edges-layer" width="100%" height="100%">
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
                </marker>
              </defs>
              ${edgesSvg}
            </svg>
            ${nodeHtml}
          </div>
          <div class="footer">Arcádia Consulting - Plataforma de Diagnóstico</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground mr-2">Adicionar:</span>
          {Object.entries(NODE_TYPES).map(([key, nodeType]) => {
            const Icon = nodeType.icon;
            return (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => addNode(key as keyof typeof NODE_TYPES)}
                data-testid={`button-add-${key}-node`}
              >
                <div className={`w-3 h-3 rounded-sm ${nodeType.color} mr-2`} />
                {nodeType.label}
              </Button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          {canGenerateFromSteps && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateFromSteps}
              data-testid="button-generate-from-steps"
            >
              <Wand2 className="h-4 w-4 mr-1" />
              Gerar do Mapeamento
            </Button>
          )}
          {canGenerateFromDescription && !canGenerateFromSteps && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateFromDescription}
              data-testid="button-generate-diagram"
            >
              <Wand2 className="h-4 w-4 mr-1" />
              Gerar da Descrição
            </Button>
          )}
          {selectedNode && (
            <Button
              variant="outline"
              size="sm"
              onClick={deleteSelectedNode}
              className="text-destructive"
              data-testid="button-delete-node"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Excluir
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            data-testid="button-print-diagram"
          >
            <Printer className="h-4 w-4 mr-1" />
            Imprimir
          </Button>
          <Button
            size="sm"
            onClick={handleManualSave}
            disabled={isSaving}
            data-testid="button-save-diagram"
          >
            <Save className="h-4 w-4 mr-1" />
            {isSaving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-[500px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            if (changes.some(c => c.type === 'position' && 'dragging' in c && !c.dragging)) {
              setHasChanges(true);
            }
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            setHasChanges(true);
          }}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={{
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2, stroke: '#64748b' },
            animated: false,
          }}
          className="bg-background"
        >
          <Controls className="!bg-card !border-border !shadow-sm" />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="!bg-muted/20" />
        </ReactFlow>
      </div>
      <div className="p-2 border-t bg-muted/30 text-xs text-muted-foreground text-center">
        Clique duas vezes em um no para editar a etapa. Arraste entre nos para criar conexoes.
      </div>
    </div>
  );
}
