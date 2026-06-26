import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for pipeline tests");
}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-1234567890abcdef";

vi.mock("../../server/portableAuth", () => ({
  isAuthenticated: (req: any, res: any, next: any) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  },
}));

vi.mock("../../server/tenantContext", () => ({
  requireTenant: (req: any, res: any, next: any) => {
    if (!req.tenantId && !req.isSuperadmin) {
      return res.status(403).json({ message: "Tenant context required" });
    }
    next();
  },
  requireTenantAdmin: (req: any, res: any, next: any) => {
    if (req.isSuperadmin) return next();
    if (req.tenantRole === "admin" || req.tenantRole === "superadmin") return next();
    return res.status(403).json({ message: "Tenant admin access required" });
  },
}));

// Mock the agent skills so background side-effects don't pollute the DB or
// require external API calls (Anthropic / OpenAI / object storage sidecar).
vi.mock("../../server/societario/pipeline/skills", () => ({
  SKILLS: {} as Record<string, any>,
  skillForTarefaKey: () => null,
  dispatchSkill: vi.fn(async () => ({ ok: true, message: "stub" })),
  runLembretesDiarios: vi.fn(async () => ({ ok: true, processados: 0 })),
}));

// Mock object storage so upload-url path never touches the GCS sidecar even
// indirectly (we only assert the 409 readonly guard fires before storage).
// IMPORTANT: vi.mock factories are hoisted to the top of the file, BEFORE any
// top-level `const` is initialized. Use vi.hoisted so the spy is defined by
// the time the factory closure runs.
const uploadUrlSpy = vi.hoisted(() =>
  vi.fn(async () => "https://example.invalid/upload/test-object"),
);
vi.mock("../../server/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityUploadURL() {
      return uploadUrlSpy();
    }
    normalizeObjectEntityPath(_url: string) {
      return "/objects/test-object";
    }
  },
}));

// Imports that depend on mocked modules MUST come after the vi.mock block.
const { db } = await import("../../server/db");
const schema = await import("../../shared/schema");
const { registerPipelineSocietarioRoutes } = await import(
  "../../server/societario/pipeline/routes"
);
const helpersMod = await import("../helpers/testApp");
const { createTestApp } = helpersMod;
type TestAuthState = import("../helpers/testApp").TestAuthState;
const { eq, inArray } = await import("drizzle-orm");

// ───────────────────────── Test fixture identifiers ─────────────────────────
const RUN_ID = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const tenantA = `tenant-A-${RUN_ID}`;
const tenantB = `tenant-B-${RUN_ID}`;
const userA = `user-A-${RUN_ID}`;
const userB = `user-B-${RUN_ID}`;

// Mutable auth state read by the test app middleware before each request.
const authState: TestAuthState = {
  tenantId: tenantA,
  userId: userA,
  tenantRole: "admin",
};

let app: Express;

// Track inserted IDs for cleanup
const created = {
  pipelineConfigIds: new Set<string>(),
  sociedadeIds: new Set<string>(),
  pessoaIds: new Set<string>(),
};

async function insertTenant(id: string, slug: string, name: string) {
  await db
    .insert(schema.tenants)
    .values({ id, slug, name, plan: "free", status: "active", isActive: 1 })
    .onConflictDoNothing();
}

async function insertUser(id: string, email: string) {
  await db
    .insert(schema.users)
    .values({ id, email, firstName: "Test", lastName: id, role: "admin" } as any)
    .onConflictDoNothing();
}

async function insertSociedade(tenantId: string, razaoSocial: string) {
  const [row] = await db
    .insert(schema.sociedades)
    .values({
      tenantId,
      razaoSocial,
      nomeFantasia: razaoSocial,
      naturezaJuridica: "ltda",
      regimeTributario: "simples",
      status: "ativa",
    })
    .returning({ id: schema.sociedades.id });
  created.sociedadeIds.add(row.id);
  return row.id;
}

