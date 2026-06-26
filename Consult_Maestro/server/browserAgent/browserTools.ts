/**
 * browserTools — registra as tools de browser automation no toolRegistry MCP.
 *
 * Com isso o Super Agente (e qualquer caller MCP) ganha os "poderes Hermes":
 * navegar, ler a árvore de acessibilidade, clicar/digitar por ref, fazer login
 * com credencial do cofre (sem expor a senha ao LLM), persistir sessão e pedir
 * aprovação humana antes de ações irreversíveis.
 *
 * Regra do projeto: tools chamam serviços existentes; segredos nunca passam
 * pelo contexto do LLM (browser_fill_secret injeta a senha direto no campo).
 */
import { z } from "zod";
import { toolRegistry, type ToolContext } from "../mcp/toolRegistry";
import * as driver from "./playwrightDriver";
import { getCredentialWithSecret, markLogin } from "./credentialVault";
import { saveBrowserState, loadBrowserState } from "./sessionStore";
import { requestApproval } from "./hitlApproval";
import { saveSkill, findSkill, executeSkill, isAllowedSkillTool } from "./skillsLibrary";

let registered = false;

/** Resolve um taskId estável para a sessão de browser a partir do contexto. */
function taskIdFor(ctx: ToolContext): string {
  return (
    ctx.meta?.taskId ||
    ctx.meta?.sessionId ||
    `${ctx.tenantId}:default`
  );
}

// Credencial "ativa" por sessão de browser — permite fill_secret/save_session
// sem o LLM precisar repassar o id (e mantém o segredo fora do prompt).
const activeCredential = new Map<
  string,
  { tenantId: string; credentialId: string; system: string }
>();

const navSchema = z.object({ url: z.string().url("url inválida") });
const refSchema = z.object({ ref: z.string().min(1) });
const typeSchema = z.object({
  ref: z.string().min(1),
  text: z.string(),
  submit: z.boolean().optional(),
});
const selectSchema = z.object({ ref: z.string().min(1), value: z.string() });
const extractSchema = z.object({ maxChars: z.number().int().min(100).max(20000).optional() });
const loginSchema = z.object({ credentialId: z.string().min(1) });
const fillSecretSchema = z.object({
  ref: z.string().min(1),
  field: z.enum(["password", "token"]).optional(),
});
const approvalSchema = z.object({
  actionDescription: z.string().min(3),
  actionPayload: z.record(z.any()).optional(),
});
const stepSchema = z.object({
  tool: z
    .string()
    .min(1)
    .refine(isAllowedSkillTool, {
      message: "Apenas tools de browser (browser_*) ou request_approval são permitidas em skills.",
    }),
  input: z.record(z.any()).optional(),
  label: z.string().optional(),
});
const saveSkillSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  systemSlug: z.string().optional(),
  steps: z.array(stepSchema).min(1),
});
const runSkillSchema = z.object({
  skillName: z.string().min(1),
  taskId: z.string().min(1),
});

