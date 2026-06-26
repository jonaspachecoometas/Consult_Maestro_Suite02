import express, { type Express, type Request, type Response, type NextFunction } from "express";

export interface TestAuthState {
  tenantId: string | null;
  userId: string | null;
  tenantRole: "admin" | "tecnico" | "superadmin" | null;
  isSuperadmin?: boolean;
}

export function createTestApp(getState: () => TestAuthState, register: (app: Express) => void): Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req: any, _res: Response, next: NextFunction) => {
    const s = getState();
    req.user = s.userId
      ? { id: s.userId, dbUserId: s.userId, isLocalAuth: 1, claims: { sub: s.userId } }
      : undefined;
    req.tenantId = s.tenantId;
    req.tenantRole = s.tenantRole;
    req.isSuperadmin = !!s.isSuperadmin;
    req.isAuthenticated = () => !!s.userId;
    next();
  });
  register(app);
  return app;
}
