import type { Node, Edge } from "reactflow";
import { MarkerType } from "reactflow";

interface GeneratedDiagram {
  nodes: Node[];
  edges: Edge[];
}

interface ParsedStep {
  type: "start" | "task" | "decision" | "end";
  label: string;
}

// Interface for process steps from the database
interface ProcessStepInput {
  id: string;
  name: string;
  stepType: string | null;
  order: number | null;
}

const DECISION_KEYWORDS = [
  "se ", "se o ", "se a ", "caso ", "quando ",
  "verificar ", "verificar se ", "verificando ",
  "avaliar ", "avaliar se ", "avaliando ",
  "decidir ", "decidindo ",
  "checar ", "checando ",
  "analisar se ", "analisando se ",
  "determinar se ", "determinando se ",
  "conferir ", "conferir se ", "conferindo ",
  "validar ", "validar se ", "validando ",
  "existe ", "existem ",
  "há ", "houver ",
  "possui ", "possuem ",
  "tem ", "têm ",
  "pode ", "podem ",
  "deve ", "devem ",
  "precisa ", "precisam ",
  "está ", "estão ",
  "é ", "são ",
  "aprovado", "aprovada", "reprovado", "reprovada",
  "sim ou não", "sim/não", "aprovado/reprovado",
  "ok?", "ok ",
  "?",
];

const START_KEYWORDS = [
  "início", "inicio", "iniciar", "começar", "comecar",
  "start", "begin", "início do processo", "inicio do processo",
  "receber solicitação", "receber solicitacao",
  "recebimento",
];

const END_KEYWORDS = [
  "fim", "final", "finalizar", "terminar", "encerrar",
  "concluir", "conclusão", "conclusao", "end", "finish",
  "fim do processo", "processo finalizado",
  "entregar", "entrega final",
  "arquivar", "arquivamento",
];

function cleanText(text: string): string {
  return text
    .replace(/^\s*[-•*]\s*/, "")
    .replace(/^\s*\d+[\.\)]\s*/, "")
    .replace(/^\s*\([a-z0-9]+\)\s*/i, "")
    .replace(/;\s*$/, "")
    .replace(/\.\s*$/, "")
    .trim();
}

function detectStepType(text: string, index: number, total: number): "start" | "task" | "decision" | "end" {
  const lowerText = text.toLowerCase();
  
  if (index === 0) {
    for (const keyword of START_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        return "start";
      }
    }
  }
  
  if (index === total - 1) {
    for (const keyword of END_KEYWORDS) {
      if (lowerText.includes(keyword)) {
        return "end";
      }
    }
  }
  
  for (const keyword of DECISION_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      return "decision";
    }
  }
  
  return "task";
}

function splitIntoSteps(description: string): string[] {
  let steps: string[] = [];
  
  const lines = description.split(/\n+/);
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    
    if (/^[-•*]\s/.test(trimmedLine) || /^\d+[\.\)]\s/.test(trimmedLine) || /^\([a-z0-9]+\)/i.test(trimmedLine)) {
      steps.push(cleanText(trimmedLine));
    } else {
      const sentences = trimmedLine.split(/[;\.]\s+(?=[A-Z])|[;\.]\s+(?=\d)/);
      for (const sentence of sentences) {
        const cleaned = cleanText(sentence);
        if (cleaned.length > 3) {
          steps.push(cleaned);
        }
      }
    }
  }
  
  if (steps.length === 0 && description.trim().length > 0) {
    const sentences = description.split(/[\.;]+/).map(s => s.trim()).filter(s => s.length > 3);
    steps = sentences;
  }
  
  return steps.filter(s => s.length > 3);
}

function truncateLabel(label: string, maxLength: number = 40): string {
  if (label.length <= maxLength) return label;
  return label.substring(0, maxLength - 3) + "...";
}