export function registerBrowserTools(): void {
  if (registered) return;
  registered = true;

  toolRegistry.register({
    name: "browser_navigate",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Abre uma URL em um navegador headless controlado pelo agente e retorna título/URL final. Use como primeiro passo para operar sistemas web (ERP, portais, SEFAZ). Depois chame browser_snapshot para ver os elementos da página.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "URL completa (https://...)." } },
      required: ["url"],
    },
    inputValidator: navSchema,
    handler: async (input: z.infer<typeof navSchema>, ctx) => {
      return await driver.navigate(taskIdFor(ctx), input.url);
    },
  });

  toolRegistry.register({
    name: "browser_snapshot",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Captura a árvore de acessibilidade da página atual como texto, com refs @e1, @e2... em cada elemento interativo. Use para 'enxergar' a tela antes de clicar ou digitar. Sempre rode um snapshot novo após navegar ou clicar, pois os refs mudam.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_input, ctx) => {
      return await driver.snapshot(taskIdFor(ctx));
    },
  });

  toolRegistry.register({
    name: "browser_click",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Clica em um elemento identificado pelo seu ref (ex.: '@e45') obtido no último browser_snapshot. Para ações irreversíveis (emitir nota, enviar pagamento), peça aprovação humana antes via request_approval.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: "Ref do elemento, ex.: @e45." } },
      required: ["ref"],
    },
    inputValidator: refSchema,
    handler: async (input: z.infer<typeof refSchema>, ctx) => {
      return await driver.click(taskIdFor(ctx), input.ref);
    },
  });

  toolRegistry.register({
    name: "browser_type",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Digita um texto em um campo identificado por ref (do último snapshot). Use submit=true para pressionar Enter após digitar. NÃO use para senhas — para isso use browser_fill_secret, que não expõe o segredo.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref do campo, ex.: @e12." },
        text: { type: "string", description: "Texto a digitar." },
        submit: { type: "boolean", description: "Pressionar Enter ao final. Opcional." },
      },
      required: ["ref", "text"],
    },
    inputValidator: typeSchema,
    handler: async (input: z.infer<typeof typeSchema>, ctx) => {
      return await driver.type(taskIdFor(ctx), input.ref, input.text, input.submit);
    },
  });

  toolRegistry.register({
    name: "browser_select",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Seleciona uma opção em um dropdown <select> identificado por ref (do último snapshot). value é o texto ou value da opção.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref do select, ex.: @e20." },
        value: { type: "string", description: "Valor/rótulo da opção." },
      },
      required: ["ref", "value"],
    },
    inputValidator: selectSchema,
    handler: async (input: z.infer<typeof selectSchema>, ctx) => {
      return await driver.select(taskIdFor(ctx), input.ref, input.value);
    },
  });

  toolRegistry.register({
    name: "browser_extract",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Extrai o conteúdo textual visível da página atual (innerText). Use para ler resultados, números de nota emitida, mensagens de confirmação, tabelas, etc.",
    inputSchema: {
      type: "object",
      properties: {
        maxChars: { type: "number", description: "Limite de caracteres (100-20000). Padrão 8000." },
      },
    },
    inputValidator: extractSchema,
    handler: async (input: z.infer<typeof extractSchema>, ctx) => {
      return await driver.extract(taskIdFor(ctx), input.maxChars);
    },
  });

  // Login com credencial do cofre. Restaura sessão salva se houver; senão
  // navega para a URL de login e devolve o snapshot para o agente preencher.
  toolRegistry.register({
    name: "browser_login",
    module: "browser",
    requiresConfirmation: true,
    description:
      "Inicia login em um sistema externo usando uma credencial do cofre (credentialId). Restaura cookies salvos se existirem; caso contrário abre a URL de login e retorna o snapshot. Em seguida use browser_type para o usuário, browser_fill_secret para a senha e browser_click em 'Entrar'. Depois confirme com browser_save_session.",
    inputSchema: {
      type: "object",
      properties: {
        credentialId: { type: "string", description: "ID da credencial cadastrada no cofre." },
      },
      required: ["credentialId"],
    },
    inputValidator: loginSchema,
    handler: async (input: z.infer<typeof loginSchema>, ctx) => {
      const found = await getCredentialWithSecret(ctx.tenantId, input.credentialId);
      if (!found) return { error: "Credencial não encontrada neste tenant." };
      const { credential } = found;
      const taskId = taskIdFor(ctx);
      activeCredential.set(taskId, {
        tenantId: ctx.tenantId,
        credentialId: credential.id,
        system: credential.system,
      });
      const saved = await loadBrowserState(ctx.tenantId, credential.system);
      await driver.closeSession(taskId);
      if (credential.url) {
        await driver.navigate(taskId, credential.url, saved || undefined);
      } else if (saved) {
        // sem URL salva apenas restaura o contexto
        await driver.navigate(taskId, "about:blank", saved);
      }
      const snap = credential.url ? await driver.snapshot(taskId) : { snapshot: "" };
      return {
        credential: {
          name: credential.name,
          system: credential.system,
          url: credential.url,
          username: credential.username,
        },
        restoredSession: !!saved,
        snapshot: snap.snapshot,
        hint: saved
          ? "Sessão restaurada. Verifique se já está logado com browser_snapshot/browser_extract antes de logar de novo."
          : "Preencha o usuário com browser_type, a senha com browser_fill_secret (field='password') e clique em Entrar. Depois chame browser_save_session.",
      };
    },
  });

  // Injeta o segredo guardado no campo, sem expor o valor ao LLM.
  toolRegistry.register({
    name: "browser_fill_secret",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Preenche a senha (ou token) da credencial ativa (definida por browser_login) num campo identificado por ref. O valor do segredo NUNCA é exposto ao agente. field='password' (padrão) ou 'token'.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref do campo de senha, ex.: @e13." },
        field: { type: "string", enum: ["password", "token"], description: "Padrão: password." },
      },
      required: ["ref"],
    },
    inputValidator: fillSecretSchema,
    handler: async (input: z.infer<typeof fillSecretSchema>, ctx) => {
      const taskId = taskIdFor(ctx);
      const ac = activeCredential.get(taskId);
      if (!ac) return { error: "Nenhuma credencial ativa. Use browser_login primeiro." };
      const found = await getCredentialWithSecret(ac.tenantId, ac.credentialId);
      if (!found) return { error: "Credencial ativa não encontrada." };
      const field = input.field ?? "password";
      const value = field === "token" ? found.secret.token : found.secret.password;
      if (!value) return { error: `Credencial não tem '${field}' cadastrado.` };
      const r = await driver.type(taskId, input.ref, value);
      if ((r as any)?.error) return r;
      return { ok: true, note: `Campo '${field}' preenchido (valor não exposto).` };
    },
  });

  // Persiste cookies/state após login bem-sucedido (reuso futuro).
  toolRegistry.register({
    name: "browser_save_session",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Salva os cookies/sessão atuais da credencial ativa para reuso futuro (login uma vez, reaproveita depois). Chame após confirmar que o login deu certo.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_input, ctx) => {
      const taskId = taskIdFor(ctx);
      const ac = activeCredential.get(taskId);
      if (!ac) return { error: "Nenhuma credencial ativa. Use browser_login primeiro." };
      const state = await driver.getStorageState(taskId);
      if (!state) return { error: "Sem sessão de browser ativa para salvar." };
      await saveBrowserState(ac.tenantId, ac.system, state, ctx.meta?.sessionId ?? null);
      await markLogin(ac.tenantId, ac.credentialId);
      return { ok: true, system: ac.system, note: "Sessão salva e criptografada." };
    },
  });

  // HITL — pede aprovação humana antes de uma ação irreversível.
  toolRegistry.register({
    name: "request_approval",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Cria um pedido de aprovação humana antes de executar uma ação irreversível (ex.: 'Emitir NF-e de R$ 8.400 para Cortiart'). Retorna um approvalId com status 'pending'. PARE e peça ao usuário para aprovar em 'Escritório Agente → Aprovações'; só prossiga quando ele confirmar.",
    inputSchema: {
      type: "object",
      properties: {
        actionDescription: {
          type: "string",
          description: "Descrição clara da ação que precisa de aprovação.",
        },
        actionPayload: {
          type: "object",
          description: "Dados estruturados da ação (opcional).",
        },
      },
      required: ["actionDescription"],
    },
    inputValidator: approvalSchema,
    handler: async (input: z.infer<typeof approvalSchema>, ctx) => {
      const row = await requestApproval(ctx.tenantId, {
        actionDescription: input.actionDescription,
        actionPayload: input.actionPayload ?? {},
        agentSessionId: ctx.meta?.sessionId ?? null,
        taskId: ctx.meta?.taskId ?? null,
        requestedBy: ctx.userId ?? null,
      });
      return {
        status: "pending",
        approvalId: row.id,
        message:
          "Aprovação solicitada. Peça ao usuário para aprovar em 'Escritório Agente → Aprovações' e então me peça para continuar.",
      };
    },
  });

  // Skills — salva uma sequência de ações como skill reutilizável.
  toolRegistry.register({
    name: "browser_save_skill",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Salva uma sequência de ações de browser como uma skill reutilizável. Use ao FINAL de uma tarefa bem-sucedida para que ela possa ser reexecutada depois (manualmente, por agendamento ou via browser_run_skill). Cada step tem { tool, input, label? }.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Identificador curto/único da skill (ex.: 'emitir_nfe_protheus')." },
        title: { type: "string", description: "Título legível da skill." },
        description: { type: "string", description: "O que a skill faz." },
        systemSlug: { type: "string", description: "Sistema alvo (ex.: 'totvs_protheus')." },
        steps: {
          type: "array",
          description: "Passos da skill: [{ tool, input, label? }].",
          items: {
            type: "object",
            properties: {
              tool: { type: "string" },
              input: { type: "object" },
              label: { type: "string" },
            },
            required: ["tool"],
          },
        },
      },
      required: ["name", "title", "steps"],
    },
    inputValidator: saveSkillSchema,
    handler: async (input: z.infer<typeof saveSkillSchema>, ctx) => {
      const skill = await saveSkill(ctx.tenantId, {
        name: input.name,
        title: input.title,
        description: input.description,
        systemSlug: input.systemSlug,
        steps: input.steps,
        scope: "tenant",
      });
      return { ok: true, skillId: skill.id, name: skill.name, steps: (skill.steps ?? []).length };
    },
  });

  // Skills — executa uma skill salva pelo nome.
  toolRegistry.register({
    name: "browser_run_skill",
    module: "browser",
    requiresConfirmation: false,
    description:
      "Executa uma skill de browser salva, pelo nome. Roda cada passo na ordem, compartilhando a mesma sessão de browser. Use quando já existe uma skill para a tarefa pedida.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: { type: "string", description: "Nome da skill a executar." },
        taskId: { type: "string", description: "Id da sessão de browser para os passos." },
      },
      required: ["skillName", "taskId"],
    },
    inputValidator: runSkillSchema,
    handler: async (input: z.infer<typeof runSkillSchema>, ctx) => {
      const skill = await findSkill(ctx.tenantId, input.skillName);
      if (!skill) return { error: "Skill não encontrada: " + input.skillName };
      return await executeSkill(skill.id, input.taskId, ctx);
    },
  });
}
