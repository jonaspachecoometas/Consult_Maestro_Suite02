// Agente Scrum — 2 modos.
// Modo 1: análise de documento → JSON estruturado de projeto.
// Modo 2: chat assistente dentro da tarefa.

import { runWithOrchestration, callChatLLM } from "../agentService";
import { db } from "../db";
import {
  projectFiles, subprojects, projects, tasks, projectCalendarEvents,
  taskAgentSessions, superAgentMessages, scrumSprints, scrumBacklogItems,
  scrumInternalProjects,
} from "@shared/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { z } from "zod";

// Tipos PBI válidos (mesmo do enum scrum_pbi_type no schema)
const PBI_TYPES = ["feature", "bug", "improvement", "task", "support", "analysis", "documentation", "training", "meeting"] as const;
// Enum REAL do schema scrum_pbi_status: backlog, selecionado, em_execucao, em_revisao,
// aguardando_validacao, concluido, bloqueado, cancelado
const PBI_STATUSES = ["backlog", "selecionado", "em_execucao", "em_revisao", "aguardando_validacao", "concluido", "bloqueado", "cancelado"] as const;
const PBI_PRIORITIES = ["critical", "high", "medium", "low"] as const;

// Normaliza variantes comuns (ex: 'em_andamento' → 'em_execucao') para enum DB válido
function normalizePbiStatus(s: any): "backlog" | "selecionado" | "em_execucao" | "em_revisao" | "aguardando_validacao" | "concluido" | "bloqueado" | "cancelado" {
  const v = String(s || "").toLowerCase().trim();
  if (v === "em_andamento" || v === "em andamento" || v === "doing" || v === "in_progress") return "em_execucao";
  if (v === "done" || v === "concluído") return "concluido";
  if (v === "blocked") return "bloqueado";
  if ((PBI_STATUSES as readonly string[]).includes(v)) return v as any;
  return "backlog";
}

// Mapeia prioridade numérica antiga (0..3) → enum string
function mapPriority(p: any): "critical" | "high" | "medium" | "low" {
  if (typeof p === "string" && (PBI_PRIORITIES as readonly string[]).includes(p)) return p as any;
  if (typeof p === "number") {
    if (p >= 3) return "critical";
    if (p === 2) return "high";
    if (p === 1) return "medium";
    return "low";
  }
  return "medium";
}

const pbiItemSchema = z.object({
  titulo: z.string().min(1).max(500),
  descricao: z.string().nullable().optional(),
  criterioAceitacao: z.string().nullable().optional(),
  responsavel: z.string().nullable().optional(),
  prioridade: z.union([z.number().int().min(0).max(3), z.enum(PBI_PRIORITIES)]).optional(),
  tipo: z.enum(PBI_TYPES).optional(),
  status: z.string().max(50).optional(),
  storyPoints: z.number().int().min(0).max(100).nullable().optional(),
  estimatedHours: z.number().int().min(0).max(2000).nullable().optional(),
  entregavel: z.string().nullable().optional(),
});
const sprintItemSchema = z.object({
  nome: z.string().min(1).max(255),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  objetivo: z.string().nullable().optional(),
  // Aceita tanto "pbis" (correto) quanto "tasks" (legado) — pelo menos um obrigatório
  pbis: z.array(pbiItemSchema).max(200).optional(),
  tasks: z.array(pbiItemSchema).max(200).optional(),
}).refine(
  (s) => ((s.pbis?.length ?? 0) + (s.tasks?.length ?? 0)) > 0,
  { message: "Sprint deve conter pelo menos 1 PBI (campo 'pbis' ou 'tasks' não pode ficar vazio)" }
);
const subprojetoItemSchema = z.object({
  nome: z.string().min(1).max(300),
  descricao: z.string().nullable().optional(),
  dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  cor: z.string().max(20).nullable().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
  sprints: z.array(sprintItemSchema).max(50).optional(),
});
const reuniaoItemSchema = z.object({
  titulo: z.string().min(1).max(300),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  participantes: z.string().nullable().optional(),
  pauta: z.string().nullable().optional(),
});
const planSchema = z.object({
  subprojetos: z.array(subprojetoItemSchema).min(1).max(30),
  reunioes: z.array(reuniaoItemSchema).max(100).optional(),
  resumo: z.any().optional(),
});

