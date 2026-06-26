# Guia de Hospedagem — Arcádia Consulting

Como colocar a plataforma para rodar em um servidor próprio (VPS, nuvem ou
máquina dedicada), fora do Replit. Linguagem direta, passo a passo.

> Já existe um documento complementar mais técnico em `FICHA_TECNICA_DEPLOY.md`.
> Este guia é a versão prática e atualizada. Em caso de divergência, siga este.

---

## 1. O que você vai precisar

| Item | Versão mínima | Observação |
|------|---------------|------------|
| Node.js | 20.x | Recomendado 20 LTS |
| npm | 10.x | Vem com o Node 20 |
| PostgreSQL | 14+ | Banco principal |
| CPU | 1 vCPU | 2 vCPU recomendado |
| RAM | 1 GB | 2 GB recomendado |
| Disco | 5 GB SSD | Mais se for guardar uploads locais |

Sistema operacional: qualquer Linux (Ubuntu 22.04+ é o mais simples).

---

## 2. Variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto (ou configure no painel do seu
provedor). Divididas entre **obrigatórias** e **opcionais**.

### 2.1 Obrigatórias (o app não sobe sem elas)

```bash
# Banco de dados PostgreSQL
DATABASE_URL=postgresql://usuario:senha@localhost:5432/arcadia

# Segredo das sessões de login — gere uma string aleatória longa
# Ex.: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=coloque_aqui_uma_string_aleatoria_de_64_caracteres

# Chave de criptografia dos conectores/integrações — EXATAMENTE 64 caracteres hex
# Ex.: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=coloque_aqui_64_caracteres_hexadecimais

# Porta HTTP da aplicação
PORT=5000

# Ambiente
NODE_ENV=production
```

> ⚠️ **ENCRYPTION_KEY** precisa ter exatamente 64 caracteres hexadecimais
> (32 bytes). Se mudar essa chave depois, os dados de conectores já
> criptografados deixam de ser legíveis. Guarde-a com segurança.

### 2.2 Opcionais (ligam recursos extras)

```bash
# --- Inteligência Artificial (agentes, Super Agente, RAG) ---
# Sem estas chaves, o app funciona, mas os recursos de IA ficam indisponíveis.
ANTHROPIC_API_KEY=sk-ant-...      # Claude (LLM principal)
OPENAI_API_KEY=sk-...             # OpenAI (embeddings do RAG / busca semântica)

# --- Login via Google (OAuth) — opcional ---
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://seudominio.com.br/api/oauth/google/callback

# --- Login via Microsoft 365 (OAuth) — opcional ---
MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_TENANT_ID=...
MICROSOFT_OAUTH_REDIRECT_URI=https://seudominio.com.br/api/oauth/microsoft/callback

# --- SSO corporativo via OIDC — opcional ---
ISSUER_URL=https://seu-provedor-oidc/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...

# --- Object Storage (anexos/arquivos em nuvem) — opcional ---
# Se não configurar, prefira armazenamento local (ver seção 8).
DEFAULT_OBJECT_STORAGE_BUCKET_ID=...
PRIVATE_OBJECT_DIR=.private
PUBLIC_OBJECT_SEARCH_PATHS=public

# URL pública da aplicação (usada em links/callbacks)
APP_URL=https://seudominio.com.br
```

> **Login funciona sem nenhum provedor externo.** O sistema tem autenticação
> local por e-mail/senha. Os usuários de teste (senha `123456`) são criados
> automaticamente no primeiro boot — veja `replit.md`. Troque essas senhas
> antes de abrir para clientes reais.

---

## 3. Preparar o banco de dados

No PostgreSQL do servidor:

```sql
CREATE DATABASE arcadia;
CREATE USER arcadia_user WITH PASSWORD 'sua_senha_segura';
GRANT ALL PRIVILEGES ON DATABASE arcadia TO arcadia_user;
```

Aponte a `DATABASE_URL` para esse banco. As tabelas são criadas no passo
seguinte — você não precisa criar nada manualmente.

---

## 4. Instalar, criar tabelas e compilar

A partir do código-fonte (descompactado do backup ou clonado do Git):