async function insertPipelineConfig(tenantId: string, userId: string) {
  const colunas = [
    { id: "backlog", nome: "Backlog", ordem: 0, cor: "bg-slate-500", autoAdvance: false },
    { id: "em_analise", nome: "Em Análise", ordem: 1, cor: "bg-blue-500", autoAdvance: false },
    { id: "concluido", nome: "Concluído", ordem: 2, cor: "bg-emerald-500", autoAdvance: false },
  ];
  const [cfg] = await db
    .insert(schema.pipelineConfigs)
    .values({
      tenantId,
      nome: `Test ${RUN_ID}`,
      tipoProcesso: `test_${RUN_ID}`,
      colunas,
      regrasTransicao: {},
      isDefault: false,
      isActive: true,
      createdBy: userId,
    })
    .returning({ id: schema.pipelineConfigs.id });
  created.pipelineConfigIds.add(cfg.id);
  return { configId: cfg.id, tipoProcesso: `test_${RUN_ID}` };
}

async function insertChecklistItem(opts: {
  tenantId: string;
  configId: string;
  etapa: string;
  ordem: number;
  titulo: string;
}) {
  const [row] = await db
    .insert(schema.pipelineChecklistItems)
    .values({
      tenantId: opts.tenantId,
      pipelineConfigId: opts.configId,
      etapa: opts.etapa,
      ordem: opts.ordem,
      titulo: opts.titulo,
      executorType: "analista",
      isRequired: false,
      bloqueiaAvanco: false,
      tipo: "checkbox",
      tarefaKey: `${opts.titulo.replace(/\W+/g, "_")}_${opts.ordem}`,
    })
    .returning({ id: schema.pipelineChecklistItems.id });
  return row.id;
}

