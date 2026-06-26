import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  UserPlus, 
  Trash2, 
  Users, 
  Mail, 
  Phone, 
  Smartphone, 
  Building2,
  Edit,
  Star,
  StarOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertClientContactSchema, type ClientContact, type InsertClientContact } from "@shared/schema";
import { useState } from "react";

interface ClientContactsProps {
  clientId: string;
}

const formSchema = insertClientContactSchema.omit({ clientId: true }).extend({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export function ClientContacts({ clientId }: ClientContactsProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ClientContact | null>(null);
  const [deletingContactId, setDeletingContactId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: contacts = [], isLoading } = useQuery<ClientContact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
    enabled: !!clientId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertClientContact) => {
      await apiRequest("POST", `/api/clients/${clientId}/contacts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      toast({
        title: "Contato adicionado",
        description: "O contato foi adicionado com sucesso.",
      });
      setIsAddDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível adicionar o contato.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertClientContact> }) => {
      await apiRequest("PATCH", `/api/contacts/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      toast({
        title: "Contato atualizado",
        description: "O contato foi atualizado com sucesso.",
      });
      setEditingContact(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o contato.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/contacts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      toast({
        title: "Contato removido",
        description: "O contato foi removido com sucesso.",
      });
      setDeletingContactId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível remover o contato.",
        variant: "destructive",
      });
    },
  });

  const togglePrimaryMutation = useMutation({
    mutationFn: async ({ id, isPrimary }: { id: string; isPrimary: boolean }) => {
      await apiRequest("PATCH", `/api/contacts/${id}`, { isPrimary: isPrimary ? 1 : 0 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro",
        description: error.message || "Não foi possível atualizar o contato.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-4">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Contatos</h3>
          <p className="text-sm text-muted-foreground">
            {contacts.length} contato{contacts.length !== 1 ? 's' : ''} cadastrado{contacts.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-contact">
              <UserPlus className="h-4 w-4 mr-2" />
              Adicionar Contato
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Adicionar Contato</DialogTitle>
              <DialogDescription>
                Adicione um novo contato para este cliente.
              </DialogDescription>
            </DialogHeader>
            <ContactForm
              onSubmit={(data) => createMutation.mutate({ ...data, clientId })}
              isPending={createMutation.isPending}
              onCancel={() => setIsAddDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {contacts.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2">Nenhum Contato</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              Este cliente ainda não possui contatos cadastrados.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {contacts.map((contact) => (
            <Card 
              key={contact.id} 
              className="border-card-border"
              data-testid={`card-contact-${contact.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium truncate" data-testid={`text-contact-name-${contact.id}`}>
                        {contact.name}
                      </h4>
                      {contact.isPrimary === 1 && (
                        <Badge variant="secondary" size="sm" className="shrink-0">
                          Principal
                        </Badge>
                      )}
                    </div>
                    {contact.position && (
                      <p className="text-sm text-muted-foreground truncate">
                        {contact.position}
                      </p>
                    )}
                    {contact.department && (
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Building2 className="h-3 w-3" />
                        <span className="truncate">{contact.department}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => togglePrimaryMutation.mutate({ 
                        id: contact.id, 
                        isPrimary: contact.isPrimary !== 1 
                      })}
                      disabled={togglePrimaryMutation.isPending}
                      data-testid={`button-toggle-primary-${contact.id}`}
                    >
                      {contact.isPrimary === 1 ? (
                        <Star className="h-4 w-4 text-yellow-500" />
                      ) : (
                        <StarOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingContact(contact)}
                      data-testid={`button-edit-contact-${contact.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingContactId(contact.id)}
                      data-testid={`button-delete-contact-${contact.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-contact-email-${contact.id}`}
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-contact-phone-${contact.id}`}
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{contact.phone}</span>
                    </a>
                  )}
                  {contact.mobile && (
                    <a
                      href={`tel:${contact.mobile}`}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-contact-mobile-${contact.id}`}
                    >
                      <Smartphone className="h-3.5 w-3.5 shrink-0" />
                      <span>{contact.mobile}</span>
                    </a>
                  )}
                </div>

                {contact.notes && (
                  <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
                    {contact.notes}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editingContact} onOpenChange={(open) => !open && setEditingContact(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Contato</DialogTitle>
            <DialogDescription>
              Atualize as informações do contato.
            </DialogDescription>
          </DialogHeader>
          {editingContact && (
            <ContactForm
              initialData={editingContact}
              onSubmit={(data) => updateMutation.mutate({ id: editingContact.id, data })}
              isPending={updateMutation.isPending}
              onCancel={() => setEditingContact(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingContactId} onOpenChange={(open) => !open && setDeletingContactId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este contato? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-contact">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingContactId && deleteMutation.mutate(deletingContactId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-contact"
            >
              {deleteMutation.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface ContactFormProps {
  initialData?: Partial<ClientContact>;
  onSubmit: (data: Omit<InsertClientContact, "clientId">) => void;
  isPending: boolean;
  onCancel: () => void;
}

function ContactForm({ initialData, onSubmit, isPending, onCancel }: ContactFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || "",
      position: initialData?.position || "",
      department: initialData?.department || "",
      email: initialData?.email || "",
      phone: initialData?.phone || "",
      mobile: initialData?.mobile || "",
      notes: initialData?.notes || "",
      isPrimary: initialData?.isPrimary || 0,
    },
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name || "",
        position: initialData.position || "",
        department: initialData.department || "",
        email: initialData.email || "",
        phone: initialData.phone || "",
        mobile: initialData.mobile || "",
        notes: initialData.notes || "",
        isPrimary: initialData.isPrimary || 0,
      });
    }
  }, [initialData, form]);

  const handleFormSubmit = (values: FormValues) => {
    onSubmit({
      name: values.name.trim(),
      position: values.position?.trim() || null,
      department: values.department?.trim() || null,
      email: values.email?.trim() || null,
      phone: values.phone?.trim() || null,
      mobile: values.mobile?.trim() || null,
      notes: values.notes?.trim() || null,
      isPrimary: values.isPrimary || 0,
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="Nome do contato"
                  data-testid="input-contact-name"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="position"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cargo</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="Ex: Diretor"
                    data-testid="input-contact-position"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="department"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Departamento</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="Ex: Comercial"
                    data-testid="input-contact-department"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  value={field.value || ""}
                  placeholder="email@exemplo.com"
                  data-testid="input-contact-email"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="(11) 3000-0000"
                    data-testid="input-contact-phone"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="mobile"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Celular</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="(11) 99000-0000"
                    data-testid="input-contact-mobile"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observações</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value || ""}
                  placeholder="Informações adicionais sobre o contato"
                  rows={3}
                  data-testid="input-contact-notes"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button 
            type="button"
            variant="outline" 
            onClick={onCancel}
            data-testid="button-cancel-contact-form"
          >
            Cancelar
          </Button>
          <Button 
            type="submit"
            disabled={isPending}
            data-testid="button-submit-contact-form"
          >
            {isPending ? "Salvando..." : (initialData ? "Atualizar" : "Adicionar")}
          </Button>
        </div>
      </form>
    </Form>
  );
}
