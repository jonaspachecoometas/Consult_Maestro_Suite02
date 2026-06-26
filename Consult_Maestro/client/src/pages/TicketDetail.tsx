import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, Link } from "wouter";
import { 
  Loader2, 
  ArrowLeft,
  Send,
  User,
  Building2,
  Clock,
  AlertTriangle,
  MessageSquare,
  Edit,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormField, FormItem, FormLabel, FormDescription } from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SupportTicket, SupportType, Client, User as UserType, TicketComment } from "@shared/schema";

const commentFormSchema = z.object({
  message: z.string().min(1, "Mensagem e obrigatoria"),
  isInternal: z.number().default(0),
});

type CommentFormData = z.infer<typeof commentFormSchema>;

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

interface TicketWithRelations extends SupportTicket {
  client?: Client;
  assignedTo?: UserType;
  supportType?: SupportType;
}

interface CommentWithAuthor extends TicketComment {
  author?: UserType;
}

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [isEditingStatus, setIsEditingStatus] = useState(false);

  const commentForm = useForm<CommentFormData>({
    resolver: zodResolver(commentFormSchema),
    defaultValues: {
      message: '',
      isInternal: 0,
    },
  });

  const { data: ticket, isLoading: isLoadingTicket } = useQuery<TicketWithRelations>({
    queryKey: ['/api/support/tickets', id],
    queryFn: async () => {
      const response = await fetch(`/api/support/tickets/${id}`);
      if (!response.ok) throw new Error('Failed to fetch ticket');
      return response.json();
    },
    enabled: !!id,
  });

  const { data: comments = [], isLoading: isLoadingComments } = useQuery<CommentWithAuthor[]>({
    queryKey: ['/api/support/tickets', id, 'comments'],
    queryFn: async () => {
      const response = await fetch(`/api/support/tickets/${id}/comments`);
      if (!response.ok) throw new Error('Failed to fetch comments');
      return response.json();
    },
    enabled: !!id,
  });

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ['/api/users'],
  });

  const updateTicketMutation = useMutation({
    mutationFn: async (data: Partial<TicketWithRelations>) => {
      return apiRequest('PATCH', `/api/support/tickets/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets', id] });
      queryClient.invalidateQueries({ queryKey: ['/api/support/stats'] });
      toast({ title: 'Ticket atualizado com sucesso' });
      setIsEditingStatus(false);
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar ticket', variant: 'destructive' });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async (data: { message: string; isInternal: number }) => {
      return apiRequest('POST', `/api/support/tickets/${id}/comments`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/support/tickets', id, 'comments'] });
      toast({ title: 'Comentario adicionado' });
      commentForm.reset();
    },
    onError: () => {
      toast({ title: 'Erro ao adicionar comentario', variant: 'destructive' });
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

  const getInitials = (firstName?: string | null, lastName?: string | null) => {
    const first = firstName?.charAt(0) || '';
    const last = lastName?.charAt(0) || '';
    return (first + last).toUpperCase() || 'U';
  };

  if (isLoadingTicket) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Ticket nao encontrado</p>
        <Button asChild>
          <Link href="/suporte">Voltar ao Suporte</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 border-b bg-background">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/suporte" data-testid="link-back-support">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-heading font-bold" data-testid="text-ticket-title">
              {ticket.title}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {ticket.client?.name || 'Cliente nao definido'}
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(ticket.createdAt)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge 
            variant={statusConfig[ticket.status as TicketStatus]?.variant || 'secondary'}
          >
            {statusConfig[ticket.status as TicketStatus]?.label || ticket.status}
          </Badge>
          <div className="flex items-center gap-2">
            <div 
              className={`w-2 h-2 rounded-full ${priorityConfig[ticket.priority as TicketPriority]?.color || 'bg-gray-500'}`}
            />
            <span className="text-sm">
              {priorityConfig[ticket.priority as TicketPriority]?.label || ticket.priority}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 p-6">
            {ticket.description && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Descricao</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap" data-testid="text-ticket-description">
                    {ticket.description}
                  </p>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                <h2 className="font-medium">Comentarios ({comments.length})</h2>
              </div>

              {isLoadingComments ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : comments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum comentario ainda. Adicione o primeiro comentario abaixo.
                </div>
              ) : (
                <div className="space-y-4">
                  {comments.map((comment) => (
                    <div 
                      key={comment.id} 
                      className={`flex gap-3 ${comment.isInternal === 1 ? 'bg-muted/50 p-3 rounded-md' : ''}`}
                      data-testid={`comment-${comment.id}`}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {getInitials(comment.author?.firstName, comment.author?.lastName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">
                            {comment.author ? `${comment.author.firstName} ${comment.author.lastName}` : 'Usuario'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(comment.createdAt)}
                          </span>
                          {comment.isInternal === 1 && (
                            <Badge variant="outline" size="sm">Interno</Badge>
                          )}
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{comment.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="p-4 border-t bg-background">
            <Form {...commentForm}>
              <form onSubmit={commentForm.handleSubmit((data) => addCommentMutation.mutate(data))} className="space-y-3">
                <FormField
                  control={commentForm.control}
                  name="message"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Escreva um comentario..."
                          rows={3}
                          data-testid="input-new-comment"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex items-center justify-between gap-4">
                  <FormField
                    control={commentForm.control}
                    name="isInternal"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Switch
                            checked={field.value === 1}
                            onCheckedChange={(checked) => field.onChange(checked ? 1 : 0)}
                            data-testid="switch-internal-comment"
                          />
                        </FormControl>
                        <FormLabel className="text-sm text-muted-foreground !mt-0">
                          Comentario interno (nao visivel ao cliente)
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <Button 
                    type="submit"
                    disabled={!commentForm.watch('message')?.trim() || addCommentMutation.isPending}
                    data-testid="button-send-comment"
                  >
                    {addCommentMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Enviar
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>

        <div className="w-80 border-l bg-muted/30 p-4 overflow-auto">
          <h3 className="font-medium mb-4">Detalhes do Ticket</h3>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Status</Label>
              {isEditingStatus ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={ticket.status || 'open'}
                    onValueChange={(value) => updateTicketMutation.mutate({ status: value })}
                  >
                    <SelectTrigger data-testid="select-edit-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Aberto</SelectItem>
                      <SelectItem value="in_progress">Em Andamento</SelectItem>
                      <SelectItem value="waiting_client">Aguard. Cliente</SelectItem>
                      <SelectItem value="waiting_internal">Aguard. Interno</SelectItem>
                      <SelectItem value="resolved">Resolvido</SelectItem>
                      <SelectItem value="closed">Fechado</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => setIsEditingStatus(false)}>
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <Badge 
                    variant={statusConfig[ticket.status as TicketStatus]?.variant || 'secondary'}
                  >
                    {statusConfig[ticket.status as TicketStatus]?.label || ticket.status}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => setIsEditingStatus(true)}>
                    <Edit className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Prioridade</Label>
              <Select
                value={ticket.priority || 'medium'}
                onValueChange={(value) => updateTicketMutation.mutate({ priority: value })}
              >
                <SelectTrigger data-testid="select-edit-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Responsavel</Label>
              <Select
                value={ticket.assignedToId || 'unassigned'}
                onValueChange={(value) => updateTicketMutation.mutate({ 
                  assignedToId: value === 'unassigned' ? null : value 
                })}
              >
                <SelectTrigger data-testid="select-edit-assignee">
                  <SelectValue placeholder="Nao atribuido" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Nao atribuido</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Cliente</Label>
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {ticket.client?.name || 'Nao definido'}
              </div>
            </div>

            {ticket.supportType && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Tipo de Suporte</Label>
                  <div className="text-sm">{ticket.supportType.name}</div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Criado em</Label>
              <div className="text-sm">{formatDate(ticket.createdAt)}</div>
            </div>

            {ticket.resolvedAt && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Resolvido em</Label>
                <div className="text-sm">{formatDate(ticket.resolvedAt)}</div>
              </div>
            )}

            {ticket.closedAt && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Fechado em</Label>
                <div className="text-sm">{formatDate(ticket.closedAt)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
