import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { 
  Plus, 
  Trash2, 
  Loader2, 
  Ticket,
  AlertTriangle,
  Clock,
  CheckCircle,
  MoreVertical,
  Settings,
  MessageSquare,
  User,
  Building2,
  XCircle,
  ListPlus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SupportTicket, SupportType, Client, User as UserType } from "@shared/schema";
import { insertSupportTicketSchema } from "@shared/schema";
import { GenerateScrumItemDialog, mapPriorityToScrum } from "@/components/GenerateScrumItemDialog";

const ticketFormSchema = insertSupportTicketSchema.extend({
  title: z.string().min(1, "Titulo e obrigatorio"),
  clientId: z.string().min(1, "Cliente e obrigatorio"),
});

type TicketFormData = z.infer<typeof ticketFormSchema>;

type TicketStatus = 'open' | 'in_progress' | 'waiting_client' | 'waiting_internal' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

const statusConfig: Record<TicketStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  open: { label: 'Aberto', variant: 'destructive' },
  in_progress: { label: 'Em Andamento', variant: 'default' },
  waiting_client: { label: 'Aguard. Cliente', variant: 'secondary' },
  waiting_internal: { label: 'Aguard. Interno', variant: 'secondary' },
  resolved: { label: 'Resolvido', variant: 'outline' },
  closed: { label: 'Fechado', variant: 'outline' },
};

const priorityConfig: Record<TicketPriority, { label: string; color: string }> = {
  low: { label: 'Baixa', color: 'bg-green-500' },
  medium: { label: 'Media', color: 'bg-yellow-500' },
  high: { label: 'Alta', color: 'bg-orange-500' },
  urgent: { label: 'Urgente', color: 'bg-red-500' },
};

interface SupportStats {
  totalTickets: number;
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
  avgResolutionTime: number | null;
}

interface TicketWithRelations extends SupportTicket {
  client?: Client;
  assignedTo?: UserType;
  supportType?: SupportType;
}