const MODO1_PROMPT = `Você é o Agente Scrum da Arcádia Consult, especialista em planejamento de projetos de ERP e desenvolvimento de software seguindo a metodologia Scrum.

Sua função é analisar o documento e GERAR UM BACKLOG SCRUM COMPLETO orientado a sprints.
Cada sprint DEVE conter um array "pbis" (Product Backlog Items) — são as ATIVIDADES DE BACKLOG que o time vai executar. NUNCA deixe um sprint sem PBIs.

RESPONDA APENAS COM JSON VÁLIDO. Sem texto fora do JSON. Sem markdown. Sem cercas \`\`\`.

Formato exato esperado:
{
  "subprojetos": [
    {
      "nome": "string (fase do projeto, ex: 'Diagnóstico', 'Implementação', 'Go Live')",
      "descricao": "string",
      "dataInicio": "YYYY-MM-DD",
      "dataFim": "YYYY-MM-DD",
      "cor": "#hex",
      "ordem": 0,
      "sprints": [
        {
          "nome": "string (ex: 'Sprint 1 — Levantamento de processos')",
          "dataInicio": "YYYY-MM-DD",
          "dataFim": "YYYY-MM-DD",
          "objetivo": "string (Sprint Goal — o que o time entrega ao final)",
          "pbis": [
            {
              "titulo": "string (ex: 'Levantar fluxo do contas a pagar')",
              "descricao": "string (contexto e escopo do PBI)",
              "criterioAceitacao": "string (o que precisa estar pronto para considerar concluído)",
              "tipo": "feature|bug|improvement|task|support|analysis|documentation|training|meeting",
              "prioridade": "critical|high|medium|low",
              "storyPoints": 5,
              "estimatedHours": 8,
              "status": "backlog",
              "entregavel": "string (artefato que sai do PBI)",
              "responsavel": "string|null"
            }
          ]
        }
      ]
    }
  ],
  "reunioes": [
    {
      "titulo": "string (ex: 'Sprint Planning — Sprint 1')",
      "data": "YYYY-MM-DD",
      "horaInicio": "HH:MM",
      "participantes": "string",
      "pauta": "string"
    }
  ],
  "resumo": {
    "totalSubprojetos": 0,
    "totalSprints": 0,
    "totalPbis": 0,
    "prazoTotal": "string"
  }
}

REGRAS OBRIGATÓRIAS:
1. Cada sprint DEVE ter pelo menos 3 PBIs. Se o documento for raso, infira PBIs realistas baseados no escopo (ex: "Mapear processo X", "Documentar requisito Y", "Configurar módulo Z", "Realizar UAT").
2. PBIs usam tipo + prioridade do enum acima. Use "analysis" para diagnóstico, "feature" para implementação, "documentation" para docs, "training" para capacitação.
3. Story points em escala Fibonacci: 1, 2, 3, 5, 8, 13, 21.
4. Sprints de 2 semanas em sequência cronológica. Reuniões: Planning na segunda da sprint, Review/Retro na sexta da última semana.
5. Use no mínimo 1 subprojeto. Se o documento descrever apenas um projeto sem fases, crie 1 subprojeto chamado "Geral" com sprints e PBIs.
6. Status inicial sempre "backlog".`;

