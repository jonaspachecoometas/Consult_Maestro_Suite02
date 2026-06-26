import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { z } from "zod";
import { Building2, Users, FolderKanban, CheckCircle2, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

const step1Schema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres"),
  sector: z.string().min(1, "Setor é obrigatório"),
  adminEmail: z.string().email("Email inválido").optional(),
});

const step2Schema = z.object({
  memberEmail: z.string().email("Email inválido").optional().or(z.literal("")),
  memberRole: z.enum(["admin", "gerente", "tecnico"]).default("tecnico"),
});

type Step1Form = z.infer<typeof step1Schema>;
type Step2Form = z.infer<typeof step2Schema>;

const steps = [
  { id: 1, title: "Configurar Empresa", icon: Building2 },
  { id: 2, title: "Convidar Equipe", icon: Users },
  { id: 3, title: "Começar", icon: FolderKanban },
];

export default function OnboardingPage() {
  const { isTenantAdmin } = useSystemRole();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const { data: myTenantData } = useQuery<{ tenant: any; subTenants: any[] }>({
    queryKey: ["/api/my-tenant"],
    enabled: isTenantAdmin,
  });

  const existingTenantId = myTenantData?.tenant?.id;

  const step1Form = useForm<Step1Form>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      name: myTenantData?.tenant?.name || "",
      sector: myTenantData?.tenant?.sector || "",
      adminEmail: myTenantData?.tenant?.adminEmail || "",
    },
  });

  const step2Form = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { memberEmail: "", memberRole: "tecnico" },
  });

  const updateTenantMutation = useMutation({
    mutationFn: async (data: Step1Form) => {
      const id = existingTenantId;
      if (!id) return null;
      const res = await apiRequest("PATCH", `/api/tenants/${id}`, data);
      return res.json();
    },
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-tenant"] });
      if (tenant) setTenantId(tenant.id);
      setCurrentStep(2);
      toast({ title: "Empresa configurada!" });
    },
    onError: () => {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (data: Step2Form) => {
      const id = tenantId || existingTenantId;
      if (!data.memberEmail || !id) {
        setCurrentStep(3);
        return null;
      }
      const res = await apiRequest("POST", `/api/tenants/${id}/invites`, {
        email: data.memberEmail,
        role: data.memberRole,
      });
      return res.json();
    },
    onSuccess: () => {
      setCurrentStep(3);
      toast({ title: "Convite enviado!" });
    },
    onError: () => {
      toast({ title: "Erro ao enviar convite", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-lg mx-auto mb-3">
            AC
          </div>
          <h1 className="text-2xl font-bold font-heading" data-testid="text-onboarding-title">Bem-vindo à Arcádia!</h1>
          <p className="text-muted-foreground">Vamos configurar seu ambiente em 3 passos</p>
        </div>

        {/* Steps Progress */}
        <div className="flex items-center justify-center gap-2">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                currentStep > step.id
                  ? 'bg-green-500 text-white'
                  : currentStep === step.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`} data-testid={`step-indicator-${step.id}`}>
                {currentStep > step.id ? <CheckCircle2 className="h-4 w-4" /> : step.id}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-10 h-0.5 ${currentStep > step.id ? 'bg-green-500' : 'bg-muted'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Configure Company */}
        {currentStep === 1 && (
          <Card data-testid="card-step-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Passo 1: Configurar Empresa
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...step1Form}>
                <form onSubmit={step1Form.handleSubmit((data) => updateTenantMutation.mutate(data))} className="space-y-4">
                  <FormField control={step1Form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da Empresa</FormLabel>
                      <FormControl>
                        <Input placeholder="Minha Empresa Ltda" {...field} data-testid="input-onboarding-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={step1Form.control} name="sector" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Setor</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-onboarding-sector">
                            <SelectValue placeholder="Selecione o setor" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="technology">Tecnologia</SelectItem>
                          <SelectItem value="healthcare">Saúde</SelectItem>
                          <SelectItem value="education">Educação</SelectItem>
                          <SelectItem value="finance">Finanças</SelectItem>
                          <SelectItem value="retail">Varejo</SelectItem>
                          <SelectItem value="manufacturing">Manufatura</SelectItem>
                          <SelectItem value="consulting">Consultoria</SelectItem>
                          <SelectItem value="other">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={step1Form.control} name="adminEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email de Contato</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="contato@empresa.com" {...field} data-testid="input-onboarding-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full" disabled={updateTenantMutation.isPending} data-testid="button-step-1-next">
                    {updateTenantMutation.isPending ? "Salvando..." : "Próximo"}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Invite Team */}
        {currentStep === 2 && (
          <Card data-testid="card-step-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Passo 2: Convidar Equipe
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...step2Form}>
                <form onSubmit={step2Form.handleSubmit((data) => sendInviteMutation.mutate(data))} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Convide o primeiro membro da sua equipe (opcional, pode fazer depois).
                  </p>
                  <FormField control={step2Form.control} name="memberEmail" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email do Membro</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="membro@empresa.com (opcional)" {...field} data-testid="input-onboarding-member-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={step2Form.control} name="memberRole" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Perfil</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-onboarding-role">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">Administrador</SelectItem>
                          <SelectItem value="gerente">Gerente</SelectItem>
                          <SelectItem value="tecnico">Técnico</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setCurrentStep(3)} data-testid="button-skip-invite">
                      Pular
                    </Button>
                    <Button type="submit" className="flex-1" disabled={sendInviteMutation.isPending} data-testid="button-step-2-next">
                      {sendInviteMutation.isPending ? "Enviando..." : "Enviar e Continuar"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Ready to go */}
        {currentStep === 3 && (
          <Card data-testid="card-step-3">
            <CardHeader className="text-center">
              <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-3" />
              <CardTitle>Tudo pronto!</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                Seu ambiente está configurado. Você já pode começar a usar a plataforma Arcádia.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" asChild>
                  <a href="/projetos" data-testid="link-go-projects">Ver Projetos</a>
                </Button>
                <Button asChild>
                  <a href="/" data-testid="link-go-dashboard">Ir ao Dashboard</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