```bash
# 1. Instalar dependências
npm install

# 2. Criar/atualizar as tabelas no banco (lê a DATABASE_URL do .env)
npm run db:push

# 3. Compilar frontend + backend para produção
npm run build
```

O build gera a pasta `dist/`:
- `dist/public/` — frontend compilado (HTML/CSS/JS estáticos)
- `dist/index.cjs` — backend compilado (Express)

---

## 5. Subir a aplicação

```bash
npm run start
# equivalente a: NODE_ENV=production node dist/index.cjs
```

A aplicação fica disponível em `http://SEU_IP:5000`.

No primeiro boot, o sistema cria automaticamente os usuários de teste e o
tenant demo "Arcádia Demo". Faça login com `a@a.com.br` / `123456`.

---

## 6. Manter rodando com PM2 (recomendado)

Para a aplicação reiniciar sozinha após quedas/reboots:

```bash
npm install -g pm2

pm2 start dist/index.cjs --name arcadia
pm2 startup      # configura início automático no boot do servidor
pm2 save

# Comandos úteis
pm2 logs arcadia     # ver logs
pm2 restart arcadia  # reiniciar
pm2 stop arcadia     # parar
```

---

## 7. Domínio, HTTPS e proxy reverso (Nginx)

Coloque o Nginx na frente para servir em HTTPS e na porta 80/443.

```nginx
server {
    listen 80;
    server_name seudominio.com.br;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        client_max_body_size 50M;   # permite uploads maiores
    }
}
```

Certificado SSL grátis com Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br
```

> Em produção atrás de proxy HTTPS, garanta que `APP_URL` aponte para o
> domínio `https://` correto (importante para os callbacks de OAuth/OIDC).

---

## 8. Armazenamento de arquivos (uploads)

A plataforma foi feita para o Object Storage do Replit (Google Cloud Storage).
Em servidor próprio você tem duas opções:

1. **Usar Google Cloud Storage**: crie um bucket, configure uma service
   account e preencha as variáveis `DEFAULT_OBJECT_STORAGE_BUCKET_ID`,
   `PRIVATE_OBJECT_DIR` e `PUBLIC_OBJECT_SEARCH_PATHS`.
2. **Armazenamento local**: usar a pasta `uploads/` do servidor. Requer
   pequena adaptação em `server/objectStorage.ts`. Indicado apenas para
   ambientes simples/single-server.

---

## 9. Backup e restauração do banco

```bash
# Gerar backup
pg_dump -U arcadia_user -h localhost arcadia > backup_arcadia.sql

# Restaurar
psql -U arcadia_user -h localhost arcadia < backup_arcadia.sql
```

Recomenda-se agendar o `pg_dump` em um cron diário.

---

## 10. Atualizando uma nova versão

```bash
# 1. Substituir o código pelos arquivos novos (Git pull ou novo backup)
# 2. Reinstalar dependências, caso tenham mudado
npm install
# 3. Aplicar mudanças de schema no banco
npm run db:push
# 4. Recompilar
npm run build
# 5. Reiniciar o processo
pm2 restart arcadia
```

---

## 11. Resumo rápido

| Item | Valor |
|------|-------|
| Porta padrão | 5000 |
| Node.js | v20+ |
| PostgreSQL | v14+ |
| Instalar | `npm install` |
| Criar tabelas | `npm run db:push` |
| Compilar | `npm run build` |
| Iniciar | `npm run start` |
| Obrigatórias | `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `PORT` |
| IA (opcional) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` |
| Login de teste | `a@a.com.br` / `123456` |

---

## 12. Checklist final de produção

- [ ] `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY` e `PORT` configurados
- [ ] `npm run db:push` rodado com sucesso
- [ ] `npm run build` concluído sem erros
- [ ] Aplicação respondendo em `http://localhost:5000`
- [ ] Nginx + HTTPS (Certbot) configurados no domínio
- [ ] PM2 com `startup` + `save` (sobe sozinho após reboot)
- [ ] Cron de `pg_dump` para backup do banco
- [ ] **Senhas dos usuários de teste trocadas/desativadas** (a `123456` é só para testes)
- [ ] Chaves de IA e OAuth preenchidas (se for usar esses recursos)
