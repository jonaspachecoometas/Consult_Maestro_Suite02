#!/usr/bin/env python3
"""
Arcádia Consult — Patch MT-1 estendida + Grupo C
Executa na raiz do projeto: python3 ../../patches/mt1_extended_grupo_c.py
"""

import re
import shutil
from pathlib import Path
from datetime import datetime

ROUTES = Path("server/routes.ts")
backup = ROUTES.with_suffix(f".ts.bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
shutil.copy(ROUTES, backup)
print(f"✅ Backup: {backup}")

content = ROUTES.read_text()
original_len = len(content)

# ─────────────────────────────────────────────────────────────
# PATCH 4a — Superadmin callsites: addicionando { allowGlobal: req.isSuperadmin }
# ─────────────────────────────────────────────────────────────
methods_4a = [
    "getAllClients",
    "getAllProjects",
    "getProductionProjects",
    "getAllTasks",
    "getAllCrmLeads",
    "getAllCrmOpportunities",
]

count_4a = 0
for method in methods_4a:
    pattern = re.compile(rf'(storage\.{method}\(tenantId\))(?!\s*,\s*\{{)', re.MULTILINE)
    new_content, n = pattern.subn(
        rf'storage.{method}(tenantId, {{ allowGlobal: req.isSuperadmin }})',
        content,
    )
    if n:
        content = new_content
        count_4a += n
        print(f"  4a ✅ {method}: {n} callsite(s)")

print(f"4a — Total: {count_4a} callsites\n")


# ─────────────────────────────────────────────────────────────
# PATCH 4b — Remover bloco duplicado /api/tenants (linha ~7248+)
# ─────────────────────────────────────────────────────────────
# Primeiro bloco começa em ~6864, segundo em ~7248.
# O segundo bloco (morto) vai até o fim da seção de permissions (~7760)
# depois dele vem o bloco de LLM/IA que não é duplicado.

DEAD_START = '  app.get("/api/tenants", isAuthenticated, async (req: any, res) => {'
# The dead block ends right before the next non-tenant section.
# We'll find the 2nd occurrence of DEAD_START and remove until
# the comment "// ── LLM" or "// ── AI" or we can use the permissions block end.
DEAD_END_MARKER = '\n  // ── '  # First top-level section after tenant block

# Find the FIRST occurrence (live block) — it's at a lower line
first_idx = content.find(DEAD_START)
# Find SECOND occurrence (dead block)
second_idx = content.find(DEAD_START, first_idx + 1)

if second_idx != -1:
    # Find end: the next "  // ── " section comment after second_idx
    end_idx = content.find(DEAD_END_MARKER, second_idx)
    if end_idx == -1:
        print("4b ⚠️  Não encontrou fim do bloco morto — pulando")
    else:
        removed_chunk = content[second_idx:end_idx]
        lines_removed = removed_chunk.count('\n')
        content = content[:second_idx] + content[end_idx:]
        print(f"4b ✅ Bloco duplicado removido: {lines_removed} linhas\n")
else:
    print("4b ⚠️  Segunda ocorrência de GET /api/tenants não encontrada — bloco já removido?\n")


# ─────────────────────────────────────────────────────────────
# PATCH 4c — Injetar requireTenant / requireSuperadmin / requireTenantAdmin
# ─────────────────────────────────────────────────────────────
skip_paths = [
    '/api/auth', '/api/login', '/api/callback', '/api/logout',
    '/api/health', '/api/invite', '/api/onboarding', '/api/profile',
    '/api/objects', '/api/superadmin', '/api/partner', '/api/portal',
    '/api/mcp', '/api/oauth', '/api/ia', '/api/admin',
]

# Simple line-by-line injection approach — more reliable than regex groups
lines = content.split('\n')
new_lines = []
count_tenant = 0
count_super = 0
count_skip = 0

# Patterns for route declarations
route_re = re.compile(
    r'^(\s*app\.(get|post|patch|put|delete)\s*\(\s*["\'])(/api/[^"\']+)(["\'],\s*)(isAuthenticated\s*,\s*)(async\b.*)',
)

for line in lines:
    m = route_re.match(line)
    if m:
        indent_method = m.group(1)
        http_method   = m.group(2)
        path          = m.group(3)
        quote_comma   = m.group(4)
        is_auth       = m.group(5)
        rest          = m.group(6)

        # Already has a guard?
        already = ('requireTenant' in line or 'requireSuperadmin' in line
                   or 'requireTenantAdmin' in line or 'requireTenantAdminOrPartner' in line)
        
        should_skip = any(path.startswith(p) for p in skip_paths)
        
        if already or should_skip:
            count_skip += 1
            new_lines.append(line)
            continue

        # Decide guard
        if path.startswith('/api/users/') or path == '/api/users':
            guard = 'requireSuperadmin, '
            count_super += 1
        elif path.startswith('/api/tenants/') or path == '/api/tenants':
            guard = 'requireTenantAdmin, '
            count_super += 1
        else:
            guard = 'requireTenant, '
            count_tenant += 1

        new_line = f"{indent_method}{path}{quote_comma}{is_auth}{guard}{rest}"
        new_lines.append(new_line)
    else:
        new_lines.append(line)

content = '\n'.join(new_lines)

print(f"4c ✅ requireTenant injetado em {count_tenant} rotas de domínio")
print(f"4c ✅ requireSuperadmin/TenantAdmin em {count_super} rotas de admin")
print(f"4c    Puladas: {count_skip}\n")


# ─────────────────────────────────────────────────────────────
# Gravar
# ─────────────────────────────────────────────────────────────
ROUTES.write_text(content)
delta = len(content) - original_len
print(f"✅ Arquivo gravado. Delta: {delta:+d} bytes")

# Sanity check
remaining = content.count('), isAuthenticated, async ')
print(f"   'isAuthenticated, async' sem guard restante: {remaining}")
print(f"\n✅ Patch concluído. Execute: npm run dev  (ou reiniciar no Replit)")
