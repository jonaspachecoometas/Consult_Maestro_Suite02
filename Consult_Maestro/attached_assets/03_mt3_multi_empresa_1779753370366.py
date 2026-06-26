#!/usr/bin/env python3
"""
Patch 03 — MT-3: Multi-empresa (client_companies)
Executa na raiz do projeto: python3 patches/03_mt3_multi_empresa.py

O que faz:
  - Adiciona tabela client_companies em shared/schema.ts
  - Adiciona CRUD em server/storage.ts
  - Adiciona rotas /api/clients/:clientId/companies em server/routes.ts
  - Cria página client/src/pages/configuracoes/Empresas.tsx
  - Cria componente ClientCompaniesPanel.tsx
"""

import shutil
from pathlib import Path
from datetime import datetime

ROOT = Path(".")

def backup(p: Path):
    b = p.with_suffix(f"{p.suffix}.bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    shutil.copy(p, b)
    print(f"  backup: {b.name}")

def patch(p: Path, find: str, replace: str, label: str):
    content = p.read_text()
    if find not in content:
        print(f"  ⚠️  {label}: trecho não encontrado — pulando")
        return False
    p.write_text(content.replace(find, replace, 1))
    print(f"  ✅ {label}")
    return True

def write(p: Path, content: str):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    print(f"  ✅ criado: {p}")

# ─────────────────────────────────────────────────────────────
# 1. shared/schema.ts — adicionar tabela client_companies
# ─────────────────────────────────────────────────────────────
SCHEMA = ROOT / "shared/schema.ts"
backup(SCHEMA)

# Inserir após a tabela clients (depois da linha de createdAt/updatedAt de clients)
# Buscamos o fim da definição de clients
SCHEMA_INSERT_AFTER = """  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Projects table"""

CLIENT_COMPANIES_TABLE = """  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Client Companies — empresas-filial de um cliente (holdings, multi-CNPJ)
// Um client pode ter N clientCompanies (matriz + filiais).
// Control, Societário, RH são vinculados a uma clientCompany específica.
export const clientCompanies = pgTable("client_companies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  cnpj: varchar("cnpj", { length: 18 }),
  razaoSocial: varchar("razao_social", { length: 255 }).notNull(),
  nomeFantasia: varchar("nome_fantasia", { length: 255 }),
  tipo: varchar("tipo", { length: 20 }).default("matriz"), // matriz | filial | coligada | controlada
  regimeTributario: varchar("regime_tributario", { length: 50 }), // simples | lucro_presumido | lucro_real
  inscricaoEstadual: varchar("inscricao_estadual", { length: 30 }),
  inscricaoMunicipal: varchar("inscricao_municipal", { length: 30 }),
  endereco: text("endereco"),
  cidade: varchar("cidade", { length: 100 }),
  estado: varchar("estado", { length: 2 }),
  isActive: integer("is_active").default(1).notNull(),
  settings: jsonb("settings").$type<Record<string, any>>().default({}),
  createdById: varchar("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  idxTenantClient: index("idx_cc_tenant_client").on(t.tenantId, t.clientId),
  idxCnpj: index("idx_cc_cnpj").on(t.cnpj),
}));

export const insertClientCompanySchema = createInsertSchema(clientCompanies).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type ClientCompany = typeof clientCompanies.$inferSelect;
export type InsertClientCompany = z.infer<typeof insertClientCompanySchema>;

// Projects table"""

patch(SCHEMA, SCHEMA_INSERT_AFTER, CLIENT_COMPANIES_TABLE, "shared/schema.ts: client_companies table")

# ─────────────────────────────────────────────────────────────
# 2. server/storage.ts — CRUD methods
# ─────────────────────────────────────────────────────────────
STORAGE = ROOT / "server/storage.ts"
backup(STORAGE)

# Add import
patch(STORAGE,
    'type Client,\n  type InsertClient,',
    'type Client,\n  type InsertClient,\n  clientCompanies,\n  type ClientCompany,\n  type InsertClientCompany,\n  insertClientCompanySchema,',
    "storage.ts: import client_companies types")

# Add interface methods
patch(STORAGE,
    '  createClient(client: InsertClient): Promise<Client>;',
    '''  createClient(client: InsertClient): Promise<Client>;
  // ClientCompanies
  getClientCompanies(clientId: string, tenantId: string): Promise<ClientCompany[]>;
  getClientCompany(id: string): Promise<ClientCompany | undefined>;
  createClientCompany(data: InsertClientCompany): Promise<ClientCompany>;
  updateClientCompany(id: string, data: Partial<InsertClientCompany>): Promise<ClientCompany | undefined>;
  deleteClientCompany(id: string): Promise<boolean>;''',
    "storage.ts: interface methods")

# Add implementation (after createClient implementation)
patch(STORAGE,
    '''  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }''',
    '''  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async getClientCompanies(clientId: string, tenantId: string): Promise<ClientCompany[]> {
    return db.select().from(clientCompanies)
      .where(and(eq(clientCompanies.clientId, clientId), eq(clientCompanies.tenantId, tenantId)))
      .orderBy(clientCompanies.tipo, clientCompanies.razaoSocial);
  }

  async getClientCompany(id: string): Promise<ClientCompany | undefined> {
    const [row] = await db.select().from(clientCompanies).where(eq(clientCompanies.id, id));
    return row;
  }

  async createClientCompany(data: InsertClientCompany): Promise<ClientCompany> {
    const [row] = await db.insert(clientCompanies).values(data).returning();
    return row;
  }

  async updateClientCompany(id: string, data: Partial<InsertClientCompany>): Promise<ClientCompany | undefined> {
    const [row] = await db.update(clientCompanies)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(clientCompanies.id, id))
      .returning();
    return row;
  }

  async deleteClientCompany(id: string): Promise<boolean> {
    const result = await db.delete(clientCompanies).where(eq(clientCompanies.id, id));
    return (result.rowCount ?? 0) > 0;
  }''',
    "storage.ts: CRUD implementations")

# ─────────────────────────────────────────────────────────────
# 3. server/routes.ts — rotas /api/clients/:clientId/companies
# ─────────────────────────────────────────────────────────────
ROUTES = ROOT / "server/routes.ts"

# Find a good insertion point: after the DELETE /api/clients/:id handler
ROUTES_INSERT_AFTER = """  app.delete("/api/clients/:id", isAuthenticated, requireTenant, async (req: any, res) => {"""

COMPANIES_ROUTES = """  // ── Client Companies (multi-empresa / holdings)
  app.get("/api/clients/:clientId/companies", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const companies = await storage.getClientCompanies(req.params.clientId, req.tenantId!);
      res.json(companies);
    } catch (error) {
      console.error("Error fetching client companies:", error);
      res.status(500).json({ message: "Failed to fetch companies" });
    }
  });

  app.post("/api/clients/:clientId/companies", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const company = await storage.createClientCompany({
        ...req.body,
        clientId: req.params.clientId,
        tenantId: req.tenantId!,
        createdById: req.user?.id,
      });
      res.status(201).json(company);
    } catch (error) {
      console.error("Error creating client company:", error);
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.patch("/api/client-companies/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getClientCompany(req.params.id);
      if (!existing || existing.tenantId !== req.tenantId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const updated = await storage.updateClientCompany(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      console.error("Error updating client company:", error);
      res.status(500).json({ message: "Failed to update company" });
    }
  });

  app.delete("/api/client-companies/:id", isAuthenticated, requireTenant, async (req: any, res) => {
    try {
      const existing = await storage.getClientCompany(req.params.id);
      if (!existing || existing.tenantId !== req.tenantId) {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteClientCompany(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting client company:", error);
      res.status(500).json({ message: "Failed to delete company" });
    }
  });

  app.delete("/api/clients/:id", isAuthenticated, requireTenant, async (req: any, res) => {"""

patch(ROUTES, ROUTES_INSERT_AFTER, COMPANIES_ROUTES, "routes.ts: client companies routes")

# ─────────────────────────────────────────────────────────────
# 4. Frontend — ClientCompaniesPanel.tsx
# ─────────────────────────────────────────────────────────────
write(ROOT / "client/src/components/ClientCompaniesPanel.tsx", '''\
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Building2, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import type { ClientCompany } from "@shared/schema";

const TIPOS = [
  { value: "matriz", label: "Matriz" },
  { value: "filial", label: "Filial" },
  { value: "coligada", label: "Coligada" },
  { value: "controlada", label: "Controlada" },
];

const REGIMES = [
  { value: "simples", label: "Simples Nacional" },
  { value: "lucro_presumido", label: "Lucro Presumido" },
  { value: "lucro_real", label: "Lucro Real" },
];

function CompanyForm({ clientId, initial, onSave, onCancel }: {
  clientId: string;
  initial?: Partial<ClientCompany>;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    razaoSocial: initial?.razaoSocial ?? "",
    nomeFantasia: initial?.nomeFantasia ?? "",
    cnpj: initial?.cnpj ?? "",
    tipo: initial?.tipo ?? "filial",
    regimeTributario: initial?.regimeTributario ?? "",
    cidade: initial?.cidade ?? "",
    estado: initial?.estado ?? "",
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Razão Social *</label>
          <Input value={form.razaoSocial} onChange={e => setForm(f => ({ ...f, razaoSocial: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Nome Fantasia</label>
          <Input value={form.nomeFantasia} onChange={e => setForm(f => ({ ...f, nomeFantasia: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">CNPJ</label>
          <Input placeholder="00.000.000/0000-00" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Tipo</label>
          <Select value={form.tipo} onValueChange={v => setForm(f => ({ ...f, tipo: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Regime tributário</label>
          <Select value={form.regimeTributario} onValueChange={v => setForm(f => ({ ...f, regimeTributario: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>{REGIMES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Cidade</label>
          <Input value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">UF</label>
          <Input maxLength={2} className="uppercase" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value.toUpperCase() }))} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={() => onSave(form)} disabled={!form.razaoSocial}>Salvar</Button>
      </div>
    </div>
  );
}

export function ClientCompaniesPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientCompany | null>(null);

  const { data: companies = [], isLoading } = useQuery<ClientCompany[]>({
    queryKey: [`/api/clients/${clientId}/companies`],
    enabled: !!clientId,
  });

  const createMut = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/clients/${clientId}/companies`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/clients/${clientId}/companies`] }); setOpen(false); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/client-companies/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/clients/${clientId}/companies`] }); setEditing(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/client-companies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/clients/${clientId}/companies`] }),
  });

  const tipoLabel = (t: string) => TIPOS.find(x => x.value === t)?.label ?? t;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Empresas do grupo ({companies.length})
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1">
              <Plus className="h-3.5 w-3.5" /> Adicionar empresa
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova empresa do grupo</DialogTitle></DialogHeader>
            <CompanyForm clientId={clientId} onSave={d => createMut.mutate(d)} onCancel={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma empresa cadastrada. Use "Adicionar empresa" para registrar filiais/coligadas.
          </p>
        ) : (
          companies.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 rounded border hover:bg-muted/40">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{c.nomeFantasia || c.razaoSocial}</p>
                  <p className="text-xs text-muted-foreground">{c.cnpj ? `CNPJ: ${c.cnpj}` : c.razaoSocial}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs">{tipoLabel(c.tipo || 'filial')}</Badge>
                <Dialog open={editing?.id === c.id} onOpenChange={o => !o && setEditing(null)}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditing(c)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Editar empresa</DialogTitle></DialogHeader>
                    {editing && (
                      <CompanyForm
                        clientId={clientId}
                        initial={editing}
                        onSave={d => updateMut.mutate({ id: editing.id, data: d })}
                        onCancel={() => setEditing(null)}
                      />
                    )}
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => { if (confirm('Remover esta empresa?')) deleteMut.mutate(c.id); }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
''')

print()
print("✅ Patch 03 (MT-3 multi-empresa) aplicado.")
print("   Arquivos criados/modificados:")
print("   - shared/schema.ts: tabela client_companies")
print("   - server/storage.ts: CRUD getClientCompanies/create/update/delete")
print("   - server/routes.ts: rotas /api/clients/:clientId/companies e /api/client-companies/:id")
print("   - client/src/components/ClientCompaniesPanel.tsx: componente completo")
print()
print("   ⚠️  Adicionar <ClientCompaniesPanel clientId={client.id} /> na página de detalhe do cliente")
print("   ⚠️  Banco: runStartupMigrations() vai criar a tabela client_companies automaticamente no restart")