async function insertProcesso(opts: {
  tenantId: string;
  sociedadeId: string;
  configId: string;
  tipoProcesso: string;
  status?: "ativo" | "concluido";
  colunaAtual?: string;
  clientePessoaId?: string | null;
  userId: string;
}) {
  const processNumber = `SOC-TEST-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const [row] = await db
    .insert(schema.processosSocietarios)
    .values({
      tenantId: opts.tenantId,
      processNumber,
      sociedadeId: opts.sociedadeId,
      pipelineConfigId: opts.configId,
      tipoProcesso: opts.tipoProcesso,
      titulo: `Processo ${RUN_ID}`,
      colunaAtual: opts.colunaAtual ?? "backlog",
      modoOperacao: "manual",
      status: opts.status ?? "ativo",
      prioridade: "media",
      analistaResponsavelId: opts.userId,
      solicitanteId: opts.userId,
      clientePessoaId: opts.clientePessoaId ?? null,
      clienteContatoPreferido: "inapp",
      createdBy: opts.userId,
    })
    .returning();
  return row;
}

async function insertPessoaCliente(tenantId: string, papel: "cliente" | "fornecedor" = "cliente") {
  const cnpj = `${Date.now()}${Math.floor(Math.random() * 1e6)}`.slice(0, 14);
  const [p] = await db
    .insert(schema.pessoas)
    .values({
      tenantId,
      tipoPessoa: "PJ",
      nomeFantasia: `Cliente ${RUN_ID}`,
      razaoSocial: `Cliente ${RUN_ID} LTDA`,
      cnpjCpf: cnpj,
      status: "ativo",
    })
    .returning({ id: schema.pessoas.id });
  created.pessoaIds.add(p.id);
  await db.insert(schema.pessoaPapeis).values({
    pessoaId: p.id,
    tenantId,
    tipoPapel: papel,
    status: "ativo",
  });
  return p.id;
}

beforeAll(async () => {
  await insertTenant(tenantA, `tenant-a-${RUN_ID}`, `Tenant A ${RUN_ID}`);
  await insertTenant(tenantB, `tenant-b-${RUN_ID}`, `Tenant B ${RUN_ID}`);
  await insertUser(userA, `user-a-${RUN_ID}@test.local`);
  await insertUser(userB, `user-b-${RUN_ID}@test.local`);

  app = createTestApp(() => authState, registerPipelineSocietarioRoutes);
});

afterAll(async () => {
  // Order matters: remove dependents first.
  try {
    if (created.pipelineConfigIds.size > 0) {
      const ids = Array.from(created.pipelineConfigIds);
      await db.delete(schema.processoMovimentacoes).where(
        inArray(
          schema.processoMovimentacoes.processoId,
          db
            .select({ id: schema.processosSocietarios.id })
            .from(schema.processosSocietarios)
            .where(inArray(schema.processosSocietarios.pipelineConfigId, ids)),
        ),
      );
      await db.delete(schema.processoTarefas).where(
        inArray(
          schema.processoTarefas.processoId,
          db
            .select({ id: schema.processosSocietarios.id })
            .from(schema.processosSocietarios)
            .where(inArray(schema.processosSocietarios.pipelineConfigId, ids)),
        ),
      );
      await db
        .delete(schema.processosSocietarios)
        .where(inArray(schema.processosSocietarios.pipelineConfigId, ids));
      await db
        .delete(schema.pipelineChecklistItems)
        .where(inArray(schema.pipelineChecklistItems.pipelineConfigId, ids));
      await db.delete(schema.pipelineConfigs).where(inArray(schema.pipelineConfigs.id, ids));
    }
    if (created.sociedadeIds.size > 0) {
      await db
        .delete(schema.sociedades)
        .where(inArray(schema.sociedades.id, Array.from(created.sociedadeIds)));
    }
    if (created.pessoaIds.size > 0) {
      const pids = Array.from(created.pessoaIds);
      await db.delete(schema.pessoaPapeis).where(inArray(schema.pessoaPapeis.pessoaId, pids));
      await db.delete(schema.pessoas).where(inArray(schema.pessoas.id, pids));
    }
    await db.delete(schema.users).where(inArray(schema.users.id, [userA, userB]));
    await db.delete(schema.tenants).where(inArray(schema.tenants.id, [tenantA, tenantB]));
  } catch (e) {
    console.error("Cleanup error (non-fatal):", e);
  }
});

// ─────────────────────────────────── Tests ──────────────────────────────────

describe("Pipeline Societário — readonly de processo concluído", () => {
  it("PATCH /processos/:id em processo concluído retorna 409 (somente leitura)", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} concluido`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "concluido",
      colunaAtual: "concluido",
      userId: userA,
    });

    const res = await request(app)
      .patch(`/api/societario/pipeline/processos/${proc.id}`)
      .send({ titulo: "Novo título proibido" });

    expect(res.status).toBe(409);
    expect(res.body?.message).toMatch(/somente leitura|readonly/i);

    // DB state must be unchanged.
    const [persisted] = await db
      .select()
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.id, proc.id));
    expect(persisted.titulo).toBe(proc.titulo);
    expect(persisted.status).toBe("concluido");
    expect(persisted.colunaAtual).toBe("concluido");
  });

  it("PATCH /processos/:id permite reabertura concluido → ativo", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} reabertura`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "concluido",
      colunaAtual: "concluido",
      userId: userA,
    });

    const res = await request(app)
      .patch(`/api/societario/pipeline/processos/${proc.id}`)
      .send({ status: "ativo" });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe("ativo");
    expect(res.body?.dataConclusao).toBeNull();

    // DB state must reflect reabertura.
    const [persisted] = await db
      .select()
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.id, proc.id));
    expect(persisted.status).toBe("ativo");
    expect(persisted.dataConclusao).toBeNull();
  });

  it("PATCH /processos/:id/coluna em processo concluído retorna 409", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} mover-conc`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "concluido",
      colunaAtual: "concluido",
      userId: userA,
    });

    const res = await request(app)
      .patch(`/api/societario/pipeline/processos/${proc.id}/coluna`)
      .send({ colunaPara: "em_analise", motivo: "tentativa" });

    expect(res.status).toBe(409);
    expect(res.body?.message).toMatch(/somente leitura/i);

    // DB state unchanged.
    const [persisted] = await db
      .select()
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.id, proc.id));
    expect(persisted.colunaAtual).toBe("concluido");
    expect(persisted.status).toBe("concluido");
    const movs = await db
      .select()
      .from(schema.processoMovimentacoes)
      .where(eq(schema.processoMovimentacoes.processoId, proc.id));
    expect(movs.length).toBe(0);
  });

  it("POST /upload-url em processo concluído retorna 409", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} upload-conc`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "concluido",
      colunaAtual: "concluido",
      userId: userA,
    });

    // Tarefa de upload qualquer (não importa que esteja anexada — o guard 409 retorna antes
    // de validar tipo). Usamos um id sintético para garantir que a checagem de status acontece primeiro.
    const fakeTarefaId = "00000000-0000-0000-0000-000000000000";
    uploadUrlSpy.mockClear();
    const res = await request(app).post(
      `/api/societario/pipeline/processos/${proc.id}/tarefas/${fakeTarefaId}/upload-url`,
    );

    expect(res.status).toBe(409);
    expect(res.body?.message).toMatch(/concluído.*somente leitura/i);
    // O guard 409 deve disparar ANTES de qualquer chamada ao object storage.
    expect(uploadUrlSpy).not.toHaveBeenCalled();
  });
});

describe("Pipeline Societário — TOCTOU em PATCH /coluna", () => {
  it("N movimentos concorrentes no mesmo processo: exatamente 1 vence, audit registra 1 mov", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} race`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "ativo",
      colunaAtual: "backlog",
      userId: userA,
    });

    // Disparamos N movimentos em paralelo (todos backlog → em_analise).
    // O UPDATE condicional `WHERE colunaAtual = 'backlog' AND status != 'concluido'`
    // garante que apenas o vencedor da corrida muda o estado.
    // Os perdedores recebem 409 (UPDATE sem linhas) OU 400 (caso já tenham lido o
    // estado pós-vitória e enviado colunaPara == colunaAtual).
    const N = 6;
    const reqs = Array.from({ length: N }, (_, i) =>
      request(app)
        .patch(`/api/societario/pipeline/processos/${proc.id}/coluna`)
        .send({ colunaPara: "em_analise", motivo: `race-${i}` }),
    );
    const results = await Promise.all(reqs);
    const successes = results.filter((r) => r.status === 200);
    const losers = results.filter((r) => r.status === 409 || r.status === 400);
    expect(successes.length).toBe(1);
    expect(successes.length + losers.length).toBe(N);
    expect(successes[0].body?.colunaAtual).toBe("em_analise");

    // Garantia chave do guard TOCTOU: NUNCA mais de uma movimentação registrada,
    // mesmo com várias tentativas paralelas chegando ao mesmo tempo.
    const movs = await db
      .select()
      .from(schema.processoMovimentacoes)
      .where(eq(schema.processoMovimentacoes.processoId, proc.id));
    const moves = movs.filter(
      (m) => m.colunaDe === "backlog" && m.colunaPara === "em_analise",
    );
    expect(moves.length).toBe(1);

    // Há também a movimentação de criação inicial (null → backlog), inserida pelo POST /processos.
    // Nosso fixture insere o processo direto no DB, sem essa criação, então só esperamos a 1 acima.
    expect(movs.length).toBe(1);

    // E o processo deve estar em em_analise exatamente uma vez (atômico).
    const [persisted] = await db
      .select()
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.id, proc.id));
    expect(persisted.colunaAtual).toBe("em_analise");
    expect(persisted.status).toBe("ativo");
  });
});

