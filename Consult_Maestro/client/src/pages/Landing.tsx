import { useState } from "react";
import { BarChart3, GitBranch, Grid3X3, Shield, Users, Zap, Mail, Lock, User, Eye, EyeOff, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";

interface AuthConfig {
  oidcEnabled: boolean;
  localEnabled: boolean;
}

const features = [
  {
    icon: Grid3X3,
    title: "Canvas BMC Expandido",
    description: "Diagnóstico em 2 níveis evolutivos: Atual e Sistêmico, com gestão PDCA integrada.",
  },
  {
    icon: GitBranch,
    title: "Mapeamento de Processos",
    description: "Identifique gargalos, oportunidades de automação e prioridades operacionais.",
  },
  {
    icon: Users,
    title: "Gestão por Níveis",
    description: "Controle de acesso para Administradores, Gerentes e Técnicos.",
  },
  {
    icon: BarChart3,
    title: "Relatórios Consultivos",
    description: "Canvas Atual vs Sistêmico, Lacunas Visíveis e Ciclo PDCA de melhoria contínua.",
  },
  {
    icon: Zap,
    title: "Interface Kanban",
    description: "Gerencie projetos visualmente com drag-and-drop estilo Jira/Trello.",
  },
  {
    icon: Shield,
    title: "API-First",
    description: "Arquitetura RESTful completa para integração com outros sistemas.",
  },
];

function LoginForm() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/login", { email, password });
      toast({ title: "Login realizado com sucesso!" });
      navigate("/dashboard");
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Erro ao fazer login",
        description: error.message || "Verifique suas credenciais",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="login-email"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-10"
            required
            data-testid="input-login-email"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Senha</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            placeholder="Sua senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-10 pr-10"
            required
            data-testid="input-login-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-login-submit">
        {isLoading ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}

function RegisterForm() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Senhas não conferem",
        description: "Digite a mesma senha nos dois campos",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Senha muito curta",
        description: "A senha deve ter pelo menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      await apiRequest("POST", "/api/auth/register", { email, password, firstName, lastName });
      toast({ title: "Conta criada com sucesso!" });
      navigate("/dashboard");
      window.location.reload();
    } catch (error: any) {
      toast({
        title: "Erro ao criar conta",
        description: error.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="register-firstName">Nome</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="register-firstName"
              type="text"
              placeholder="Nome"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="pl-10"
              data-testid="input-register-firstName"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-lastName">Sobrenome</Label>
          <Input
            id="register-lastName"
            type="text"
            placeholder="Sobrenome"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            data-testid="input-register-lastName"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="register-email"
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-10"
            required
            data-testid="input-register-email"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">Senha</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="register-password"
            type={showPassword ? "text" : "password"}
            placeholder="Mínimo 6 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-10 pr-10"
            required
            data-testid="input-register-password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-confirmPassword">Confirmar Senha</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="register-confirmPassword"
            type={showPassword ? "text" : "password"}
            placeholder="Repita a senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="pl-10"
            required
            data-testid="input-register-confirmPassword"
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-register-submit">
        {isLoading ? "Criando conta..." : "Criar Conta"}
      </Button>
    </form>
  );
}

function AuthCard() {
  const { data: authConfig } = useQuery<AuthConfig>({
    queryKey: ["/api/auth/config"],
  });

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground font-heading font-bold">
            AC
          </div>
        </div>
        <CardTitle className="font-heading text-xl">Acesse a Plataforma</CardTitle>
        <CardDescription>Entre com sua conta ou crie uma nova</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="tab-login">Entrar</TabsTrigger>
            <TabsTrigger value="register" data-testid="tab-register">Criar Conta</TabsTrigger>
          </TabsList>
          <TabsContent value="login" className="mt-4">
            <LoginForm />
          </TabsContent>
          <TabsContent value="register" className="mt-4">
            <RegisterForm />
          </TabsContent>
        </Tabs>

        {authConfig?.oidcEnabled && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">ou</span>
              </div>
            </div>

            <Button variant="outline" className="w-full" asChild data-testid="button-sso-login">
              <a href="/api/login/oidc">
                <Key className="mr-2 h-4 w-4" />
                Entrar com SSO
              </a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground font-heading font-bold text-sm">
              AC
            </div>
            <span className="font-heading font-semibold text-lg">Arcádia Consulting</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <section className="py-12 md:py-20">
          <div className="container mx-auto px-4">
            <div className="grid gap-12 lg:grid-cols-2 items-center">
              <div className="text-center lg:text-left">
                <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl lg:text-5xl mb-6">
                  Plataforma de Diagnóstico
                  <br />
                  <span className="text-primary">de Consultoria</span>
                </h1>
                <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto lg:mx-0">
                  Ferramenta interna para alinhamento de requisitos, mapeamento de processos 
                  e diagnóstico estratégico baseado no método Arcádia/O METAS.
                </p>
              </div>
              <div>
                <AuthCard />
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-card">
          <div className="container mx-auto px-4">
            <div className="text-center mb-12">
              <h2 className="font-heading text-3xl font-bold mb-4">
                Funcionalidades Principais
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                Uma plataforma completa para operacionalizar a metodologia consultiva 
                com profundidade, diagnóstico e entregáveis estratégicos.
              </p>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Card key={feature.title} className="border-card-border">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary mb-4">
                      <feature.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="font-heading text-3xl font-bold mb-4">
                Método Canvas Expandido
              </h2>
              <p className="text-muted-foreground mb-8">
                Elevamos o Business Model Canvas tradicional em 2 níveis evolutivos com ciclo PDCA integrado, 
                alinhados com a mentalidade de consultor Arcádia.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="text-left border-card-border">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 text-sm font-bold">
                        1
                      </div>
                      <h4 className="font-semibold">Canvas Atual</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Estado atual do negócio — como está hoje, com diagnóstico detalhado.</p>
                  </CardContent>
                </Card>
                <Card className="text-left border-card-border">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10 text-purple-500 text-sm font-bold">
                        2
                      </div>
                      <h4 className="font-semibold">Canvas Sistêmico</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Visão sistêmica — como os blocos se conectam e evoluem (ERP, CRM, BI).</p>
                  </CardContent>
                </Card>
              </div>
              <div className="mt-6">
                <Card className="text-left border-card-border">
                  <CardContent className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10 text-green-500 text-sm font-bold">
                        PDCA
                      </div>
                      <h4 className="font-semibold">Ciclo PDCA Integrado</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">Gestão de melhoria contínua por bloco: Planejar, Fazer, Checar e Agir para transformação sustentável.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Arcádia Consulting Platform — Ferramenta Interna de Diagnóstico</p>
        </div>
      </footer>
    </div>
  );
}
