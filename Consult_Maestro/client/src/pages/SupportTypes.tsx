import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { 
  Plus, 
  Trash2, 
  Edit, 
  Loader2, 
  ArrowLeft,
  MoreVertical,
  Check,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { insertSupportTypeSchema, type SupportType } from "@shared/schema";

const formSchema = insertSupportTypeSchema.extend({
  name: z.string().min(1, "Nome e obrigatorio"),
  description: z.string().optional(),
  generateTask: z.number().default(0),
  defaultPriority: z.string().default('medium'),
  slaHours: z.number().min(1).default(24),
  isActive: z.number().default(1),
});

type FormData = z.infer<typeof formSchema>;

const defaultValues: FormData = {
  name: '',
  description: '',
  generateTask: 0,
  defaultPriority: 'medium',
  slaHours: 24,
  isActive: 1,
};

export default function SupportTypes() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<SupportType | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const { data: supportTypes = [], isLoading } = useQuery<SupportType[]>({
    queryKey: ['/api/support/types'],
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return apiRequest('POST', '/api/support/types', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/types'] });
      toast({ title: 'Tipo de suporte criado com sucesso' });
      setIsDialogOpen(false);
      form.reset(defaultValues);
    },
    onError: () => {
      toast({ title: 'Erro ao criar tipo de suporte', variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      return apiRequest('PATCH', `/api/support/types/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/types'] });
      toast({ title: 'Tipo de suporte atualizado com sucesso' });
      setIsDialogOpen(false);
      setSelectedType(null);
      setIsEditing(false);
      form.reset(defaultValues);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar tipo de suporte', variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/support/types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/types'] });
      toast({ title: 'Tipo de suporte excluido com sucesso' });
      setIsDeleteOpen(false);
      setSelectedType(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir tipo de suporte', variant: 'destructive' });
    },
  });

  const openEdit = (type: SupportType) => {
    setSelectedType(type);
    form.reset({
      name: type.name,
      description: type.description || '',
      generateTask: type.generateTask || 0,
      defaultPriority: type.defaultPriority || 'medium',
      slaHours: type.slaHours || 24,
      isActive: type.isActive ?? 1,
    });
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  const openNew = () => {
    form.reset(defaultValues);
    setIsEditing(false);
    setSelectedType(null);
    setIsDialogOpen(true);
  };

  const onSubmit = (data: FormData) => {
    if (isEditing && selectedType) {
      updateMutation.mutate({ id: selectedType.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const priorityLabels: Record<string, string> = {
    low: 'Baixa',
    medium: 'Media',
    high: 'Alta',
    urgent: 'Urgente',
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/suporte" data-testid="link-back-support">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-heading font-bold" data-testid="text-page-title">
              Tipos de Suporte
            </h1>
            <p className="text-muted-foreground">
              Configure os tipos de atendimento disponiveis
            </p>
          </div>
        </div>
        <Button onClick={openNew} data-testid="button-new-type">
          <Plus className="h-4 w-4 mr-2" />
          Novo Tipo
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {supportTypes.map((type) => (
          <Card key={type.id} data-testid={`card-type-${type.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base" data-testid={`text-type-name-${type.id}`}>
                    {type.name}
                  </CardTitle>
                  {type.description && (
                    <CardDescription className="mt-1 line-clamp-2">
                      {type.description}
                    </CardDescription>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid={`button-type-menu-${type.id}`}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(type)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => { setSelectedType(type); setIsDeleteOpen(true); }}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={type.isActive === 1 ? 'default' : 'secondary'} size="sm">
                  {type.isActive === 1 ? 'Ativo' : 'Inativo'}
                </Badge>
                <Badge variant="outline" size="sm">
                  SLA: {type.slaHours}h
                </Badge>
                <Badge variant="outline" size="sm">
                  {priorityLabels[type.defaultPriority || 'medium']}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {type.generateTask === 1 ? (
                  <>
                    <Check className="h-3 w-3 text-green-500" />
                    <span>Gera tarefa automaticamente</span>
                  </>
                ) : (
                  <>
                    <X className="h-3 w-3" />
                    <span>Nao gera tarefa</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {supportTypes.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            Nenhum tipo de suporte cadastrado. Clique em "Novo Tipo" para adicionar.
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Tipo de Suporte' : 'Novo Tipo de Suporte'}</DialogTitle>
            <DialogDescription>
              {isEditing 
                ? 'Atualize as informacoes do tipo de suporte.'
                : 'Configure um novo tipo de atendimento para categorizar tickets.'
              }
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Ex: Suporte Tecnico"
                        data-testid="input-type-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descricao</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Descreva o tipo de suporte"
                        rows={3}
                        data-testid="input-type-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="defaultPriority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioridade Padrao</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-type-priority">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">Baixa</SelectItem>
                          <SelectItem value="medium">Media</SelectItem>
                          <SelectItem value="high">Alta</SelectItem>
                          <SelectItem value="urgent">Urgente</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slaHours"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SLA (horas)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 24)}
                          min={1}
                          data-testid="input-type-sla"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="generateTask"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel>Gerar Tarefa</FormLabel>
                      <FormDescription>
                        Criar tarefa automaticamente ao abrir ticket
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="switch-generate-task"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <FormLabel>Ativo</FormLabel>
                      <FormDescription>
                        Tipo disponivel para novos tickets
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value === 1}
                        onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                        data-testid="switch-is-active"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  data-testid="button-submit-type"
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {isEditing ? 'Salvar' : 'Criar'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Tipo de Suporte</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o tipo "{selectedType?.name}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedType && deleteMutation.mutate(selectedType.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