describe("Pipeline Societário — tenant isolation de clientePessoaId", () => {
  it("POST /processos com clientePessoaId de outro tenant retorna 400", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} cli-other`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    // Cliente pertence a tenantB; tentar usá-lo a partir do tenantA deve falhar.
    const pessoaIdOutroTenant = await insertPessoaCliente(tenantB, "cliente");

    const res = await request(app)
      .post("/api/societario/pipeline/processos")
      .send({
        titulo: "Processo cross-tenant",
        sociedadeId,
        pipelineConfigId: configId,
        tipoProcesso,
        clientePessoaId: pessoaIdOutroTenant,
      });

    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/Pessoa cliente inválida|não pertence/i);

    // Nenhum processo deve ter sido criado nessa config.
    const procs = await db
      .select({ id: schema.processosSocietarios.id })
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.pipelineConfigId, configId));
    expect(procs.length).toBe(0);
  });

  it("PATCH /processos/:id com clientePessoaId de outro tenant retorna 400", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} patch-cli-other`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso,
      status: "ativo",
      colunaAtual: "backlog",
      userId: userA,
    });
    const pessoaIdOutroTenant = await insertPessoaCliente(tenantB, "cliente");

    const res = await request(app)
      .patch(`/api/societario/pipeline/processos/${proc.id}`)
      .send({ clientePessoaId: pessoaIdOutroTenant });

    expect(res.status).toBe(400);
    expect(res.body?.message).toMatch(/Pessoa cliente inválida|não pertence/i);

    // O clientePessoaId do processo deve continuar null no banco.
    const [persisted] = await db
      .select()
      .from(schema.processosSocietarios)
      .where(eq(schema.processosSocietarios.id, proc.id));
    expect(persisted.clientePessoaId).toBeNull();
  });

  it("POST /processos aceita clientePessoaId do próprio tenant (papel ativo cliente)", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} cli-ok`);
    const { configId, tipoProcesso } = await insertPipelineConfig(tenantA, userA);
    const pessoaId = await insertPessoaCliente(tenantA, "cliente");

    const res = await request(app)
      .post("/api/societario/pipeline/processos")
      .send({
        titulo: "Processo cliente válido",
        sociedadeId,
        pipelineConfigId: configId,
        tipoProcesso,
        clientePessoaId: pessoaId,
      });

    expect(res.status).toBe(201);
    expect(res.body?.clientePessoaId).toBe(pessoaId);
  });
});

describe("Pipeline Societário — DELETE checklist item bloqueia se há tarefas vinculadas", () => {
  it("retorna 409 quando há processo_tarefas vinculadas e 200 quando não há", async () => {
    authState.tenantId = tenantA;
    authState.userId = userA;
    authState.tenantRole = "admin";

    const { configId } = await insertPipelineConfig(tenantA, userA);

    // Item A: ficará SEM tarefas vinculadas → DELETE deve devolver 200.
    const itemAId = await insertChecklistItem({
      tenantId: tenantA,
      configId,
      etapa: "backlog",
      ordem: 0,
      titulo: `Item A ${RUN_ID}`,
    });
    // Item B: vamos criar um processo e materializar uma tarefa apontando para ele,
    // simulando o caminho do POST /processos.
    const itemBId = await insertChecklistItem({
      tenantId: tenantA,
      configId,
      etapa: "backlog",
      ordem: 1,
      titulo: `Item B ${RUN_ID}`,
    });

    const sociedadeId = await insertSociedade(tenantA, `Soc A ${RUN_ID} del-item`);
    const proc = await insertProcesso({
      tenantId: tenantA,
      sociedadeId,
      configId,
      tipoProcesso: `test_${RUN_ID}`,
      status: "ativo",
      colunaAtual: "backlog",
      userId: userA,
    });
    await db.insert(schema.processoTarefas).values({
      tenantId: tenantA,
      processoId: proc.id,
      checklistItemId: itemBId,
      etapa: "backlog",
      ordem: 1,
      titulo: `Item B ${RUN_ID}`,
      executorType: "analista",
      isRequired: false,
      bloqueiaAvanco: false,
      tipo: "checkbox",
      aplicavel: true,
      status: "pendente",
    });

    // 1) Item B vinculado → 409 com contagem.
    const resB = await request(app).delete(
      `/api/societario/pipeline/configs/${configId}/items/${itemBId}`,
    );
    expect(resB.status).toBe(409);
    expect(resB.body?.tarefasVinculadas).toBeGreaterThan(0);

    // Confirma que o item ainda existe no banco.
    const stillThere = await db
      .select({ id: schema.pipelineChecklistItems.id })
      .from(schema.pipelineChecklistItems)
      .where(eq(schema.pipelineChecklistItems.id, itemBId));
    expect(stillThere.length).toBe(1);

    // E a tarefa vinculada continua intacta.
    const linkedTarefas = await db
      .select({ id: schema.processoTarefas.id })
      .from(schema.processoTarefas)
      .where(eq(schema.processoTarefas.checklistItemId, itemBId));
    expect(linkedTarefas.length).toBe(1);

    // 2) Item A sem tarefas → 200.
    const resA = await request(app).delete(
      `/api/societario/pipeline/configs/${configId}/items/${itemAId}`,
    );
    expect(resA.status).toBe(200);
    expect(resA.body?.ok).toBe(true);

    const goneA = await db
      .select({ id: schema.pipelineChecklistItems.id })
      .from(schema.pipelineChecklistItems)
      .where(eq(schema.pipelineChecklistItems.id, itemAId));
    expect(goneA.length).toBe(0);
  });
});
