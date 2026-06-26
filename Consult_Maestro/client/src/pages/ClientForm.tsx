import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertClientSchema, type Client } from "@shared/schema";

const formSchema = insertClientSchema.extend({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  phone: z.string().optional(),
  company: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  address: z.string().optional(),
  notes: z.string().optional(),
  logoUrl: z.string().url("URL inválida").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export default function ClientForm() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isEditing = !!params.id;
  const { toast } = useToast();

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ["/api/clients", params.id],
    enabled: isEditing,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      industry: "",
      website: "",
      address: "",
      notes: "",
      logoUrl: "",
    },
  });

  useEffect(() => {
    if (client) {
      form.reset({
        name: client.name,
        email: client.email || "",
        phone: client.phone || "",
        company: client.company || "",
        industry: client.industry || "",
        website: client.website || "",
        address: client.address || "",
        notes: client.notes || "",
        logoUrl: client.logoUrl || "",
      });
    }
  }, [client, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const response = await apiRequest("POST", "/api/clients", data);
      return response.json();
    },
    onSuccess: (newClient: Client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Cliente criado",
        description: "O cliente foi cadastrado com sucesso.",
      });
      navigate(`/clientes/${newClient.id}`);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível criar o cliente.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const response = await apiRequest("PATCH", `/api/clients/${params.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", params.id] });
      toast({
        title: "Cliente atualizado",
        description: "As alterações foram salvas com sucesso.",
      });
      navigate(`/clientes/${params.id}`);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o cliente.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormValues) => {
    const cleanData = {
      ...data,
      email: data.email || null,
      website: data.website || null,
      logoUrl: data.logoUrl || null,
    };
    
    if (isEditing) {
      updateMutation.mutate(cleanData);
    } else {
      createMutation.mutate(cleanData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEditing && isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card className="border-card-border max-w-2xl">
          <CardContent className="p-6 space-y-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/clientes" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="font-heading text-3xl font-bold">
            {isEditing ? "Editar Cliente" : "Novo Cliente"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isEditing 
              ? "Atualize as informações do cliente"
              : "Cadastre um novo cliente para gerenciar projetos"}
          </p>
        </div>
      </div>

      <Card className="border-card-border max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Informações do Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Nome do cliente" 
                          {...field} 
                          data-testid="input-client-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="company"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Empresa</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Nome da empresa" 
                          {...field} 
                          data-testid="input-client-company"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input 
                          type="email"
                          placeholder="email@exemplo.com" 
                          {...field} 
                          data-testid="input-client-email"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefone</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="(00) 00000-0000" 
                          {...field} 
                          data-testid="input-client-phone"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Segmento</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Ex: Tecnologia, Varejo..." 
                          {...field} 
                          data-testid="input-client-industry"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="https://exemplo.com" 
                          {...field} 
                          data-testid="input-client-website"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Endereço</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Endereço completo" 
                        {...field} 
                        data-testid="input-client-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>URL do Logo</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="https://exemplo.com/logo.png" 
                        {...field} 
                        data-testid="input-client-logo"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Observações</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Notas adicionais sobre o cliente..." 
                        rows={4}
                        {...field} 
                        data-testid="input-client-notes"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" asChild>
                  <Link href="/clientes">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={isPending} data-testid="button-save-client">
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {isEditing ? "Salvar Alterações" : "Criar Cliente"}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
