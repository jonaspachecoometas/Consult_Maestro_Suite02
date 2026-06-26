import type { RequestHandler, Response, NextFunction } from "express";
import { db } from "./db";
import { tenantUsers, tenants } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

type AuthUser = {
  isLocalAuth?: number;
  id?: string;
  claims?: { sub?: string; email?: string; first_name?: string; last_name?: string; profile_image_url?: string };
  dbUserId?: string;
};

declare global {
  namespace Express {
    interface Request {
      tenantId?: string | null;
      tenantRole?: string | null;
      isSuperadmin?: boolean;
      partnerId?: string | null;
      systemRole?: "superadmin" | "partner" | "tenant_admin" | "user" | null;
    }
    interface User extends AuthUser {}
  }
}

/**
 * Resolve o ID interno (UUID) do usuário autenticado.
 * Estratégia:
 *  1. Local auth -> user.id direto.
 *  2. OIDC com dbUserId em cache na session -> usa direto.
 *  3. OIDC com apenas claims.sub -> tenta storage.getUser(sub);
 *     se não achar (sub não é UUID), tenta getUserByProviderSub(sub);
 *     se ainda não achar mas há claims completas, faz upsertOidcUser.
 *     Em todos os casos, persiste dbUserId na session para próximas chamadas.
 */
async function resolveAuthUserId(req: Express.Request): Promise<string | null> {
  const user = req.user as AuthUser | undefined;
  if (!user) return null;

  if (user.isLocalAuth && user.id) {
    return user.id;
  }

  if (user.dbUserId) {
    return user.dbUserId;
  }

  const sub = user.claims?.sub;
  if (!sub) return null;

  const { storage } = await import("./storage");

  // 1) Tentativa direta (caso sub já seja UUID em sistemas legados).
  const direct = await storage.getUser(sub);
  if (direct) {
    user.dbUserId = direct.id;
    return direct.id;
  }

  // 2) Lookup por providerSub.
  const byProv = await storage.getUserByProviderSub(sub);
  if (byProv) {
    user.dbUserId = byProv.id;
    return byProv.id;
  }

  // 3) Self-heal: session OIDC válida mas sem row em users → upsert agora.
  // Cobre o caso de sessão antiga onde o upsert não rodou (ou rodou e falhou).
  if (user.claims?.email || sub) {
    try {
      const upserted = await storage.upsertOidcUser({
        providerSub: sub,
        email: user.claims?.email,
        firstName: user.claims?.first_name,
        lastName: user.claims?.last_name,
        profileImageUrl: user.claims?.profile_image_url,
        provider: "oidc",
      });
      user.dbUserId = upserted.id;
      console.log(`[tenantContext] self-healed OIDC user ${sub} -> ${upserted.id}`);
      return upserted.id;
    } catch (err) {
      console.error("[tenantContext] OIDC self-heal upsert failed:", err);
    }
  }

  return null;
}

export const tenantContext: RequestHandler = async (req, res, next) => {
  req.tenantId = null;
  req.tenantRole = null;
  req.isSuperadmin = false;
  req.partnerId = null;
  req.systemRole = null;

  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return next();
  }

  const userId = await resolveAuthUserId(req);
  if (!userId) {
    return next();
  }

  try {
    const { storage } = await import("./storage");
    const dbUser = await storage.getUser(userId);

    if (!dbUser) {
      return next();
    }

    if (dbUser.partnerId) {
      req.partnerId = dbUser.partnerId;
    }
    req.systemRole = (dbUser.systemRole as Express.Request["systemRole"]) ?? "user";

    const headerTenantId = req.headers["x-tenant-id"] as string | undefined;

    if (dbUser.role === "superadmin" || dbUser.systemRole === "superadmin") {
      req.isSuperadmin = true;
      if (headerTenantId) {
        req.tenantId = headerTenantId;
        req.tenantRole = "superadmin";
        return next();
      }
      const memberships = await db
        .select()
        .from(tenantUsers)
        .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.isActive, 1)));
      if (memberships.length === 1) {
        req.tenantId = memberships[0].tenantId;
        req.tenantRole = memberships[0].role;
      }
      return next();
    }

    if (headerTenantId) {
      const [membership] = await db
        .select()
        .from(tenantUsers)
        .where(
          and(
            eq(tenantUsers.tenantId, headerTenantId),
            eq(tenantUsers.userId, userId)
          )
        );

      if (membership && membership.isActive) {
        req.tenantId = headerTenantId;
        req.tenantRole = membership.role;
        return next();
      }
    }

    const memberships = await db
      .select()
      .from(tenantUsers)
      .where(and(eq(tenantUsers.userId, userId), eq(tenantUsers.isActive, 1)));

    if (memberships.length === 1) {
      req.tenantId = memberships[0].tenantId;
      req.tenantRole = memberships[0].role;
    } else if (memberships.length > 1) {
      // Multi-membership (ex: tenant_admin com filiais).
      // Sem x-tenant-id explícito, escolhe a membership "principal":
      //  - prioridade 1: tenant com parentTenantId NULL (raiz)
      //  - prioridade 2: role 'admin' ou 'superadmin'
      //  - fallback: primeira membership
      const tenantIds = memberships.map((m) => m.tenantId);
      const tenantRows = tenantIds.length
        ? await db.select().from(tenants).where(inArray(tenants.id, tenantIds))
        : [];
      const tenantMap = new Map(tenantRows.map((t) => [t.id, t]));
      const rootAdmin = memberships.find((m) => {
        const t = tenantMap.get(m.tenantId);
        return t && !t.parentTenantId && (m.role === "admin" || m.role === "superadmin");
      });
      const adminAny = memberships.find((m) => m.role === "admin" || m.role === "superadmin");
      const rootAny = memberships.find((m) => {
        const t = tenantMap.get(m.tenantId);
        return t && !t.parentTenantId;
      });
      const chosen = rootAdmin ?? adminAny ?? rootAny ?? memberships[0];
      req.tenantId = chosen.tenantId;
      req.tenantRole = chosen.role;
    }

    next();
  } catch (error) {
    console.error("Error resolving tenant context:", error);
    next();
  }
}

export const requireTenant: RequestHandler = (req, res, next) => {
  if (!req.tenantId && !req.isSuperadmin) {
    const diag: Record<string, any> = { message: "Tenant context required" };
    if (process.env.NODE_ENV !== "production") {
      diag.debug = {
        authenticated: req.isAuthenticated?.() ?? false,
        hasUser: !!req.user,
        systemRole: req.systemRole,
        tenantHeader: req.headers["x-tenant-id"] ?? null,
      };
    }
    return res.status(403).json(diag);
  }
  next();
};

export const requireSuperadmin: RequestHandler = (req, res, next) => {
  if (!req.isSuperadmin) {
    return res.status(403).json({ message: "Superadmin access required" });
  }
  next();
};

export const requireTenantAdmin: RequestHandler = (req, res, next) => {
  if (req.isSuperadmin) return next();
  if (req.tenantRole === "admin" || req.tenantRole === "superadmin") return next();
  return res.status(403).json({ message: "Tenant admin access required" });
};

export const requireTenantAdminOrPartner: RequestHandler = (req, res, next) => {
  if (req.isSuperadmin) return next();
  if (req.systemRole === "partner") return next();
  if (req.tenantRole === "admin" || req.tenantRole === "superadmin") return next();
  return res.status(403).json({ message: "Tenant admin or partner access required" });
};