export async function analisarDocumento(opts: {
  tenantId: string;
  fileId: string;
  projectId: string;
}): Promise<{ plan: any; tokensInput: number; tokensOutput: number; aiSource: "tenant" | "platform" }> {
  // 1. Carregar arquivo do banco — exige tenant match
  const [file] = await db.select().from(projectFiles)
    .where(and(eq(projectFiles.id, opts.fileId), eq(projectFiles.projectId, opts.projectId)))
    .limit(1);
  if (!file) throw new Error("Arquivo não encontrado");
  // Tenant check via projeto (project_files podem ter sido criados antes do tenantId, então cruzamos com o projeto)
  const [proj] = await db.select({ id: projects.id, tenantId: projects.tenantId, name: projects.name })
    .from(projects)
    .where(and(eq(projects.id, opts.projectId), eq(projects.tenantId, opts.tenantId))).limit(1);
  if (!proj) throw new Error("Projeto não pertence ao tenant");

  const text = (file.extractedText || "").trim();
  if (!text) {
    throw new Error("Arquivo sem texto extraído. Faça upload de PDF/DOCX/XLSX/CSV ou TXT.");
  }

  // 2. Chamar LLM via orquestrador (Task #48 — cascata `scrum:plan_from_doc`).
  const userMsg = `Projeto atual: ${proj.name}\n\nConteúdo do documento:\n\n${text.slice(0, 40_000)}`;
  const orch = await runWithOrchestration(
    "scrum:plan_from_doc",
    opts.tenantId,
    { sensitivity: "internal" },
    (cb) => callChatLLM(cb, { systemPrompt: MODO1_PROMPT, userPrompt: userMsg, maxTokens: 8192, signal: cb.signal }),
  );
  const txt = orch.data;
  let plan: any;
  try {
    // Tenta limpar fences acidentais
    const clean = txt.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    plan = JSON.parse(clean);
  } catch (err: any) {
    throw new Error("Agente retornou JSON inválido: " + (err?.message || ""));
  }

  return {
    plan,
    tokensInput: orch.tokensIn,
    tokensOutput: orch.tokensOut,
    // Source não é mais exposto pelo orquestrador; mantemos "platform" por compat.
    aiSource: "platform",
  };
}

