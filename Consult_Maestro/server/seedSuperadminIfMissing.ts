import { db } from "./db";
import { users, partners, tenants, tenantUsers } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

const DEFAULT_PASSWORD = "123456";

interface SeedUserSpec {
  email: string;
  firstName: string;
  lastName?: string | null;
  role: "superadmin" | "admin" | "gerente" | "tecnico";
  systemRole: "superadmin" | "partner" | "tenant_admin" | "user";
}

const SEED_USERS: SeedUserSpec[] = [
  { email: "a@a.com.br",            firstName: "Admin",   lastName: null,        role: "superadmin", systemRole: "superadmin" },
  { email: "partner@arcadia.test",  firstName: "Partner", lastName: "Arcádia",   role: "admin",      systemRole: "partner" },
  { email: "admin@arcadia.test",    firstName: "Admin",   lastName: "Tenant",    role: "admin",      systemRole: "tenant_admin" },
  { email: "gerente@arcadia.test",  firstName: "Gerente", lastName: "Demo",      role: "gerente",    systemRole: "user" },
  { email: "user@arcadia.test",     firstName: "Usuário", lastName: "Demo",      role: "tecnico",    systemRole: "user" },
];

const PARTNER_SLUG = "arcadia-consulting";
const TENANT_SLUG  = "arcadia-demo";

/**
 * Garante usuários padrão para teste em cada nível de hierarquia.
 * Todos com senha `123456`. Substitua os e-mails na publicação se quiser
 * vincular aos endereços reais da Arcádia.
 *
 *   superadmin     → a@a.com.br
 *   partner        → partner@arcadia.test  (vinculado ao partner "Arcádia Consulting")
 *   tenant_admin   → admin@arcadia.test    (admin do tenant "Arcádia Demo")
 *   user           → user@arcadia.test     (membro do tenant "Arcádia Demo")
 */
export async function seedSuperadminIfMissing(): Promise<void> {
  try {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const userIds: Record<string, string> = {};

    for (const spec of SEED_USERS) {
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, spec.email))
        .limit(1);

      if (existing) {
        userIds[spec.email] = existing.id;
        console.log(`[seed:users] ${spec.email} (${spec.systemRole}) already exists — skipping`);
        continue;
      }

      const [created] = await db
        .insert(users)
        .values({
          email: spec.email,
          passwordHash,
          firstName: spec.firstName,
          lastName: spec.lastName ?? null,
          role: spec.role,
          systemRole: spec.systemRole,
          isLocalAuth: 1,
          isActive: 1,
        })
        .returning({ id: users.id });

      userIds[spec.email] = created.id;
      console.log(`[seed:users] created ${spec.email} as ${spec.systemRole} (password: ${DEFAULT_PASSWORD})`);
    }

    // ── Partner "Arcádia Consulting" vinculado ao user partner@arcadia.test ──
    const partnerUserId = userIds["partner@arcadia.test"];
    let partnerId: string | null = null;
    if (partnerUserId) {
      const [existingPartner] = await db
        .select({ id: partners.id })
        .from(partners)
        .where(eq(partners.slug, PARTNER_SLUG))
        .limit(1);
      if (existingPartner) {
        partnerId = existingPartner.id;
      } else {
        const [created] = await db
          .insert(partners)
          .values({
            name: "Arcádia Consulting",
            slug: PARTNER_SLUG,
            email: "partner@arcadia.test",
            plan: "professional",
            status: "active",
            isActive: 1,
            userId: partnerUserId,
          })
          .returning({ id: partners.id });
        partnerId = created.id;
        console.log(`[seed:partner] created "Arcádia Consulting" (${PARTNER_SLUG})`);
      }
      // Vincula partnerId no user partner (se ainda não vinculado)
      await db.update(users).set({ partnerId }).where(eq(users.id, partnerUserId));
    }

    // ── Tenant "Arcádia Demo" sob o partner ──
    const superadminUserId = userIds["a@a.com.br"];
    const partnerMemberUserId = userIds["partner@arcadia.test"];
    const tenantAdminUserId = userIds["admin@arcadia.test"];
    const tenantManagerUserId = userIds["gerente@arcadia.test"];
    const tenantMemberUserId = userIds["user@arcadia.test"];
    let tenantId: string | null = null;
    const [existingTenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, TENANT_SLUG))
      .limit(1);
    if (existingTenant) {
      tenantId = existingTenant.id;
    } else {
      const [created] = await db
        .insert(tenants)
        .values({
          name: "Arcádia Demo",
          slug: TENANT_SLUG,
          sector: "Consultoria",
          plan: "professional",
          status: "active",
          partnerId: partnerId ?? undefined,
          adminEmail: "admin@arcadia.test",
          isActive: 1,
        })
        .returning({ id: tenants.id });
      tenantId = created.id;
      console.log(`[seed:tenant] created "Arcádia Demo" (${TENANT_SLUG})`);
    }

    // ── Memberships (tenant_users) ──
    if (tenantId) {
      const memberships: Array<{ userId: string; role: "admin" | "gerente" | "tecnico" }> = [];
      // Superadmin e partner também ganham membership no tenant demo para
      // conseguirem ENTRAR e USAR o tenant (TenantSwitcher / features tenant-scoped).
      if (superadminUserId) memberships.push({ userId: superadminUserId, role: "admin" });
      if (partnerMemberUserId) memberships.push({ userId: partnerMemberUserId, role: "admin" });
      if (tenantAdminUserId) memberships.push({ userId: tenantAdminUserId, role: "admin" });
      if (tenantManagerUserId) memberships.push({ userId: tenantManagerUserId, role: "gerente" });
      if (tenantMemberUserId) memberships.push({ userId: tenantMemberUserId, role: "tecnico" });

      for (const m of memberships) {
        const [existingTu] = await db
          .select({ id: tenantUsers.id })
          .from(tenantUsers)
          .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.userId, m.userId)))
          .limit(1);
        if (existingTu) continue;
        await db.insert(tenantUsers).values({
          tenantId,
          userId: m.userId,
          role: m.role,
          isActive: 1,
        });
        console.log(`[seed:tenant_users] vinculou user ${m.userId} ao tenant ${TENANT_SLUG} como ${m.role}`);
      }
    }
  } catch (err) {
    console.error("[seed:users] failed:", err);
  }
}
