import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useSystemRole } from "@/hooks/useSystemRole";
import { User, KeyRound, Shield, LogOut, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { getRoleLabel, getSystemRoleLabel } from "@/lib/authUtils";

const profileSchema = z.object({
  firstName: z.string().min(1, "Nome é obrigatório"),
  lastName: z.string().optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Senha atual é obrigatória"),
  newPassword: z.string().min(6, "Nova senha deve ter ao menos 6 caracteres"),
  confirmPassword: z.string().min(1, "Confirmação é obrigatória"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

export default function Profile() {
  const { toast } = useToast();
  const { user, systemRole } = useSystemRole();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: userData } = useQuery<any>({
    queryKey: ["/api/auth/user"],
  });

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      firstName: userData?.firstName || "",
      lastName: userData?.lastName || "",
    },
  });

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  const profileMutation = useMutation({
    mutationFn: (data: ProfileForm) => apiRequest("PATCH", "/api/auth/profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({ title: "Perfil atualizado!", description: "Suas informações foram salvas com sucesso." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordForm) =>
      apiRequest("POST", "/api/auth/change-password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }),
    onSuccess: () => {
      toast({ title: "Senha alterada!", description: "Sua nova senha está ativa." });
      passwordForm.reset();
    },
    onError: (err: any) => {
      toast({ title: "Erro ao alterar senha", description: err.message || "Verifique a senha atual e tente novamente.", variant: "destructive" });
    },
  });

  const initials = [userData?.firstName, userData?.lastName]
    .filter(Boolean)
    .map((n: string) => n[0].toUpperCase())
    .join("") || userData?.email?.[0]?.toUpperCase() || "?";

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-heading">Meu Perfil</h1>
        <p className="text-muted-foreground">Gerencie suas informações e credenciais de acesso</p>
      </div>

      {/* Identity Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-bold">
              {initials}
            </div>
            <div>
              <p className="text-lg font-semibold" data-testid="text-profile-name">
                {[userData?.firstName, userData?.lastName].filter(Boolean).join(" ") || "Sem nome"}
              </p>
              <p className="text-sm text-muted-foreground" data-testid="text-profile-email">{userData?.email}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">{getRoleLabel(userData?.role)}</Badge>
                {systemRole !== 'user' && (
                  <Badge variant="default" className="text-xs bg-blue-600">
                    <Shield className="h-3 w-3 mr-1" />{getSystemRoleLabel(systemRole)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Personal Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Informações Pessoais</CardTitle>
          </div>
          <CardDescription>Atualize seu nome de exibição na plataforma</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...profileForm}>
            <form onSubmit={profileForm.handleSubmit((data) => profileMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField control={profileForm.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Seu nome" {...field} data-testid="input-profile-firstname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={profileForm.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sobrenome</FormLabel>
                    <FormControl>
                      <Input placeholder="Seu sobrenome" {...field} data-testid="input-profile-lastname" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={profileMutation.isPending} data-testid="button-save-profile">
                  {profileMutation.isPending ? "Salvando..." : "Salvar Nome"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Change Password */}
      {userData?.isLocalAuth ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Alterar Senha</CardTitle>
            </div>
            <CardDescription>Recomendamos usar uma senha forte com letras, números e símbolos</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...passwordForm}>
              <form onSubmit={passwordForm.handleSubmit((data) => passwordMutation.mutate(data))} className="space-y-4">
                <FormField control={passwordForm.control} name="currentPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senha Atual</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showCurrent ? "text" : "password"}
                          placeholder="Sua senha atual"
                          {...field}
                          data-testid="input-current-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCurrent(!showCurrent)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={passwordForm.control} name="newPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nova Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showNew ? "text" : "password"}
                          placeholder="Mínimo 6 caracteres"
                          {...field}
                          data-testid="input-new-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew(!showNew)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={passwordForm.control} name="confirmPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmar Nova Senha</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showConfirm ? "text" : "password"}
                          placeholder="Repita a nova senha"
                          {...field}
                          data-testid="input-confirm-password"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm(!showConfirm)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <div className="flex justify-end">
                  <Button type="submit" disabled={passwordMutation.isPending} data-testid="button-change-password">
                    {passwordMutation.isPending ? "Alterando..." : "Alterar Senha"}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <p className="text-sm">Esta conta usa autenticação via SSO. A senha é gerenciada pelo seu provedor de identidade.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Session / Logout */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Sessão</CardTitle>
          </div>
          <CardDescription>Encerre sua sessão neste dispositivo</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sessão ativa</p>
              <p className="text-xs text-muted-foreground">{userData?.email}</p>
            </div>
            <Button
              variant="destructive"
              onClick={() => { window.location.href = "/api/logout"; }}
              data-testid="button-logout-profile"
            >
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