export default function Support() {
  const { toast } = useToast();
  const [isNewTicketOpen, setIsNewTicketOpen] = useState(false);
  const [isDeleteTicketOpen, setIsDeleteTicketOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketWithRelations | null>(null);
  const [scrumDialogOpen, setScrumDialogOpen] = useState(false);
  const [scrumDialogTicket, setScrumDialogTicket] = useState<TicketWithRelations | null>(null);
  
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    clientId: '',
    typeId: '',
  });

  const ticketForm = useForm<TicketFormData>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: {
      title: '',
      description: '',
      clientId: '',
      projectId: undefined,
      supportTypeId: undefined,
      priority: 'medium',
      assignedToId: undefined,
    },
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filters.status && filters.status !== 'all') params.append('status', filters.status);
    if (filters.priority && filters.priority !== 'all') params.append('priority', filters.priority);
    if (filters.clientId && filters.clientId !== 'all') params.append('clientId', filters.clientId);
    if (filters.typeId && filters.typeId !== 'all') params.append('typeId', filters.typeId);
    return params.toString();
  };

  const { data: tickets = [], isLoading: isLoadingTickets } = useQuery<TicketWithRelations[]>({
    queryKey: ['/api/support/tickets', filters],
    queryFn: async () => {
      const qs = buildQueryString();
      const url = `/api/support/tickets${qs ? `?${qs}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch tickets');
      return response.json();
    },
  });

  const { data: supportTypes = [] } = useQuery<SupportType[]>({
    queryKey: ['/api/support/types'],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['/api/clients'],
  });

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ['/api/users'],
  });

  const { data: stats } = useQuery<SupportStats>({
    queryKey: ['/api/support/stats'],
  });

  const createTicketMutation = useMutation({
    mutationFn: async (data: TicketFormData) => {
      return apiRequest('POST', '/api/support/tickets', {
        ...data,
        projectId: data.projectId || null,
        supportTypeId: data.supportTypeId || null,
        assignedToId: data.assignedToId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/support/stats'] });
      toast({ title: 'Ticket criado com sucesso' });
      setIsNewTicketOpen(false);
      ticketForm.reset();
    },
    onError: () => {
      toast({ title: 'Erro ao criar ticket', variant: 'destructive' });
    },
  });

  const deleteTicketMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/support/tickets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/support/stats'] });
      toast({ title: 'Ticket excluido com sucesso' });
      setIsDeleteTicketOpen(false);
      setSelectedTicket(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir ticket', variant: 'destructive' });
    },
  });

  const formatDate = (date: string | Date | null) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const clearFilters = () => {
    setFilters({
      status: '',
      priority: '',
      clientId: '',
      typeId: '',
    });
  };

  if (isLoadingTickets) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold" data-testid="text-page-title">
            Suporte
          </h1>
          <p className="text-muted-foreground">
            Gerencie tickets de suporte e atendimento ao cliente
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/suporte/tipos" data-testid="link-support-types">
              <Settings className="h-4 w-4 mr-2" />
              Tipos de Suporte
            </Link>
          </Button>
          <Button onClick={() => setIsNewTicketOpen(true)} data-testid="button-new-ticket">
            <Plus className="h-4 w-4 mr-2" />
            Novo Ticket
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Tickets</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-tickets">
              {stats?.totalTickets || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Abertos</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-open-tickets">
              {stats?.openTickets || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-in-progress-tickets">
              {stats?.inProgressTickets || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolvidos</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-resolved-tickets">
              {stats?.resolvedTickets || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle className="text-base font-medium">Tickets</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={filters.status}
                onValueChange={(value) => setFilters(f => ({ ...f, status: value }))}
              >
                <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="open">Aberto</SelectItem>
                  <SelectItem value="in_progress">Em Andamento</SelectItem>
                  <SelectItem value="waiting_client">Aguard. Cliente</SelectItem>
                  <SelectItem value="waiting_internal">Aguard. Interno</SelectItem>
                  <SelectItem value="resolved">Resolvido</SelectItem>
                  <SelectItem value="closed">Fechado</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.priority}
                onValueChange={(value) => setFilters(f => ({ ...f, priority: value }))}
              >
                <SelectTrigger className="w-[140px]" data-testid="select-filter-priority">
                  <SelectValue placeholder="Prioridade" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.clientId}
                onValueChange={(value) => setFilters(f => ({ ...f, clientId: value }))}
              >
                <SelectTrigger className="w-[180px]" data-testid="select-filter-client">
                  <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {(filters.status || filters.priority || filters.clientId || filters.typeId) && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Responsavel</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => (
                <TableRow key={ticket.id} data-testid={`row-ticket-${ticket.id}`}>
                  <TableCell>
                    <Link href={`/suporte/tickets/${ticket.id}`}>
                      <span 
                        className="font-medium hover:underline cursor-pointer"
                        data-testid={`text-ticket-title-${ticket.id}`}
                      >
                        {ticket.title}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-3 w-3 text-muted-foreground" />
                      <span>{ticket.client?.name || '-'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={statusConfig[ticket.status as TicketStatus]?.variant || 'secondary'}
                      size="sm"
                    >
                      {statusConfig[ticket.status as TicketStatus]?.label || ticket.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div 
                        className={`w-2 h-2 rounded-full ${priorityConfig[ticket.priority as TicketPriority]?.color || 'bg-gray-500'}`}
                      />
                      <span className="text-sm">
                        {priorityConfig[ticket.priority as TicketPriority]?.label || ticket.priority}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {ticket.supportType?.name || '-'}
                  </TableCell>
                  <TableCell>
                    {ticket.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span>{ticket.assignedTo.firstName} {ticket.assignedTo.lastName}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Nao atribuido</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(ticket.createdAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-ticket-menu-${ticket.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/suporte/tickets/${ticket.id}`}>
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Ver Detalhes
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => {
                            setScrumDialogTicket(ticket);
                            setScrumDialogOpen(true);
                          }}
                        >
                          <ListPlus className="h-4 w-4 mr-2" />
                          Gerar Item Scrum
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setSelectedTicket(ticket); setIsDeleteTicketOpen(true); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {tickets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Nenhum ticket encontrado. Clique em "Novo Ticket" para adicionar.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isNewTicketOpen} onOpenChange={(open) => {
        setIsNewTicketOpen(open);
        if (!open) ticketForm.reset();
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Novo Ticket de Suporte</DialogTitle>
            <DialogDescription>
              Crie um novo ticket para acompanhar uma solicitacao de suporte.
            </DialogDescription>
          </DialogHeader>
          <Form {...ticketForm}>
            <form onSubmit={ticketForm.handleSubmit((data) => createTicketMutation.mutate(data))} className="space-y-4">
              <FormField
                control={ticketForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Titulo</FormLabel>
                    <FormControl>
                      <Input placeholder="Descreva brevemente o problema" data-testid="input-ticket-title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={ticketForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descricao</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Descreva o problema em detalhes" rows={4} data-testid="input-ticket-description" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={ticketForm.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger data-testid="select-ticket-client">
                            <SelectValue placeholder="Selecione o cliente" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={ticketForm.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prioridade</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || 'medium'}>
                        <FormControl>
                          <SelectTrigger data-testid="select-ticket-priority">
                            <SelectValue placeholder="Selecione a prioridade" />
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
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={ticketForm.control}
                  name="supportTypeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Tipo de Suporte</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger data-testid="select-ticket-type">
                            <SelectValue placeholder="Selecione o tipo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {supportTypes.filter(t => t.isActive === 1).map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={ticketForm.control}
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Responsavel</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger data-testid="select-ticket-assignee">
                            <SelectValue placeholder="Atribuir a..." />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName} {user.lastName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsNewTicketOpen(false)}>
                  Cancelar
                </Button>
                <Button 
                  type="submit"
                  disabled={createTicketMutation.isPending}
                  data-testid="button-submit-ticket"
                >
                  {createTicketMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Criar Ticket
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteTicketOpen} onOpenChange={setIsDeleteTicketOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o ticket "{selectedTicket?.title}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedTicket && deleteTicketMutation.mutate(selectedTicket.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTicketMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {scrumDialogTicket && (
        <GenerateScrumItemDialog
          open={scrumDialogOpen}
          onOpenChange={setScrumDialogOpen}
          originType="support_ticket"
          originId={scrumDialogTicket.id}
          originProjectId={scrumDialogTicket.projectId || undefined}
          defaultTitle={scrumDialogTicket.title}
          defaultDescription={scrumDialogTicket.description || ""}
          defaultType="bug"
          defaultPriority={mapPriorityToScrum(scrumDialogTicket.priority)}
        />
      )}
    </div>
  );
}
