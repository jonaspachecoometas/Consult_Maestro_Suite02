# BCPrimeNEXT — Documentação Técnica
### Funcionalidades da Plataforma e Requisitos de Servidor

---

## 1. VISÃO GERAL DO PROJETO

**BCPrimeNEXT** é uma plataforma digital de contabilidade e gestão empresarial desenvolvida para a BCPrime, escritório de contabilidade sediado em Pinhais/PR. A plataforma combina contabilidade digital, ERP integrado, consultoria tributária e automação inteligente gerenciada pela **IA Maestro**.

| Dado | Valor |
|---|---|
| Tipo | Aplicação Web Full-Stack |
| Público | Empresas do Simples Nacional, MEI, Lucro Presumido e Lucro Real |
| Idioma | Português Brasileiro |
| Contato | sales@bcprimeon.com · (41) 3403-2089 · WhatsApp (41) 9 8511-7177 |
| Endereço | Av. Camilo di Lellis, 633, Salas 45/47 — Pinhais/PR |

---

## 2. STACK TECNOLÓGICA

### Frontend
| Tecnologia | Versão | Finalidade |
|---|---|---|
| React | 18 | Interface do usuário |
| TypeScript | 5+ | Tipagem estática |
| Vite | 5+ | Build e HMR em desenvolvimento |
| Tailwind CSS | 3 | Estilização utilitária |
| shadcn/ui + Radix UI | — | Componentes de interface acessíveis |
| TanStack React Query | 5 | Gerenciamento de estado e cache de API |
| Wouter | — | Roteamento leve no cliente |
| React Hook Form + Zod | — | Formulários com validação |
| Tiptap | — | Editor de texto rico (blog/admin) |
| Lucide React | — | Biblioteca de ícones |
| Embla Carousel | — | Carrossel de conteúdo |

### Backend
| Tecnologia | Versão | Finalidade |
|---|---|---|
| Node.js | 20+ | Runtime do servidor |
| Express | 5 | Framework HTTP |
| TypeScript + tsx | — | Execução em desenvolvimento |
| Drizzle ORM | — | ORM e migrations do banco |
| Passport.js (Local) | — | Autenticação de sessão |
| express-session | — | Gerenciamento de sessões |
| connect-pg-simple | — | Armazenamento de sessões no PostgreSQL |
| Multer | — | Upload de imagens |

### Banco de Dados
| Tecnologia | Finalidade |
|---|---|
| PostgreSQL | Banco de dados principal |
| Drizzle Kit | Migrations e push de schema |

### Integrações de IA
| Provedor | Finalidade |
|---|---|
| OpenAI (GPT) | Chat e geração de conteúdo (opcional) |
| Google Gemini | Alternativa ao OpenAI (opcional) |
| Anthropic Claude | Suporte alternativo (opcional) |
| Ollama | IA local/self-hosted (opcional) |
| Kimi (Moonshot) | Suporte alternativo (opcional) |

---

## 3. FUNCIONALIDADES DA PLATAFORMA

### 3.1 Páginas Públicas

#### Home (`/`)
- Hero section com headline de IA e automação
- Seção de estatísticas (15+ anos de experiência, 300+ clientes)
- Cards dos 4 serviços (Balance, Finance, Tax, Start)
- Seção "Por que a BCPrimeNEXT?" (4 diferenciais com IA Maestro)
- Seção "Como Funciona a IA Maestro" (4 etapas)
- Soluções por tipo de empresa (MEI, Simples, Lucro Presumido, Lucro Real)
- Benefícios organizados em 3 categorias
- Depoimentos de clientes
- Garantias e Certificações (ISO 27001, LGPD, etc.)
- CTA final com botões de conversão

#### Serviços
| Página | URL | Serviço |
|---|---|---|
| Contabilidade Digital | `/contabilidade-digital` | Balance-NEXT |
| Consultoria Financeira | `/consultoria-financeira` | Finance-NEXT |
| Consultoria Tributária | `/consultoria-tributaria` | Tax-NEXT |
| Abertura de Empresa | `/abrir-empresa` | Start-NEXT |
| Desenquadramento MEI | `/desenquadramento-mei` | Serviço complementar |

Todas as páginas de serviço incluem:
- Hero com headline e descrição do serviço
- Cards com funcionalidades incluídas
- **ServicePricingCard dinâmico** — puxa preço do plano mais barato direto do banco
- Seção de benefícios específicos
- CTA para contato e para a página de planos

#### Planos e Preços (`/planos-e-precos`)
- Listagem de planos gerenciados pelo admin
- Comparativo de funcionalidades
- Botões de CTA por plano

#### Blog (`/blog`, `/blog/:slug`)
- Listagem de artigos com filtro por categoria
- Páginas individuais de posts com SEO completo
- Meta tags (og:image, description, keywords)

