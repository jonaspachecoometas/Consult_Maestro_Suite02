import cron from "node-cron";
import { db } from "./db";
import { automationRules, type AutomationRule } from "../shared/schema";
import { eq, and } from "drizzle-orm";
import { runSync } from "./connectorService";
import { sendNotification } from "./notificationService";

let cronTaskStarted = false;

/**
 * Boots the automation engine. Runs once per minute and evaluates every
 * active cron-triggered rule whose cron expression matches the current
 * minute. Re-entrant safe — calling more than once is a no-op.
 */
export function startAutomationEngine() {
  if (cronTaskStarted) return;
  cronTaskStarted = true;
  cron.schedule("* * * * *", async () => {
    try {
      await evaluateCronRules();
    } catch (e) {
      console.error("[Automation] tick error:", e);
    }
  });
  console.log("[Automation] Motor de automação iniciado (cron a cada minuto)");
}

async function evaluateCronRules() {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.isActive, 1), eq(automationRules.triggerType, "cron")));

  const now = new Date();
  for (const rule of rules) {
    const expr = (rule.triggerConfig as any)?.cronExpression;
    if (!expr || typeof expr !== "string") continue;
    if (!cron.validate(expr)) continue;
    if (!cronExpressionMatches(expr, now)) continue;
    await executeRule(rule).catch((e) =>
      console.error(`[Automation] regra ${rule.id} falhou:`, e?.message || e),
    );
  }
}

/** Triggers a rule on demand (used by POST /api/automations/:id/run). */
export async function runRuleNow(ruleId: string, tenantId: string) {
  const [rule] = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.id, ruleId), eq(automationRules.tenantId, tenantId)));
  if (!rule) throw new Error("Regra não encontrada");
  return executeRule(rule);
}

async function executeRule(rule: AutomationRule) {
  const cfg = (rule.actionConfig ?? {}) as Record<string, any>;
  let status: "success" | "error" = "success";
  let message = "";
  try {
    switch (rule.actionType) {
      case "sync_datasource": {
        if (!cfg.dataSourceId) throw new Error("dataSourceId ausente");
        const r = await runSync(cfg.dataSourceId, rule.tenantId, "automation");
        if (r.status === "error") throw new Error(r.error || "sync falhou");
        message = `Sincronizou ${r.rowsSynced} linhas`;
        break;
      }
      case "send_notification": {
        const channel = (cfg.channel || "inapp") as "inapp" | "whatsapp" | "email";
        const out = await sendNotification(rule.tenantId, {
          channel,
          recipients: cfg.recipients || [],
          title: cfg.title || rule.name,
          message: cfg.message || "",
          type: cfg.type || "info",
          sourceType: "automation_rule",
          sourceId: rule.id,
        });
        message = `Notificou ${out.delivered} (${out.channel}${out.fallback ? " — fallback" : ""})`;
        break;
      }
      case "run_agent": {
        // Best-effort agent invocation; the agent service decides what
        // to do. We tolerate its absence so this MVP works even before
        // the agent registry is wired up.
        try {
          const agentSvc = await import("./agentService");
          const fn = (agentSvc as any).runAgent;
          if (typeof fn !== "function") throw new Error("runAgent indisponível");
          const result = await fn({
            tenantId: rule.tenantId,
            agentType: cfg.agentType || "generic",
            input: cfg.input || rule.name,
            projectId: cfg.projectId,
          });
          message = `Agente executou (${result?.tokensInput ?? 0}+${result?.tokensOutput ?? 0} tokens)`;
        } catch (err: any) {
          throw new Error(`Falha no agente: ${err?.message || err}`);
        }
        break;
      }
      case "run_browser_skill": {
        if (!cfg.skillName) throw new Error("skillName ausente");
        const { findSkill, executeSkill } = await import("./browserAgent/skillsLibrary");
        const skill = await findSkill(rule.tenantId, cfg.skillName);
        if (!skill) throw new Error(`Skill não encontrada: ${cfg.skillName}`);
        const taskId = `${cfg.taskIdPrefix || "auto"}_${Date.now()}`;
        const run = await executeSkill(skill.id, taskId, {
          tenantId: rule.tenantId,
          userConfirmed: true,
        });
        if (!run.ok) throw new Error(`Skill '${skill.name}' falhou em ${run.steps.length} passo(s)`);
        message = `Skill '${skill.name}' executada (${run.steps.length} passos)`;
        break;
      }
      default:
        throw new Error(`actionType desconhecido: ${rule.actionType}`);
    }
  } catch (err: any) {
    status = "error";
    message = err?.message || String(err);
  }

  await db
    .update(automationRules)
    .set({
      lastRunAt: new Date(),
      lastRunStatus: status,
      lastRunMessage: message,
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, rule.id));

  return { status, message };
}

// ── Minimal cron expression matcher (5 fields) ──────────────────────
// Supports: '*', exact numbers, comma lists, ranges (a-b), step (*/n).
function cronExpressionMatches(expr: string, when: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const minute = when.getMinutes();
  const hour = when.getHours();
  const dom = when.getDate();
  const month = when.getMonth() + 1;
  const dow = when.getDay();
  return (
    matchField(fields[0], minute, 0, 59) &&
    matchField(fields[1], hour, 0, 23) &&
    matchField(fields[2], dom, 1, 31) &&
    matchField(fields[3], month, 1, 12) &&
    matchField(fields[4], dow, 0, 6)
  );
}

function matchField(field: string, value: number, lo: number, hi: number): boolean {
  for (const part of field.split(",")) {
    const [base, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isFinite(step) || step <= 0) continue;
    let from = lo;
    let to = hi;
    if (base !== "*") {
      if (base.includes("-")) {
        const [a, b] = base.split("-").map(Number);
        if (Number.isFinite(a) && Number.isFinite(b)) {
          from = a;
          to = b;
        }
      } else {
        const n = Number(base);
        if (!Number.isFinite(n)) continue;
        from = n;
        to = n;
      }
    }
    for (let v = from; v <= to; v += step) {
      if (v === value) return true;
    }
  }
  return false;
}
