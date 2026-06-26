import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Plug, Bot, KeyRound, Activity, Webhook } from "lucide-react";

const sections = [
  {
    title: "Integrações",
    description: "Google Workspace, Microsoft 365 e WhatsApp Business.",
    href: "/configuracoes/integracoes",
    icon: Plug,
    testId: "card-link-integracoes",
  },
  {
    title: "API Keys (MCP Hub)",
    description: "Chaves para o endpoint público /mcp/v1 com escopos.",
    href: "/configuracoes/api-keys",
    icon: Webhook,
    testId: "card-link-api-keys",
  },
  {
    title: "IA — Uso & Pool",
    description: "Tokens consumidos por dia, por provider, alerta de pool.",
    href: "/configuracoes/ia",
    icon: Activity,
    testId: "card-link-ia-uso",
  },
  {
    title: "IA & Modelos (chaves)",
    description: "Provedor de IA do tenant e chaves próprias.",
    href: "/integracoes",
    icon: Bot,
    testId: "card-link-ia",
  },
  {
    title: "Permissões",
    description: "Perfis de acesso e papéis dos usuários.",
    href: "/minha-empresa/perfis",
    icon: KeyRound,
    testId: "card-link-permissoes",
  },
];

export default function ConfiguracoesIndex() {
  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6" data-testid="page-configuracoes-index">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Centraliza integrações, IA e permissões do tenant.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map(({ title, description, href, icon: Icon, testId }) => (
          <Link key={href} href={href}>
            <Card className="cursor-pointer hover-elevate active-elevate-2 transition" data-testid={testId}>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <CardTitle className="text-lg">{title}</CardTitle>
                </div>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