export async function aplicarPlano(opts: {
  tenantId: string;
  userId: string;
  projectId: string;
  plan: any;
}): Promise<{ subprojetosCriados: number; sprintsCriados: number; tasksCriadas: number; eventosCriados: number }> {
  // Valida estrutura do plano com Zod ANTES de qualquer escrita
  const parsed = planSchema.safeParse(opts.plan);
  if (!parsed.success) {
    throw new Error("Plano inválido: " + parsed.error.errors.map(e => `${e.path.join(".")} ${e.message}`).join("; "));
  }
  const plan = parsed.data;

  // Validar projeto
  const [proj] = await db.select().from(projects)
    .where(and(eq(projects.id, opts.projectId), eq(projects.tenantId, opts.tenantId))).limit(1);
  if (!proj) throw new Error("Projeto não pertence ao tenant");

  // Transação atômica — cria scrum_internal_project, subprojetos, sprints, PBIs e eventos
  return await db.transaction(async (tx) => {
    let subCount = 0, sprintCount = 0, pbiCount = 0, evCount = 0;

    // 1. Garantir scrum_internal_project vinculado ao projeto cliente (IDEMPOTENTE).
    //    Sprints precisam de internalProjectId para aparecerem no módulo Scrum.
    //    Há índice único parcial em scrum_internal_projects.client_project_id;
    //    em chamadas concorrentes, o INSERT pode falhar com unique violation —
    //    nesse caso re-selecionamos o registro existente.
    //    Ordenamos por createdAt asc para escolher determinísticamente o mais antigo.
    const [existing] = await tx.select().from(scrumInternalProjects)
      .where(eq(scrumInternalProjects.clientProjectId, opts.projectId))
      .orderBy(asc(scrumInternalProjects.createdAt))
      .limit(1);

    let internalProj = existing;
    if (!internalProj) {
      try {
        [internalProj] = await tx.insert(scrumInternalProjects).values({
          name: proj.name,
          description: `Projeto Scrum gerado automaticamente para ${proj.name}`,
          clientProjectId: opts.projectId,
          isInternal: 0,
          status: "active",
          createdById: opts.userId,
        }).returning();
      } catch (e: any) {
        // Só engole unique_violation (PG code 23505) — race condition do índice parcial.
        // Qualquer outro erro (FK, NOT NULL, permissão) deve propagar.
        const code = e?.code || e?.cause?.code;
        if (code !== "23505") throw e;
        const [retry] = await tx.select().from(scrumInternalProjects)
          .where(eq(scrumInternalProjects.clientProjectId, opts.projectId))
          .orderBy(asc(scrumInternalProjects.createdAt))
          .limit(1);
        if (!retry) throw e; // unique violation sem registro encontrado é estado anômalo
        internalProj = retry;
      }
    }

    for (let si = 0; si < plan.subprojetos.length; si++) {
      const sp = plan.subprojetos[si];
      const [createdSub] = await tx.insert(subprojects).values({
        projectId: opts.projectId,
        tenantId: opts.tenantId,
        name: sp.nome.slice(0, 300),
        description: sp.descricao || null,
        ordem: typeof sp.ordem === "number" ? sp.ordem : si,
        startDate: sp.dataInicio || null,
        endDate: sp.dataFim || null,
        color: sp.cor || null,
        createdById: opts.userId,
      }).returning();
      subCount++;

      if (sp.sprints) {
        for (const spr of sp.sprints) {
          // 2. Sprint vinculado a internalProjectId E subprojectId
          const [createdSprint] = await tx.insert(scrumSprints).values({
            internalProjectId: internalProj.id,
            subprojectId: createdSub.id,
            name: spr.nome.slice(0, 255),
            goal: spr.objetivo || null,
            startDate: spr.dataInicio ? new Date(spr.dataInicio) : null,
            endDate: spr.dataFim ? new Date(spr.dataFim) : null,
            status: "planning",
            createdById: opts.userId,
          }).returning();
          sprintCount++;

          // 3. PBIs (atividades de backlog) — aceita "pbis" (correto) ou "tasks" (legado)
          const items = spr.pbis || spr.tasks || [];
          for (let pi = 0; pi < items.length; pi++) {
            const it = items[pi];
            const tipo = (it.tipo && (PBI_TYPES as readonly string[]).includes(it.tipo)) ? it.tipo : "feature";
            // Normaliza variantes comuns ('em_andamento'→'em_execucao') antes de inserir
            const status = normalizePbiStatus(it.status);

            await tx.insert(scrumBacklogItems).values({
              tenantId: opts.tenantId,
              internalProjectId: internalProj.id,
              subprojectId: createdSub.id,
              sprintId: createdSprint.id,
              title: it.titulo.slice(0, 500),
              description: it.descricao || null,
              acceptanceCriteria: it.criterioAceitacao || it.entregavel || null,
              type: tipo as any,
              status: status as any,
              priority: mapPriority(it.prioridade),
              storyPoints: typeof it.storyPoints === "number" ? it.storyPoints : null,
              estimatedHours: typeof it.estimatedHours === "number" ? it.estimatedHours : null,
              originType: "manual",
              originProjectId: opts.projectId,
              dueDate: spr.dataFim ? new Date(spr.dataFim) : null,
              backlogOrder: pi,
              sprintOrder: pi,
              createdById: opts.userId,
            });
            pbiCount++;
          }
        }
      }
    }

    if (plan.reunioes) {
      for (const r of plan.reunioes) {
        await tx.insert(projectCalendarEvents).values({
          projectId: opts.projectId,
          tenantId: opts.tenantId,
          titulo: r.titulo.slice(0, 300),
          descricao: r.pauta || null,
          dataInicio: r.data,
          horaInicio: r.horaInicio || null,
          tipo: "reuniao_sprint",
          participantes: r.participantes || null,
          createdById: opts.userId,
        });
        evCount++;
      }
    }

    return {
      subprojetosCriados: subCount,
      sprintsCriados: sprintCount,
      pbisCriados: pbiCount,
      tasksCriadas: pbiCount, // alias retrocompatível pra UI antiga
      eventosCriados: evCount,
      internalProjectId: internalProj.id,
    };
  });
}

// ─── Modo 2: Chat dentro da tarefa ──────────────────────────────────────────