export function generateDiagramFromDescription(description: string): GeneratedDiagram {
  if (!description || description.trim().length === 0) {
    return { nodes: [], edges: [] };
  }

  const rawSteps = splitIntoSteps(description);
  
  if (rawSteps.length === 0) {
    return { nodes: [], edges: [] };
  }

  const parsedSteps: ParsedStep[] = rawSteps.map((step, index) => ({
    type: detectStepType(step, index, rawSteps.length),
    label: truncateLabel(step),
  }));

  const hasStart = parsedSteps.some(s => s.type === "start");
  const hasEnd = parsedSteps.some(s => s.type === "end");

  if (!hasStart) {
    parsedSteps.unshift({ type: "start", label: "Início" });
  }
  if (!hasEnd) {
    parsedSteps.push({ type: "end", label: "Fim" });
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const baseX = 250;
  const baseY = 50;
  const ySpacing = 120;
  const decisionXOffset = 200;

  let currentY = baseY;
  let lastNonDecisionNodeId: string | null = null;
  
  for (let i = 0; i < parsedSteps.length; i++) {
    const step = parsedSteps[i];
    const nodeId = `node-${Date.now()}-${i}`;
    
    let x = baseX;
    if (step.type === "decision") {
      x = baseX;
    }

    const node: Node = {
      id: nodeId,
      type: step.type,
      position: { x, y: currentY },
      data: { label: step.label },
    };
    
    nodes.push(node);

    if (i > 0) {
      const previousNode = nodes[i - 1];
      const edge: Edge = {
        id: `edge-${previousNode.id}-${nodeId}`,
        source: previousNode.id,
        target: nodeId,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2, stroke: "#64748b" },
      };
      edges.push(edge);
    }

    currentY += ySpacing;
    
    if (step.type === "decision") {
      currentY += 40;
    }
  }

  return { nodes, edges };
}

export function hasDescription(description: string | null | undefined): boolean {
  return !!description && description.trim().length > 10;
}

// Map stepType from database to node type
function mapStepTypeToNodeType(stepType: string | null): "start" | "task" | "decision" | "end" {
  switch (stepType?.toLowerCase()) {
    case "start":
    case "inicio":
    case "início":
      return "start";
    case "decision":
    case "decisao":
    case "decisão":
      return "decision";
    case "end":
    case "fim":
    case "final":
      return "end";
    case "action":
    case "task":
    case "acao":
    case "ação":
    case "tarefa":
    default:
      return "task";
  }
}

// Generate diagram from process steps (mapeamento)
export function generateDiagramFromSteps(steps: ProcessStepInput[]): GeneratedDiagram {
  if (!steps || steps.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Sort steps by order
  const sortedSteps = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const baseX = 250;
  const baseY = 50;
  const ySpacing = 120;
  const decisionExtraSpacing = 40;

  let currentY = baseY;
  let nodeIndex = 0;

  // Check if we need to add a start node
  const firstStepType = mapStepTypeToNodeType(sortedSteps[0].stepType);
  if (firstStepType !== "start") {
    const startNodeId = `auto-start-${Date.now()}`;
    nodes.push({
      id: startNodeId,
      type: "start",
      position: { x: baseX, y: currentY },
      data: { label: "Inicio" },
    });
    currentY += ySpacing;
    nodeIndex++;
  }

  // Create nodes from steps
  for (let i = 0; i < sortedSteps.length; i++) {
    const step = sortedSteps[i];
    const nodeType = mapStepTypeToNodeType(step.stepType);
    const nodeId = `step-${step.id}`;

    const node: Node = {
      id: nodeId,
      type: nodeType,
      position: { x: baseX, y: currentY },
      data: { 
        label: truncateLabel(step.name, 35),
        stepId: step.id,
      },
    };

    nodes.push(node);

    // Create edge to connect with previous node
    if (nodes.length > 1) {
      const previousNode = nodes[nodes.length - 2];
      const edge: Edge = {
        id: `edge-${previousNode.id}-${nodeId}`,
        source: previousNode.id,
        target: nodeId,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2, stroke: "#64748b" },
      };
      edges.push(edge);
    }

    currentY += ySpacing;
    nodeIndex++;

    // Add extra spacing after decision nodes
    if (nodeType === "decision") {
      currentY += decisionExtraSpacing;
    }
  }

  // Check if we need to add an end node
  const lastStepType = mapStepTypeToNodeType(sortedSteps[sortedSteps.length - 1].stepType);
  if (lastStepType !== "end") {
    const endNodeId = `auto-end-${Date.now()}`;
    const endNode: Node = {
      id: endNodeId,
      type: "end",
      position: { x: baseX, y: currentY },
      data: { label: "Fim" },
    };
    nodes.push(endNode);

    // Connect last step to end node
    if (nodes.length > 1) {
      const previousNode = nodes[nodes.length - 2];
      const edge: Edge = {
        id: `edge-${previousNode.id}-${endNodeId}`,
        source: previousNode.id,
        target: endNodeId,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 2, stroke: "#64748b" },
      };
      edges.push(edge);
    }
  }

  return { nodes, edges };
}

// Check if there are steps to generate from
export function hasSteps(steps: ProcessStepInput[] | null | undefined): boolean {
  return !!steps && steps.length > 0;
}