#### Páginas Institucionais
| Página | URL |
|---|---|
| Sobre Nós | `/sobre-nos` |
| Contato + formulário de lead | `/contato` |
| Área do Cliente | `/area-cliente` |
| Páginas dinâmicas (CMS) | `/p/:slug` |

#### Redirecionamentos de Marketing (`/r/:slug`)
- URLs curtas gerenciadas pelo admin
- Ideal para campanhas e links de WhatsApp

---

### 3.2 Painel Administrativo (`/admin/*`)

Acesso protegido por autenticação (usuário: `admin`).

| Seção | URL | Funcionalidade |
|---|---|---|
| Dashboard | `/admin` | Resumo de leads, posts, métricas |
| Leads | `/admin/leads` | Visualizar e gerenciar contatos recebidos |
| Blog — Listagem | `/admin/posts` | Gerenciar todos os artigos |
| Blog — Criar/Editar | `/admin/posts/new`, `/admin/posts/:id` | Editor rico com TipTap, SEO, upload de imagem |
| Planos | `/admin/plans` | CRUD de planos e preços (reflete em todo o site) |
| Equipe | `/admin/team` | Gerenciar membros e ordem de exibição |
| Redirects | `/admin/redirects` | Criar URLs curtas de marketing |
| Page Builder | `/admin/pages` | Criar páginas personalizadas com blocos |
| Editor de Página | `/admin/pages/:id` | Editar blocos de conteúdo |
| IA Maestro — Chat | `/admin/ai-chat` | Chat com a IA para geração de conteúdo |
| IA Maestro — Config | `/admin/ai-settings` | Configurar provedor e chave de API da IA |

---

### 3.3 API REST (Rotas do Servidor)

#### Rotas Públicas
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/plans` | Lista planos ativos ordenados |
| GET | `/api/blog/posts` | Lista posts publicados |
| GET | `/api/blog/posts/:slug` | Post individual por slug |
| GET | `/api/pages/:slug` | Página dinâmica por slug |
| GET | `/api/team` | Lista membros da equipe |
| POST | `/api/leads` | Submissão de formulário de contato |
| GET | `/r/:slug` | Redireciona para URL cadastrada |

#### Rotas Administrativas (autenticadas)
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/admin/login` | Login do admin |
| POST | `/api/admin/logout` | Logout |
| GET | `/api/admin/stats` | Métricas do dashboard |
| POST | `/api/admin/upload` | Upload de imagens (multipart) |
| GET/POST/PATCH/DELETE | `/api/admin/posts` | CRUD de posts |
| GET/POST/PATCH/DELETE | `/api/admin/leads` | CRUD de leads |
| GET/POST/PATCH/DELETE | `/api/admin/plans` | CRUD de planos |
| GET/POST/PATCH/DELETE | `/api/admin/team` | CRUD de equipe |
| GET/POST/PATCH/DELETE | `/api/admin/redirects` | CRUD de redirects |
| GET/POST/PATCH/DELETE | `/api/admin/pages` | CRUD de páginas |
| GET/POST/PATCH/DELETE | `/api/admin/ai-settings` | Configurações de IA |
| POST | `/api/admin/ai-chat` | Proxy para chat com IA |

---

### 3.4 Banco de Dados — Tabelas

| Tabela | Descrição |
|---|---|
| `users` | Credenciais de acesso admin |
| `leads` | Contatos capturados via formulário |
| `blog_posts` | Artigos do blog com SEO completo |
| `team_members` | Perfis da equipe com ordem de exibição |
| `plans` | Planos e preços com features em JSON |
| `redirects` | Mapeamento slug → URL de destino |
| `pages` | Páginas customizadas do CMS |
| `page_blocks` | Blocos de conteúdo das páginas |
| `ai_settings` | Provedor de IA e chave de API (criptografada) |
| `seo_keywords` | Palavras-chave monitoradas para SEO |

---

## 4. REQUISITOS DE SERVIDOR

### 4.1 Requisitos Mínimos (Desenvolvimento / Staging)

| Recurso | Mínimo | Recomendado |
|---|---|---|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disco | 5 GB SSD | 10 GB SSD |
| Node.js | 20 LTS | 20 LTS (ou 22 LTS) |
| PostgreSQL | 14+ | 15+ |
| Sistema Operacional | Ubuntu 22.04 / Debian 12 | Ubuntu 22.04 LTS |

### 4.2 Requisitos Recomendados (Produção)