export async function buildTaskSystemPrompt(opts: {
  tenantId: string;
  taskId: string;
}): Promise<{ system: string; task: any; project: any }> {
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, opts.taskId), eq(tasks.tenantId, opts.tenantId))).limit(1);
  if (!task) throw new Error("Tarefa não encontrada");

  const [project] = await db.select({ id: projects.id, name: projects.name })
    .from(projects).where(eq(projects.id, task.projectId)).limit(1);

  let subprojectName = "—";
  if (task.subprojectId) {
    const [sp] = await db.select({ name: subprojects.name }).from(subprojects)
      .where(eq(subprojects.id, task.subprojectId)).limit(1);
    if (sp) subprojectName = sp.name;
  }

  // Arquivos vinculados à task
  const taskFiles = await db.select({ name: projectFiles.fileName, originalName: projectFiles.originalName })
    .from(projectFiles).where(eq(projectFiles.taskId, opts.taskId)).limit(20);
  const filesList = taskFiles.length
    ? taskFiles.map((f) => `- ${f.originalName || f.name}`).join("\n")
    : "(nenhum arquivo vinculado a esta tarefa)";

  const system = `Você é o Agente Scrum da Arcádia Consult.
Está auxiliando a execução da seguinte tarefa:

Projeto: ${project?.name || "—"}
Subprojeto: ${subprojectName}
Tarefa: ${task.title}
Descrição: ${task.description || "(sem descrição)"}
Entregável esperado: ${task.entregavel || "(não definido)"}
Status atual: ${task.status}
Arquivos disponíveis:
${filesList}

Sua função: auxiliar ativamente na execução desta tarefa. Responda dúvidas, analise os arquivos se solicitado, sugira como executar, identifique riscos e gere documentação. Quando identificar um novo requisito que não está coberto, pergunte ao consultor se deseja criar uma nova tarefa.

Seja direto, objetivo e use português brasileiro.`;

  return { system, task, project };
}

export async function sendTaskMessage(opts: {
  tenantId: string;
  userId: string;
  taskId: string;
  sessionId: string;
  userMessage: string;
}): Promise<{ assistantContent: string; tokensInput: number; tokensOutput: number; aiSource: "tenant" | "platform" }> {
  // Validação combinada: sessão precisa pertencer à tarefa E ao tenant
  const [session] = await db.select().from(taskAgentSessions)
    .where(and(
      eq(taskAgentSessions.id, opts.sessionId),
      eq(taskAgentSessions.taskId, opts.taskId),
      eq(taskAgentSessions.tenantId, opts.tenantId),
    )).limit(1);
  if (!session) throw new Error("Sessão não encontrada para esta tarefa");

  // Persistir mensagem do usuário
  await db.insert(superAgentMessages).values({
    sessionId: null,
    taskSessionId: opts.sessionId,
    role: "user",
    content: opts.userMessage,
  });

  // Construir contexto da task
  const { system } = await buildTaskSystemPrompt({ tenantId: opts.tenantId, taskId: session.taskId });

  // Histórico
  const prior = await db.select().from(superAgentMessages)
    .where(eq(superAgentMessages.taskSessionId, opts.sessionId))
    .orderBy(asc(superAgentMessages.createdAt));

  const messages: any[] = [];
  for (const m of prior) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant" && m.content) messages.push({ role: "assistant", content: m.content });
  }

  // Task #48 — chat task via orquestrador (`scrum:task_chat`, cheap chain).
  // Conversamos como user-prompt único com histórico embutido — callChatLLM
  // não suporta multi-turn cross-provider; concatenamos.
  const conversation = messages.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
  const orch = await runWithOrchestration(
    "scrum:task_chat",
    opts.tenantId,
    { sensitivity: "internal" },
    (cb) => callChatLLM(cb, { systemPrompt: system, userPrompt: conversation, maxTokens: 4096, signal: cb.signal }),
  );
  const txt = orch.data.trim();

  await db.insert(superAgentMessages).values({
    sessionId: null,
    taskSessionId: opts.sessionId,
    role: "assistant",
    content: txt,
    tokensInput: orch.tokensIn || null,
    tokensOutput: orch.tokensOut || null,
  });

  // Atualiza updatedAt da sessão
  await db.update(taskAgentSessions)
    .set({ updatedAt: new Date() })
    .where(eq(taskAgentSessions.id, opts.sessionId));

  return {
    assistantContent: txt,
    tokensInput: orch.tokensIn,
    tokensOutput: orch.tokensOut,
    aiSource: "platform" as const,
  };
}
