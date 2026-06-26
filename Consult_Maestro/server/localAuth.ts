import bcrypt from "bcryptjs";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express } from "express";
import { storage } from "./storage";
import type { TenantInvitation } from "@shared/schema";

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function setupLocalAuth(app: Express) {
  passport.use(
    "local",
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          
          if (!user) {
            return done(null, false, { message: "Email ou senha incorretos" });
          }
          
          if (!user.isLocalAuth || !user.passwordHash) {
            return done(null, false, { message: "Esta conta usa autenticacao SSO. Use o botao 'Entrar com SSO'." });
          }
          
          if (!user.isActive) {
            return done(null, false, { message: "Conta desativada. Entre em contato com o administrador." });
          }
          
          const isValid = await verifyPassword(password, user.passwordHash);
          
          if (!isValid) {
            return done(null, false, { message: "Email ou senha incorretos" });
          }
          
          await storage.updateUserLoginTime(user.id);
          
          return done(null, {
            claims: { sub: user.id },
            id: user.id,
            isLocalAuth: true,
          });
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Erro interno do servidor" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Credenciais invalidas" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: "Erro ao fazer login" });
        }
        return res.json({ success: true, message: "Login realizado com sucesso" });
      });
    })(req, res, next);
  });

  // Registration supports three paths:
  // 1. invitationToken — user accepts a specific tenant invitation
  // 2. tenant_id — user registers directly into a specified tenant (requires valid tenant)
  // 3. bootstrap — first user only, creates superadmin without tenant
  app.post("/api/auth/register", async (req, res) => {
    try {
      // Note: tenantRole from body is intentionally ignored — roles are assigned by invitation record or defaulted to tecnico.
      const { email, password, firstName, lastName, invitationToken, tenantId } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ message: "Email e senha sao obrigatorios" });
      }
      
      if (password.length < 6) {
        return res.status(400).json({ message: "A senha deve ter pelo menos 6 caracteres" });
      }

      let invitation: TenantInvitation | null = null;
      let targetTenantId: string | null = null;
      // Never allow public registration to self-assign elevated roles.
      // The `tenantRole` body field is intentionally ignored for direct tenantId path.
      // For invitation path, role comes from the invitation record (set by an admin).
      // For admin-created users, use the /api/admin/users endpoint instead.

      if (invitationToken) {
        // Path 1: invitation token flow
        invitation = await storage.getTenantInvitationByToken(invitationToken);
        if (!invitation) {
          return res.status(400).json({ message: "Convite invalido ou expirado" });
        }
        if (invitation.expiresAt && new Date() > new Date(invitation.expiresAt)) {
          return res.status(400).json({ message: "Convite expirado" });
        }
        if (invitation.acceptedAt) {
          return res.status(400).json({ message: "Convite ja utilizado" });
        }
        if (invitation.email && invitation.email.toLowerCase() !== email.toLowerCase()) {
          return res.status(400).json({ message: "Este convite foi enviado para outro email" });
        }
      } else if (tenantId) {
        // Path 2: direct tenant_id registration (tenant must exist)
        const tenant = await storage.getTenant(tenantId);
        if (!tenant || !tenant.isActive) {
          return res.status(400).json({ message: "Workspace invalido ou inativo" });
        }
        targetTenantId = tenantId;
      } else {
        // Path 3: bootstrap — only the first user can register without invitation
        const allUsers = await storage.getAllUsers();
        if (allUsers.length > 0) {
          return res.status(403).json({ message: "Registro publico desabilitado. Use um convite para criar sua conta." });
        }
      }
      
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(409).json({ message: "Este email ja esta cadastrado" });
      }
      
      const passwordHash = await hashPassword(password);
      
      // Bootstrap path (first user) automatically becomes superadmin
      const isBootstrap = !invitation && !targetTenantId;
      const user = await storage.createLocalUser({
        email,
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        role: isBootstrap ? "superadmin" : undefined,
        isLocalAuth: 1,
        isActive: 1,
      });

      if (invitation) {
        await storage.acceptTenantInvitation(invitationToken, user.id);
      } else if (targetTenantId) {
        // Force lowest privilege for self-registration via direct tenantId path
        await storage.addTenantUser({
          tenantId: targetTenantId,
          userId: user.id,
          role: 'tecnico',
          isActive: 1,
        });
      }
      
      req.login(
        {
          claims: { sub: user.id },
          id: user.id,
          isLocalAuth: true,
        },
        (loginErr) => {
          if (loginErr) {
            return res.status(500).json({ message: "Usuario criado, mas erro ao fazer login" });
          }
          return res.status(201).json({ success: true, message: "Conta criada com sucesso" });
        }
      );
    } catch (error) {
      console.error("Error registering user:", error);
      return res.status(500).json({ message: "Erro ao criar conta" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.json({ success: true, message: "Logout realizado com sucesso" });
      });
    });
  });

  // GET logout — redirect-friendly (used by sidebar <a href> links)
  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy(() => {
        res.redirect("/");
      });
    });
  });
}
