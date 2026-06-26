# Ficha Tecnica - Deploy em Producao

## Requisitos do Servidor

### Hardware Minimo
- **CPU**: 1 vCPU
- **RAM**: 1 GB (recomendado 2 GB)
- **Disco**: 5 GB SSD

### Software Necessario
- **Node.js**: v20.x ou superior
- **PostgreSQL**: v14.x ou superior
- **NPM**: v10.x ou superior

---

## Variaveis de Ambiente Obrigatorias

Crie um arquivo `.env` ou configure no seu servidor:

```bash
# Banco de Dados PostgreSQL
DATABASE_URL=postgresql://usuario:senha@host:5432/nome_banco

# Sessao (gere uma string aleatoria de 32+ caracteres)
SESSION_SECRET=sua_chave_secreta_aqui_32_caracteres

# Autenticacao OIDC (Replit Auth)
ISSUER_URL=https://replit.com/oidc
REPL_ID=seu_repl_id

# Object Storage (Google Cloud Storage)
DEFAULT_OBJECT_STORAGE_BUCKET_ID=seu_bucket_id
PRIVATE_OBJECT_DIR=.private
PUBLIC_OBJECT_SEARCH_PATHS=public

# Porta do servidor
PORT=5000
```

---

## Arquivos para Deploy

Apos rodar `npm run build`, voce precisa dos seguintes arquivos/pastas:

```
/dist/                  # Pasta com o build completo
  /public/              # Frontend compilado (arquivos estaticos)
  /index.cjs            # Backend compilado
/package.json           # Dependencias
/package-lock.json      # Lock de dependencias
```

---

## Comandos de Deploy

### 1. Instalar dependencias de producao
```bash
npm ci --production
```

### 2. Configurar banco de dados
```bash
npm run db:push
```

### 3. Iniciar aplicacao
```bash
NODE_ENV=production node dist/index.cjs
```

---

## Configuracao do Banco de Dados

### Criar banco PostgreSQL
```sql
CREATE DATABASE arcadia_consulting;
CREATE USER arcadia_user WITH PASSWORD 'sua_senha_segura';
GRANT ALL PRIVILEGES ON DATABASE arcadia_consulting TO arcadia_user;
```

### Estrutura automatica
O comando `npm run db:push` cria todas as tabelas automaticamente.

---

## Proxy Reverso (Nginx)

Exemplo de configuracao para Nginx:

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
        
        # Aumentar limite para uploads
        client_max_body_size 50M;
    }
}
```

---

## SSL/HTTPS com Certbot

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d seudominio.com.br
```

---

## Gerenciador de Processos (PM2)

Para manter a aplicacao rodando:

```bash
# Instalar PM2
npm install -g pm2

# Iniciar aplicacao
pm2 start dist/index.cjs --name arcadia-consulting

# Configurar reinicio automatico
pm2 startup
pm2 save
```

---

## Object Storage (Alternativas ao Replit)

Se voce nao usar o Object Storage do Replit, precisara adaptar o codigo para:

### Opcao 1: AWS S3
- Criar bucket no S3
- Configurar credenciais AWS
- Modificar `server/objectStorage.ts` para usar SDK da AWS

### Opcao 2: Google Cloud Storage
- Criar bucket no GCS
- Configurar service account
- Manter a integracao atual (ja usa GCS)

### Opcao 3: Armazenamento Local
- Modificar para salvar arquivos em `/uploads`
- Configurar Nginx para servir arquivos estaticos

---

## Autenticacao (Alternativas ao Replit Auth)

O sistema usa Replit Auth (OIDC). Para hospedagem externa, voce pode:

### Opcao 1: Manter Replit Auth
- Funciona se os usuarios tiverem conta Replit

### Opcao 2: Implementar Auth proprio
- Modificar para usar bcrypt + JWT
- Criar tabela de usuarios com senha
- Implementar login/registro tradicional

### Opcao 3: Auth0 / Firebase Auth
- Substituir estrategia OIDC
- Configurar novo provider

---

## Healthcheck

Endpoint para verificar se a aplicacao esta rodando:

```
GET /api/auth/user
```

Retorna 200 se autenticado, 401 se nao.

---

## Logs

Os logs sao exibidos no console. Para producao:

```bash
pm2 logs arcadia-consulting
```

---

## Backup do Banco

```bash
# Backup
pg_dump -U usuario -h localhost nome_banco > backup.sql

# Restaurar
psql -U usuario -h localhost nome_banco < backup.sql
```

---

## Resumo Rapido

| Item | Valor |
|------|-------|
| Porta | 5000 |
| Node.js | v20+ |
| PostgreSQL | v14+ |
| Comando Build | `npm run build` |
| Comando Start | `node dist/index.cjs` |
| Limite Upload | 50MB |

---

## Suporte

Para duvidas sobre a estrutura do codigo, consulte o arquivo `replit.md` na raiz do projeto.
