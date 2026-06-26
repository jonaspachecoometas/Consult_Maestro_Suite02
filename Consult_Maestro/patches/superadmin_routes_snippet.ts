// ── Superadmin: clients de um tenant específico
  app.get("/api/superadmin/tenants/:id/clients", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const clients = await storage.getAllClients(req.params.id, { allowGlobal: false });
      res.json(clients);
    } catch (error) {
      console.error("Error fetching tenant clients (superadmin):", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  // ── Superadmin: uso de IA de um tenant específico
  app.get("/api/superadmin/tenants/:id/ai-usage", isAuthenticated, requireSuperadmin, async (req: any, res) => {
    try {
      const { db } = await import("./db");
      const { aiUsageLogs } = await import("../shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const logs = await db
        .select()
        .from(aiUsageLogs)
        .where(eq(aiUsageLogs.tenantId, req.params.id))
        .orderBy(desc(aiUsageLogs.createdAt))
        .limit(100);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching AI usage (superadmin):", error);
      res.status(500).json({ message: "Failed to fetch AI usage" });
    }
  });
