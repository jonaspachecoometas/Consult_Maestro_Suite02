// Sprint 4 — Endpoints REST do módulo Infraestrutura.
// Padrão: registerInfraRoutes(app), chain de auth [isAuthenticated, tenantContext, requireTenant].
//
// Tudo que escreve em infra_servers/infra_services valida tenantId via WHERE
// (defesa em profundidade — não basta validar no client).

import type { Express, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { infraServers, infraServices, idePipelineRuns } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { isAuthenticated } from "../portableAuth";
import { tenantContext, requireTenant, requireTenantAdmin } from "../tenantContext";
import { encryptConfig } from "../cryptoService";
import {
  CoolifyClient,
  CoolifyError,
  getCoolifyClient,
} from "./coolifyClient";
import { getGiteaClient, GiteaError, GITEA_OWNER } from "./giteaClient";

const auth = [isAuthenticated, tenantContext, requireTenant];

const createServerSchema = z.object({
  name: z.string().min(2).max(200),
  coolifyUrl: z.string().url().max(500),
  apiToken: z.string().min(10).max(2000),
  serverIp: z.string().max(100).optional().nullable(),
  // Sprint 6: também aceita servidores Gitea cadastrados pelo InfraManager.
  serviceType: z.enum(["coolify", "gitea"]).optional().default("coolify"),
});

const createServiceSchema = z.object({
  // Repassamos como veio (Coolify aceita vários shapes). Validamos só o mínimo.
  payload: z.record(z.any()),
}).passthrough();

const envEditSchema = z.object({
  envVars: z.record(z.string()),
});

function handleErr(res: Response, err: any, fallback = "Erro interno") {
  if (err instanceof CoolifyError || err instanceof GiteaError) {
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({
      message: err.message,
      details: err.body ?? null,
    });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
  }
  console.error("[infra] route error:", err);
  res.status(500).json({ message: err?.message || fallback });
}

// Resolve um serviço pelo coolifyId garantindo que pertence ao tenant.
// Retorna { server, service, client } ou lança CoolifyError 404.
async function resolveServiceForTenant(tenantId: string, coolifyId: string) {
  const rows = await db
    .select()
    .from(infraServices)
    .where(and(eq(infraServices.tenantId, tenantId), eq(infraServices.coolifyId, coolifyId)))
    .limit(1);
  const svc = rows[0];
  if (!svc) throw new CoolifyError("Serviço não encontrado neste tenant", 404);
  const { client, server } = await getCoolifyClient(tenantId, svc.serverId);
  return { service: svc, server, client };
}

export function registerInfraRoutes(app: Express) {
  // -------------------------------------------------------------------------
  // 1. GET /api/infra/servers — lista servidores do tenant
  // -------------------------------------------------------------------------
  app.get("/api/infra/servers", ...auth, async (req: any, res) => {
    try {
      const rows = await db
        .select({
          id: infraServers.id,
          name: infraServers.name,
          coolifyUrl: infraServers.coolifyUrl,
          serverIp: infraServers.serverIp,
          status: infraServers.status,
          lastPingAt: infraServers.lastPingAt,
          createdAt: infraServers.createdAt,
          serviceType: infraServers.serviceType,
        })
        .from(infraServers)
        .where(eq(infraServers.tenantId, req.tenantId))
        .orderBy(desc(infraServers.createdAt));

      // Conta serviços por servidor (single round-trip).
      const counts = await db
        .select({ serverId: infraServices.serverId })
        .from(infraServices)
        .where(eq(infraServices.tenantId, req.tenantId));
      const byServer = new Map<string, number>();
      counts.forEach((c) => byServer.set(c.serverId, (byServer.get(c.serverId) ?? 0) + 1));

      res.json(rows.map((s) => ({ ...s, serviceCount: byServer.get(s.id) ?? 0 })));
    } catch (err) {
      handleErr(res, err);
    }
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/infra/servers — cadastra novo servidor (criptografa token)
  // -------------------------------------------------------------------------
  app.post("/api/infra/servers", ...auth, async (req: any, res) => {
    try {
      const data = createServerSchema.parse(req.body);
      const tokenEnc = encryptConfig({ token: data.apiToken });
      const [created] = await db
        .insert(infraServers)
        .values({
          tenantId: req.tenantId,
          name: data.name,
          coolifyUrl: data.coolifyUrl,
          coolifyTokenEnc: tokenEnc,
          serverIp: data.serverIp ?? null,
          status: "unknown",
          serviceType: data.serviceType ?? "coolify",
        })
        .returning({
          id: infraServers.id,
          name: infraServers.name,
          coolifyUrl: infraServers.coolifyUrl,
          serverIp: infraServers.serverIp,
          status: infraServers.status,
          serviceType: infraServers.serviceType,
          createdAt: infraServers.createdAt,
        });
      res.status(201).json(created);
    } catch (err) {
      handleErr(res, err);
    }
  });

  // -------------------------------------------------------------------------
  // 3. POST /api/infra/servers/:id/test — pinga e atualiza status
  // -------------------------------------------------------------------------
  app.post("/api/infra/servers/:id/test", ...auth, async (req: any, res) => {
    const serverId = req.params.id;
    try {
      // Sprint 6 fix (code-review #4): gating por serviceType — Gitea usa
      // health check próprio (/api/v1/user via GiteaClient.pingHealth).
      const [srv] = await db
        .select()
        .from(infraServers)
        .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, req.tenantId)))
        .limit(1);
      if (!srv) return res.status(404).json({ message: "Servidor não encontrado" });
      if (srv.serviceType === "gitea") {
        try {
          const { GiteaClient } = await import("./giteaClient");
          const { decryptConfig } = await import("../cryptoService");
          const creds = decryptConfig<{ token: string }>(srv.coolifyTokenEnc);
          if (!creds?.token) throw new Error("Token Gitea ausente — re-cadastre");
          const gitea = new GiteaClient(srv.coolifyUrl, creds.token);
          const info = await gitea.pingHealth();
          await db
            .update(infraServers)
            .set({ status: "online", lastPingAt: new Date() })
            .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, req.tenantId)));
          return res.json({ ok: true, raw: info });
        } catch (err) {
          await db
            .update(infraServers)
            .set({ status: "offline", lastPingAt: new Date() })
            .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, req.tenantId)));
          return handleErr(res, err, "Falha ao testar conexão Gitea");
        }
      }
      const { client } = await getCoolifyClient(req.tenantId, serverId);
      const health = await client.getHealth();
      await db
        .update(infraServers)
        .set({ status: "online", lastPingAt: new Date() })
        .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, req.tenantId)));
      res.json({ ok: true, raw: health.raw ?? null });
    } catch (err) {
      // Marca offline e devolve detalhe
      await db
        .update(infraServers)
        .set({ status: "offline", lastPingAt: new Date() })
        .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, req.tenantId)));
      handleErr(res, err, "Falha ao testar conexão");
    }
  });

  // -------------------------------------------------------------------------
  // 4. DELETE /api/infra/servers/:id — remove servidor (cascata em services)
  // -------------------------------------------------------------------------
  app.delete("/api/infra/servers/:id", ...auth, async (req: any, res) => {
    try {
      const result = await db
        .delete(infraServers)
        .where(and(eq(infraServers.id, req.params.id), eq(infraServers.tenantId, req.tenantId)))
        .returning({ id: infraServers.id });
      if (result.length === 0) return res.status(404).json({ message: "Servidor não encontrado" });
      res.json({ ok: true, id: result[0].id });
    } catch (err) {
      handleErr(res, err);
    }
  });

  // -------------------------------------------------------------------------
  // 5. GET /api/infra/servers/:id/services — lista serviços (sincroniza cache)
  // -------------------------------------------------------------------------
  app.get("/api/infra/servers/:id/services", ...auth, async (req: any, res) => {
    const serverId = req.params.id;
    try {
      const { client } = await getCoolifyClient(req.tenantId, serverId);
      const remote = await client.listServices();

      // Atualiza cache local: insere novos, atualiza existentes.
      for (const svc of remote) {
        if (!svc.uuid) continue;
        await db
          .insert(infraServices)
          .values({
            serverId,
            tenantId: req.tenantId,
            coolifyId: svc.uuid,
            name: svc.name,
            serviceType: svc.type ?? "service",
            publicUrl: svc.url ?? null,
            status: svc.status ?? "unknown",
          })
          .onConflictDoUpdate({
            target: [infraServices.serverId, infraServices.coolifyId],
            set: {
              name: svc.name,
              serviceType: svc.type ?? "service",
              publicUrl: svc.url ?? null,
              status: svc.status ?? "unknown",
              updatedAt: new Date(),
            },
          });
      }

      const rows = await db
        .select()
        .from(infraServices)
        .where(and(eq(infraServices.tenantId, req.tenantId), eq(infraServices.serverId, serverId)))
        .orderBy(desc(infraServices.updatedAt));

      res.json(rows);
    } catch (err) {
      handleErr(res, err, "Falha ao listar serviços");
    }
  });

  // -------------------------------------------------------------------------
  // 6. POST /api/infra/servers/:id/services — cria serviço novo
  // -------------------------------------------------------------------------
  app.post("/api/infra/servers/:id/services", ...auth, async (req: any, res) => {
    const serverId = req.params.id;
    try {
      const data = createServiceSchema.parse(req.body);
      const { client } = await getCoolifyClient(req.tenantId, serverId);
      const created = await client.createService(data.payload);
      // Persiste no cache local
      if (created?.uuid) {
        await db
          .insert(infraServices)
          .values({
            serverId,
            tenantId: req.tenantId,
            coolifyId: created.uuid,
            name: created.name ?? data.payload?.name ?? "novo-serviço",
            serviceType: data.payload?.type ?? "service",
            status: "unknown",
          })
          .onConflictDoNothing({ target: [infraServices.serverId, infraServices.coolifyId] });
      }
      res.status(201).json(created);
    } catch (err) {
      handleErr(res, err, "Falha ao criar serviço");
    }
  });

  // -------------------------------------------------------------------------
  // 7. POST /api/infra/services/:coolifyId/start
  // -------------------------------------------------------------------------
  app.post("/api/infra/services/:coolifyId/start", ...auth, async (req: any, res) => {
    try {
      const { client, service } = await resolveServiceForTenant(req.tenantId, req.params.coolifyId);
      const r = await client.startService(req.params.coolifyId);
      await db.update(infraServices)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(infraServices.id, service.id));
      res.json(r);
    } catch (err) {
      handleErr(res, err, "Falha ao iniciar serviço");
    }
  });

  // -------------------------------------------------------------------------
  // 8. POST /api/infra/services/:coolifyId/stop
  // -------------------------------------------------------------------------
  app.post("/api/infra/services/:coolifyId/stop", ...auth, async (req: any, res) => {
    try {
      const { client, service } = await resolveServiceForTenant(req.tenantId, req.params.coolifyId);
      const r = await client.stopService(req.params.coolifyId);
      await db.update(infraServices)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(infraServices.id, service.id));
      res.json(r);
    } catch (err) {
      handleErr(res, err, "Falha ao parar serviço");
    }
  });

  // -------------------------------------------------------------------------
  // 9. GET /api/infra/services/:coolifyId/logs — SSE: poll a cada 3s
  // -------------------------------------------------------------------------
  app.get("/api/infra/services/:coolifyId/logs", ...auth, async (req: any, res) => {
    let resolved;
    try {
      resolved = await resolveServiceForTenant(req.tenantId, req.params.coolifyId);
    } catch (err) {
      return handleErr(res, err, "Falha ao abrir logs");
    }
    const { client } = resolved;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let stopped = false;
    let lastSnapshot = "";

    const tick = async () => {
      if (stopped) return;
      try {
        const text = await client.getServiceLogs(req.params.coolifyId, 200);
        if (stopped) return; // cliente pode ter desconectado durante o await
        if (text !== lastSnapshot) {
          lastSnapshot = text;
          // Envia bloco completo (cliente substitui buffer). Mais simples e robusto.
          res.write(`event: snapshot\n`);
          res.write(`data: ${JSON.stringify({ logs: text, ts: Date.now() })}\n\n`);
        } else {
          // heartbeat para manter conexão viva atrás de proxies
          res.write(`: ping ${Date.now()}\n\n`);
        }
      } catch (err: any) {
        if (stopped) return;
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: err?.message || "erro ao buscar logs" })}\n\n`);
      }
    };

    // Primeiro tick imediato, depois a cada 3s.
    await tick();
    const interval = setInterval(tick, 3000);

    req.on("close", () => {
      stopped = true;
      clearInterval(interval);
      try { res.end(); } catch {}
    });
  });

  // -------------------------------------------------------------------------
  // 10. PATCH /api/infra/services/:coolifyId/env — atualiza env vars
  // -------------------------------------------------------------------------
  app.patch("/api/infra/services/:coolifyId/env", ...auth, async (req: any, res) => {
    try {
      const data = envEditSchema.parse(req.body);
      const { client, service } = await resolveServiceForTenant(req.tenantId, req.params.coolifyId);
      const r = await client.updateEnvVars(req.params.coolifyId, data.envVars);
      // Cache local da última leitura
      await db.update(infraServices)
        .set({ envVars: data.envVars, updatedAt: new Date() })
        .where(eq(infraServices.id, service.id));
      res.json(r);
    } catch (err) {
      handleErr(res, err, "Falha ao atualizar env vars");
    }
  });

  // -------------------------------------------------------------------------
  // 11. POST /api/infra/services/:coolifyId/deploy — dispara deploy
  // -------------------------------------------------------------------------
  app.post("/api/infra/services/:coolifyId/deploy", ...auth, async (req: any, res) => {
    try {
      const { client, service } = await resolveServiceForTenant(req.tenantId, req.params.coolifyId);
      const r = await client.deployApplication(req.params.coolifyId);
      await db.update(infraServices)
        .set({ status: "building", updatedAt: new Date() })
        .where(eq(infraServices.id, service.id));
      res.json(r);
    } catch (err) {
      handleErr(res, err, "Falha ao iniciar deploy");
    }
  });

  // -------------------------------------------------------------------------
  // 12. GET /api/infra/servers/:id/applications — lista aplicações Coolify
  // -------------------------------------------------------------------------
  app.get("/api/infra/servers/:id/applications", ...auth, async (req: any, res) => {
    try {
      const { client } = await getCoolifyClient(req.tenantId, req.params.id);
      const apps = await client.listApplications();
      res.json(apps);
    } catch (err) {
      handleErr(res, err, "Falha ao listar aplicações");
    }
  });

  // ===========================================================================
  // Sprint 5 — Git/Gitea (proxy autenticado, isolado por tenant)
  //
  // Convenções:
  //   - O "projeto" do Dev Center é uma run de pipeline (ide_pipeline_runs).
  //   - O nome do repo é "project-<runId>" e o owner é GITEA_OWNER.
  //   - Se o tenant não tem Gitea cadastrado em infra_servers (service_type='gitea')
  //     todas as rotas devolvem 412 com mensagem clara para a UI exibir.
  //   - Se a run não tem gitRepoUrl ainda, devolve 404 — o repo só é criado
  //     no primeiro deploy aprovado.
  // ===========================================================================

  // helper: valida tenant + carrega run + cliente Gitea + retorna {client, owner, repo}
  async function resolveGitContext(tenantId: string, projectId: string) {
    const [run] = await db
      .select({
        id: idePipelineRuns.id,
        gitRepoUrl: idePipelineRuns.gitRepoUrl,
        target: idePipelineRuns.target,
        createdAt: idePipelineRuns.createdAt,
      })
      .from(idePipelineRuns)
      .where(and(eq(idePipelineRuns.id, projectId), eq(idePipelineRuns.tenantId, tenantId)))
      .limit(1);
    if (!run) throw new GiteaError("Projeto não encontrado", 404);

    // Fase 1 — target 'consult' (novo, self-deploy) OU repoUrl interno SEMPRE
    // usa o git interno (1 repo por tenant). EXCETO runs legadas com
    // target='consult' (gitRepoUrl externo OU criadas antes do release) —
    // preservam acesso ao Gitea original. Detecção delegada ao orchestrator.
    const { isLegacyConsultRun } = await import("../ide/orchestrator");
    const isLegacyConsult = isLegacyConsultRun(run);
    const isInternal = !isLegacyConsult && (
      run.target === "consult" || (run.gitRepoUrl?.startsWith("internal://") ?? false)
    );
    if (isInternal) {
      const { getInternalGitForRun } = await import("../devCenter");
      const internal = await getInternalGitForRun(tenantId, projectId);
      const client: import("../devCenter").GitClient = internal.client;
      return {
        client,
        owner: internal.owner,
        repo: internal.repo,
        gitRepoUrl: run.gitRepoUrl ?? internal.repoUrl,
      };
    }

    const gitea = await getGiteaClient(tenantId);
    if (!gitea) {
      // Fallback Fase 1: sem Gitea + run NÃO-legada → usa interno (sempre on-demand).
      // Para runs legadas (target diferente de consult ou consult-legado), exige Gitea.
      if (run.target === "consult" && !isLegacyConsult) {
        const { getInternalGitForRun } = await import("../devCenter");
        const internal = await getInternalGitForRun(tenantId, projectId);
        const client: import("../devCenter").GitClient = internal.client;
        return {
          client,
          owner: internal.owner,
          repo: internal.repo,
          gitRepoUrl: run.gitRepoUrl ?? internal.repoUrl,
        };
      }
      throw new GiteaError("Gitea não configurado para este tenant. Cadastre um servidor com tipo 'gitea' em Infraestrutura.", 412);
    }
    if (!run.gitRepoUrl) throw new GiteaError("Repositório ainda não criado — faça o primeiro deploy aprovado para gerar o repo automaticamente.", 404);
    // owner pode ter sido salvo no html_url (caso fallback /user/repos)
    const m = run.gitRepoUrl.match(/\/([^\/]+)\/([^\/]+)\/?$/);
    const owner = m?.[1] ?? GITEA_OWNER;
    const repo = m?.[2] ?? `project-${projectId}`;
    const client: import("../devCenter").GitClient = gitea.client;
    return { client, owner, repo, gitRepoUrl: run.gitRepoUrl };
  }

  // 13. GET /api/ide/projects/:projectId/git/commits?branch=...
  app.get("/api/ide/projects/:projectId/git/commits", ...auth, async (req: any, res) => {
    try {
      const { client, owner, repo, gitRepoUrl } = await resolveGitContext(req.tenantId, req.params.projectId);
      const branch = typeof req.query.branch === "string" ? req.query.branch : undefined;
      const [commits, branches] = await Promise.all([
        client.listCommits(owner, repo, branch),
        client.listBranches(owner, repo).catch(() => []),
      ]);
      res.json({ gitRepoUrl, owner, repo, branches, commits });
    } catch (err) {
      handleErr(res, err, "Falha ao listar commits");
    }
  });

  // 14. GET /api/ide/projects/:projectId/git/commits/:sha/diff
  app.get("/api/ide/projects/:projectId/git/commits/:sha/diff", ...auth, async (req: any, res) => {
    try {
      const { client, owner, repo } = await resolveGitContext(req.tenantId, req.params.projectId);
      const detail = await client.getCommitDiff(owner, repo, req.params.sha);
      res.json(detail);
    } catch (err) {
      handleErr(res, err, "Falha ao carregar diff");
    }
  });

  // 15. POST /api/ide/projects/:projectId/git/branches  body: { name, fromBranch? }
  app.post("/api/ide/projects/:projectId/git/branches", ...auth, async (req: any, res) => {
    const schema = z.object({
      name: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._\-\/]+$/, "Nome inválido"),
      fromBranch: z.string().min(1).max(120).optional(),
    });
    try {
      const data = schema.parse(req.body);
      const { client, owner, repo } = await resolveGitContext(req.tenantId, req.params.projectId);
      const created = await client.createBranch(owner, repo, data.name, data.fromBranch || "main");
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Dados inválidos", errors: err.errors });
      }
      handleErr(res, err, "Falha ao criar branch");
    }
  });

  // 16. POST /api/ide/projects/:projectId/git/commits/:sha/revert
  // Cria commits de reversão SEM reescrever histórico: lê os arquivos do commit,
  // restaura o conteúdo do parent (ou remove de fato se foi adicionado) e
  // commita por cima. Falhas parciais são reportadas explicitamente.
  app.post("/api/ide/projects/:projectId/git/commits/:sha/revert", ...auth, async (req: any, res) => {
    try {
      const { client, owner, repo } = await resolveGitContext(req.tenantId, req.params.projectId);
      const detail = await client.getCommitDiff(owner, repo, req.params.sha);
      const branch = (typeof req.body?.branch === "string" && req.body.branch) || "main";
      // Parent SHA real (vindo da API). Se commit é root (sem parents), só dá
      // para tratar como "tudo foi adicionado".
      const parentSha = detail.parents[0] ?? null;
      const shortSha = req.params.sha.slice(0, 7);
      let reverted = 0;
      const failed: { file: string; reason: string }[] = [];
      for (const f of detail.files) {
        if (!f.filename) continue;
        try {
          if (f.status === "added" || !parentSha) {
            // Arquivo novo neste commit (ou commit root) — reverter = DELETE real.
            const r = await client.deleteFile(
              owner, repo, f.filename,
              `revert: remove ${f.filename} (adicionado em ${shortSha})`,
              branch,
            );
            if (r === null) {
              failed.push({ file: f.filename, reason: "arquivo já não existe na branch" });
              continue;
            }
          } else {
            // Lê o estado anterior real usando o SHA do parent (não <sha>~1).
            const beforeContent = await client.getFileContent(owner, repo, f.filename, parentSha);
            if (beforeContent === null) {
              failed.push({ file: f.filename, reason: "conteúdo anterior não encontrado no parent" });
              continue;
            }
            await client.commitFile(
              owner, repo, f.filename, beforeContent,
              `revert: ${f.filename} (volta ao estado anterior a ${shortSha})`,
              branch,
            );
          }
          reverted++;
        } catch (e: any) {
          failed.push({ file: f.filename, reason: e?.message ?? String(e) });
        }
      }
      // Se nada foi revertido E havia arquivos a tratar, devolve 502 com detalhes
      // (anteriormente devolvia 200 silenciosamente).
      if (reverted === 0 && detail.files.length > 0) {
        return res.status(502).json({
          message: "Revert falhou em todos os arquivos",
          reverted: 0,
          total: detail.files.length,
          failures: failed,
        });
      }
      res.json({ ok: true, reverted, total: detail.files.length, failures: failed });
    } catch (err) {
      handleErr(res, err, "Falha ao reverter commit");
    }
  });

  // ===========================================================================
  // SPRINT 7 — Wizard de Onboarding
  //
  // Endpoints:
  //   POST /api/infra/servers/test-connection   — testa sem salvar
  //   POST /api/infra/provision/frappe          — provisiona Frappe
  //   POST /api/infra/provision/generic         — provisiona qualquer Docker
  //   GET  /api/infra/provision/:jobId/stream   — SSE de progresso
  // ===========================================================================

  // ---- 1) test-connection: testa Coolify OU Gitea sem persistir nada -------
  // Gating: requireTenantAdmin — apenas admins do tenant podem fazer probes
  // (evita reconnaissance lateral por membros comuns).
  app.post("/api/infra/servers/test-connection", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      coolifyUrl: z.string().url().max(500),
      token: z.string().min(10).max(2000),
      serviceType: z.enum(["coolify", "gitea"]).optional().default("coolify"),
    });
    try {
      const data = schema.parse(req.body);
      if (data.serviceType === "gitea") {
        const gitea = new (await import("./giteaClient")).GiteaClient(data.coolifyUrl, data.token);
        const info = await gitea.pingHealth();
        return res.json({ ok: true, serviceType: "gitea", raw: info });
      }
      const client = new CoolifyClient(data.coolifyUrl, data.token);
      const health = await client.getHealth();
      return res.json({ ok: true, serviceType: "coolify", raw: health.raw ?? null });
    } catch (err: any) {
      // Diferencia tipos de falha para mensagem específica no wizard.
      let code = "unknown";
      let message = err?.message ?? "Erro desconhecido";
      if (err instanceof z.ZodError) {
        code = "invalid_payload";
        message = "Dados inválidos: " + err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
        return res.status(400).json({ ok: false, code, message });
      }
      if (err instanceof CoolifyError || err instanceof GiteaError) {
        if (err.status === 401 || err.status === 403) code = "auth";
        else if (err.status === 502 && /SSRF/i.test(err.message)) code = "ssrf";
        else if (err.status >= 500) code = "server_error";
        else code = "http_" + err.status;
        return res.status(200).json({ ok: false, code, status: err.status, message: err.message });
      }
      const errStr = String(err?.message ?? err);
      if (/timeout|aborted/i.test(errStr)) code = "timeout";
      else if (/ENOTFOUND|EAI_AGAIN/i.test(errStr)) code = "dns";
      else if (/ECONNREFUSED|ECONNRESET/i.test(errStr)) code = "network";
      return res.status(200).json({ ok: false, code, message: errStr });
    }
  });

  // ---- 2) Provisionamento: estado em memória + SSE -------------------------
  // Map<jobId, ProvisionState> — efêmero, limpa após 5min.
  type ProvStep = { label: string; status: "pending" | "running" | "ok" | "error"; message?: string };
  type ProvState = {
    jobId: string;
    tenantId: string;
    serverId: string;
    type: "frappe" | "generic";
    steps: ProvStep[];
    startedAt: number;
    finishedAt?: number;
    coolifyId?: string;
    publicUrl?: string;
    credentials?: Record<string, string>;
    error?: string;
    listeners: Set<Response>;
  };
  // @ts-ignore — guardamos no global para sobreviver a HMR no dev.
  if (!(globalThis as any).__provisionJobs) (globalThis as any).__provisionJobs = new Map();
  const provJobs: Map<string, ProvState> = (globalThis as any).__provisionJobs;

  function emit(state: ProvState) {
    const payload = JSON.stringify({
      jobId: state.jobId,
      steps: state.steps,
      coolifyId: state.coolifyId,
      publicUrl: state.publicUrl,
      credentials: state.credentials,
      error: state.error,
      done: !!state.finishedAt,
    });
    state.listeners.forEach((r) => {
      try { r.write(`data: ${payload}\n\n`); } catch { /* ignore */ }
    });
    if (state.finishedAt) {
      // Fecha SSE após emitir estado final.
      state.listeners.forEach((r) => {
        try { r.end(); } catch { /* ignore */ }
      });
      state.listeners.clear();
      // Cleanup do estado depois de 5min.
      setTimeout(() => provJobs.delete(state.jobId), 5 * 60 * 1000);
    }
  }
  function setStep(state: ProvState, idx: number, patch: Partial<ProvStep>) {
    state.steps[idx] = { ...state.steps[idx], ...patch };
    emit(state);
  }

  async function runProvision(state: ProvState, opts: {
    tenantId: string;
    serverId: string;
    payload: Record<string, any>;
    envVars: Record<string, string>;
    serviceName: string;
    publicHint?: string;
    credentials?: Record<string, string>;
  }) {
    try {
      // Etapa 0 — resolver cliente Coolify
      setStep(state, 0, { status: "running" });
      const { client } = await getCoolifyClient(opts.tenantId, opts.serverId);
      setStep(state, 0, { status: "ok", message: "Coolify pronto." });

      // Etapa 1 — criar serviço
      setStep(state, 1, { status: "running" });
      const created = await client.createService(opts.payload);
      const coolifyId = created.uuid;
      if (!coolifyId) throw new Error("Coolify não devolveu UUID do serviço.");
      state.coolifyId = coolifyId;
      // Persiste em infra_services para listagem em Infraestrutura.
      try {
        await db.insert(infraServices).values({
          serverId: opts.serverId,
          tenantId: opts.tenantId,
          coolifyId,
          name: opts.serviceName,
          serviceType: state.type === "frappe" ? "frappe" : "service",
          publicUrl: opts.publicHint ?? null,
          status: "building",
          envVars: opts.envVars,
        });
      } catch (e: any) {
        // Não bloqueia: se já existe (uniq), seguimos.
        console.warn("[provision] insert infraServices falhou:", e?.message);
      }
      setStep(state, 1, { status: "ok", message: `Serviço criado (uuid: ${coolifyId.slice(0, 8)}…)` });

      // Etapa 2 — env vars
      setStep(state, 2, { status: "running" });
      if (Object.keys(opts.envVars).length > 0) {
        try {
          await client.updateEnvVars(coolifyId, opts.envVars);
          setStep(state, 2, { status: "ok", message: `${Object.keys(opts.envVars).length} variáveis configuradas.` });
        } catch (e: any) {
          // Não-fatal: marca warning mas continua o deploy.
          setStep(state, 2, { status: "ok", message: `Aviso: env vars não puderam ser definidas (${e?.message}). Configure manualmente.` });
        }
      } else {
        setStep(state, 2, { status: "ok", message: "Sem variáveis a configurar." });
      }

      // Etapa 3 — start
      setStep(state, 3, { status: "running" });
      await client.startService(coolifyId);
      setStep(state, 3, { status: "ok", message: "Container iniciado." });

      // Etapa 4 — aguardar resposta (best-effort: 6 tentativas a cada 5s)
      setStep(state, 4, { status: "running" });
      let online = false;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        try {
          const services = await client.listServices();
          const me = services.find((s) => s.uuid === coolifyId);
          if (me?.status === "running") {
            online = true;
            state.publicUrl = me.fqdn ?? me.url ?? opts.publicHint ?? state.publicUrl;
            break;
          }
        } catch { /* segue */ }
      }
      if (!online) {
        setStep(state, 4, { status: "ok", message: "Serviço iniciado mas ainda não respondeu (verifique em Infraestrutura)." });
      } else {
        setStep(state, 4, { status: "ok", message: "Aplicação respondendo." });
      }

      // Etapa 5 — SSL é gerenciado pelo Coolify automaticamente quando há FQDN.
      setStep(state, 5, { status: "ok", message: state.publicUrl ? `Disponível em ${state.publicUrl}` : "SSL será emitido automaticamente pelo Coolify." });

      // Atualiza infra_services para status final.
      await db
        .update(infraServices)
        .set({ status: online ? "running" : "building", publicUrl: state.publicUrl ?? null, updatedAt: new Date() })
        .where(and(eq(infraServices.coolifyId, coolifyId), eq(infraServices.tenantId, opts.tenantId)));

      state.credentials = opts.credentials;
      state.finishedAt = Date.now();
      emit(state);
    } catch (err: any) {
      const idx = state.steps.findIndex((s) => s.status === "running");
      if (idx >= 0) {
        setStep(state, idx, { status: "error", message: err?.message ?? String(err) });
      }
      state.error = err?.message ?? String(err);
      state.finishedAt = Date.now();
      emit(state);
    }
  }

  function makeSteps(): ProvStep[] {
    return [
      { label: "Conectando ao Coolify…", status: "pending" },
      { label: "Criando serviço…", status: "pending" },
      { label: "Configurando variáveis de ambiente…", status: "pending" },
      { label: "Iniciando container…", status: "pending" },
      { label: "Aguardando aplicação responder…", status: "pending" },
      { label: "Configurando SSL automático…", status: "pending" },
    ];
  }

  // Helper: valida serverId pertence ao tenant ANTES de qualquer side-effect
  // (cria job em memória). Evita memory abuse via spam de payloads inválidos.
  async function assertOwnedCoolifyServer(tenantId: string, serverId: string) {
    const [srv] = await db
      .select({ id: infraServers.id, serviceType: infraServers.serviceType })
      .from(infraServers)
      .where(and(eq(infraServers.id, serverId), eq(infraServers.tenantId, tenantId)))
      .limit(1);
    if (!srv) {
      const e: any = new Error("Servidor não encontrado para este tenant");
      e.status = 404;
      throw e;
    }
    if (srv.serviceType !== "coolify") {
      const e: any = new Error("Apenas servidores Coolify podem provisionar serviços");
      e.status = 400;
      throw e;
    }
  }

  // ---- 3) Provision Frappe -------------------------------------------------
  // Gating: requireTenantAdmin — só admins do tenant podem provisionar e
  // receber credenciais de admin via SSE.
  app.post("/api/infra/provision/frappe", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      serverId: z.string().min(1),
      clienteName: z.string().min(2).max(200),
      subdomain: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/i, "subdomínio só pode ter letras, números e hífen"),
      adminEmail: z.string().email(),
      adminPassword: z.string().min(8).max(200),
      domain: z.string().max(200).optional().default("arcadia.app"),
      envExtra: z.record(z.string()).optional().default({}),
    });
    try {
      const data = schema.parse(req.body);
      // Valida ownership ANTES de criar job em memória.
      await assertOwnedCoolifyServer(req.tenantId, data.serverId);
      const fqdn = `${data.subdomain}.${data.domain}`;
      const envVars: Record<string, string> = {
        SITE_NAME: fqdn,
        ADMIN_EMAIL: data.adminEmail,
        ADMIN_PASSWORD: data.adminPassword,
        FRAPPE_SITE_NAME_HEADER: fqdn,
        ...data.envExtra,
      };
      // Payload genérico do Coolify; cada instância pode ter um one-click próprio,
      // mas createService aceita esse shape mínimo (nome + docker_compose ref).
      const payload = {
        name: `frappe-${data.subdomain}`,
        type: "docker-image",
        docker_image: "frappe/erpnext:latest",
        domains: [`https://${fqdn}`],
        instant_deploy: false,
      };
      const jobId = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const state: ProvState = {
        jobId, tenantId: req.tenantId, serverId: data.serverId,
        type: "frappe", steps: makeSteps(), startedAt: Date.now(),
        listeners: new Set(),
      };
      provJobs.set(jobId, state);
      // Roda em background.
      runProvision(state, {
        tenantId: req.tenantId, serverId: data.serverId,
        payload, envVars,
        serviceName: data.clienteName,
        publicHint: `https://${fqdn}`,
        credentials: { admin_email: data.adminEmail, admin_password: data.adminPassword, url: `https://${fqdn}` },
      });
      res.status(202).json({ jobId, fqdn });
    } catch (err) {
      handleErr(res, err, "Falha ao iniciar provisionamento Frappe");
    }
  });

  // ---- 4) Provision Generic ------------------------------------------------
  app.post("/api/infra/provision/generic", ...auth, requireTenantAdmin, async (req: any, res) => {
    const schema = z.object({
      serverId: z.string().min(1),
      name: z.string().min(2).max(200),
      dockerImage: z.string().min(3).max(300),
      port: z.coerce.number().int().min(1).max(65535).optional(),
      env: z.record(z.string()).optional().default({}),
      domain: z.string().max(200).optional(),
    });
    try {
      const data = schema.parse(req.body);
      await assertOwnedCoolifyServer(req.tenantId, data.serverId);
      const payload: any = {
        name: data.name,
        type: "docker-image",
        docker_image: data.dockerImage,
        instant_deploy: false,
      };
      if (data.domain) payload.domains = [`https://${data.domain}`];
      if (data.port) payload.exposed_port = data.port;
      const jobId = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const state: ProvState = {
        jobId, tenantId: req.tenantId, serverId: data.serverId,
        type: "generic", steps: makeSteps(), startedAt: Date.now(),
        listeners: new Set(),
      };
      provJobs.set(jobId, state);
      runProvision(state, {
        tenantId: req.tenantId, serverId: data.serverId,
        payload, envVars: data.env,
        serviceName: data.name,
        publicHint: data.domain ? `https://${data.domain}` : undefined,
      });
      res.status(202).json({ jobId });
    } catch (err) {
      handleErr(res, err, "Falha ao iniciar provisionamento genérico");
    }
  });

  // ---- 5) SSE de progresso -------------------------------------------------
  app.get("/api/infra/provision/:jobId/stream", ...auth, async (req: any, res) => {
    const { jobId } = req.params;
    const state = provJobs.get(jobId);
    if (!state) return res.status(404).json({ message: "Job não encontrado ou expirado" });
    if (state.tenantId !== req.tenantId) return res.status(403).json({ message: "Job pertence a outro tenant" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    // Snapshot inicial.
    res.write(`data: ${JSON.stringify({
      jobId: state.jobId, steps: state.steps, coolifyId: state.coolifyId,
      publicUrl: state.publicUrl, credentials: state.credentials,
      error: state.error, done: !!state.finishedAt,
    })}\n\n`);

    if (state.finishedAt) {
      return res.end();
    }
    state.listeners.add(res);
    req.on("close", () => state.listeners.delete(res));
  });
}