| Recurso | Valor |
|---|---|
| CPU | 2–4 vCPU |
| RAM | 4 GB |
| Disco | 20 GB SSD (com crescimento para uploads) |
| Banco de Dados | PostgreSQL gerenciado (RDS, Supabase, Neon, etc.) |
| CDN | Recomendado para assets estáticos |
| SSL/TLS | Obrigatório (Let's Encrypt ou certificado pago) |
| Porta | 5000 (padrão) ou variável `PORT` |

### 4.3 Variáveis de Ambiente Obrigatórias

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ Sim | String de conexão PostgreSQL (`postgres://user:pass@host:5432/db`) |
| `SESSION_SECRET` | ✅ Sim | Chave secreta para assinar cookies de sessão (mín. 32 chars) |
| `NODE_ENV` | Recomendada | `production` em produção, `development` em dev |
| `PORT` | Opcional | Porta do servidor (padrão: 5000) |

#### Variáveis Opcionais (configuradas pelo admin via UI)
As chaves de IA são salvas no banco via painel `/admin/ai-settings`:
- Chave OpenAI (GPT)
- Chave Google Gemini
- Chave Anthropic Claude
- URL do Ollama (self-hosted)

### 4.4 Armazenamento de Arquivos

| Diretório | Finalidade | Observação |
|---|---|---|
| `/uploads` | Imagens enviadas pelo admin | Servido estaticamente em `/uploads/*` |
| `/dist/public` | Build do frontend (produção) | Gerado por `npm run build` |

> **Atenção em produção:** O diretório `/uploads` deve ser persistente. Em ambientes com deploy efêmero (containers sem volume), configure um storage externo (ex: AWS S3, Cloudflare R2) e adapte a rota de upload.

---

## 5. COMANDOS ESSENCIAIS

```bash
# Instalar dependências
npm install

# Desenvolvimento (servidor + frontend com HMR)
npm run dev

# Push do schema para o banco (migrations)
npm run db:push

# Build de produção
npm run build

# Iniciar em produção
npm run start
```

---

## 6. DEPLOY — PROCESSO RECOMENDADO

### Opção A: Replit (atual)
- Ambiente já configurado com PostgreSQL integrado
- Deploy via botão "Publish" (gera domínio `.replit.app`)
- Variáveis de ambiente gerenciadas no painel Replit Secrets

### Opção B: VPS / Cloud (Ubuntu)
```bash
# 1. Clonar repositório
git clone <repositorio> /var/www/bcprimenext

# 2. Instalar dependências
cd /var/www/bcprimenext && npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env  # editar DATABASE_URL e SESSION_SECRET

# 4. Executar migrations
npm run db:push

# 5. Build de produção
npm run build

# 6. Iniciar com PM2 (gerenciador de processos)
pm2 start npm --name "bcprimenext" -- run start
pm2 save && pm2 startup
```

### Opção C: Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 5000
CMD ["npm", "run", "start"]
```

---

## 7. SEGURANÇA E CONFORMIDADE

| Item | Status | Detalhe |
|---|---|---|
| Autenticação | ✅ | Passport.js com sessão e cookie seguro |
| Proteção de rotas admin | ✅ | Middleware de autenticação em todas as rotas `/api/admin/*` |
| Validação de dados | ✅ | Zod + drizzle-zod em todas as entradas |
| Upload de arquivos | ✅ | Restrição de tipo (jpg, png, gif, webp, svg) e tamanho (5 MB) |
| Variáveis sensíveis | ✅ | Secrets via variáveis de ambiente, nunca no código |
| LGPD | ⚠️ Parcial | Leads armazenados com consentimento implícito. Recomenda-se Política de Privacidade e aviso de cookies |
| HTTPS | ⚠️ Infra | Deve ser configurado no nível do servidor/proxy (Nginx + Certbot) |

---

## 8. ESTRUTURA DE PASTAS

```
bcprimenext/
├── client/                  # Frontend React
│   └── src/
│       ├── components/      # Componentes reutilizáveis
│       │   ├── admin/       # Layout e componentes admin
│       │   ├── layout/      # Header, Footer, WhatsApp
│       │   └── ui/          # shadcn/ui (Radix)
│       ├── lib/             # Utilitários (queryClient, site-stats)
│       ├── hooks/           # Custom hooks
│       └── pages/           # Páginas da aplicação
│           └── admin/       # Páginas do painel admin
├── server/                  # Backend Node.js/Express
│   ├── index.ts             # Entry point
│   ├── routes.ts            # Todas as rotas da API
│   ├── storage.ts           # Interface com o banco de dados
│   └── vite.ts              # Integração Vite/Express
├── shared/
│   └── schema.ts            # Schema Drizzle (compartilhado frontend/backend)
├── uploads/                 # Imagens enviadas (gerado em runtime)
├── dist/                    # Build de produção (gerado)
├── drizzle.config.ts        # Configuração do Drizzle Kit
├── vite.config.ts           # Configuração do Vite
└── package.json
```

---

## 9. CONTATO TÉCNICO

| Canal | Dados |
|---|---|
| E-mail | sales@bcprimeon.com |
| Telefone | (41) 3403-2089 |
| WhatsApp | (41) 9 8511-7177 |
| Endereço | Av. Camilo di Lellis, 633, Salas 45/47 — Pinhais/PR |

---

*Documento gerado em Junho de 2026 — BCPrimeNEXT v1.0*
