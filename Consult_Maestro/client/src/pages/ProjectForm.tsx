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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PROJECT_STATUSES } from "@/lib/constants";
import { insertProjectSchema, type Project, type Client } from "@shared/schema";

const formSchema = insertProjectSchema.extend({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  clientId: z.string().min(1, "Selecione um cliente"),
  status: z.string().default("backlog"),
});

type FormValues = z.infer<typeof formSchema>;

export default function ProjectForm() {
  const [, navigate] = useLocation();
  const params = useParams<{ id: string }>();
  const isEditing = !!params.id;
  const { toast } = useToast();

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", params.id],
    enabled: isEditing,
  });

  const { data: clients = [], isLoading: clientsLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      clientId: "",
      status: "backlog",
      type: "external",
      managerId: null,
      startDate: null,
      dueDate: null,
      priority: 0,
    },
  });

  useEffect(() => {
    if (project) {
      form.reset({
        name: project.name,
        description: project.description || "",
        clientId: project.clientId,
        status: project.status,
        type: project.type,
        managerId: project.managerId,
        startDate: project.startDate,
        dueDate: project.dueDate,
        priority: project.priority || 0,
      });
    }
  }, [project, form]);

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const response = await apiRequest("POST", "/api/projects", data);
      return response.json();
    },
    onSuccess: (newProject: Project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Projeto criado",
        description: "O projeto foi criado com sucesso.",
      });
      navigate(`/projetos/${newProject.id}`);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível criar o projeto.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const response = await apiRequest("PATCH", `/api/projects/${params.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", params.id] });
      toast({
        title: "Projeto atualizado",
        description: "As alterações foram salvas com sucesso.",
      });
      navigate(`/projetos/${params.id}`);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o projeto.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormValues) => {
    if (isEditing) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isLoading = isEditing && projectLoading;

  if (isLoading) {
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
          <Link href="/projetos" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="font-heading text-3xl font-bold">
            {isEditing ? "Editar Projeto" : "Novo Projeto"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isEditing 
              ? "Atualize as informações do projeto"
              : "Crie um novo projeto de consultoria"}
          </p>
        </div>
      </div>

      <Card className="border-card-border max-w-2xl">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Informações do Projeto</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do Projeto *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Ex: Diagnóstico Estratégico 2024" 
                        {...field} 
                        data-testid="input-project-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-project-client">
                          <SelectValue placeholder="Selecione um cliente" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {clientsLoading ? (
                          <SelectItem value="__loading__" disabled>Carregando...</SelectItem>
                        ) : clients.length === 0 ? (
                          <SelectItem value="__empty__" disabled>Nenhum cliente cadastrado</SelectItem>
                        ) : (
                          clients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                              {client.company && ` - ${client.company}`}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    {clients.length === 0 && !clientsLoading && (
                      <p className="text-sm text-muted-foreground">
                        <Link href="/clientes/novo" className="text-primary hover:underline">
                          Cadastre um cliente
                        </Link>
                        {" "}antes de criar um projeto.
                      </p>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-project-status">
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PROJECT_STATUSES.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full ${status.color}`} />
                              {status.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Descreva o escopo e objetivos do projeto..." 
                        rows={4}
                        {...field} 
                        value={field.value || ""}
                        data-testid="input-project-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" asChild>
                  <Link href="/projetos">Cancelar</Link>
                </Button>
                <Button 
                  type="submit" 
                  disabled={isPending || clients.length === 0} 
                  data-testid="button-save-project"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      {isEditing ? "Salvar Alterações" : "Criar Projeto"}
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
