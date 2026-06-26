import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Loader2, 
  Ticket, 
  BookOpen, 
  GraduationCap,
  ArrowRight,
  Clock,
  CheckCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DashboardData {
  user: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
  ticketStats: {
    total: number;
    open: number;
    resolved: number;
  };
  recentTickets: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
  }>;
  recentArticles: Array<{
    id: string;
    title: string;
  }>;
  trainingCount: number;
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  open: { label: 'Aberto', variant: 'default' },
  in_progress: { label: 'Em Andamento', variant: 'secondary' },
  resolved: { label: 'Resolvido', variant: 'outline' },
  closed: { label: 'Fechado', variant: 'outline' },
};

export default function PortalDashboard() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['/api/portal/dashboard'],
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const userName = data?.user?.firstName 
    ? `${data.user.firstName}${data.user.lastName ? ' ' + data.user.lastName : ''}`
    : 'Cliente';

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-heading font-bold" data-testid="text-portal-title">
          Portal do Cliente
        </h1>
        <p className="text-muted-foreground" data-testid="text-welcome">
          Bem-vindo, {userName}!
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Meus Tickets</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-tickets">
              {data?.ticketStats.total || 0}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{data?.ticketStats.open || 0} abertos</span>
              </div>
              <div className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                <span>{data?.ticketStats.resolved || 0} resolvidos</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-articles-count">
              {data?.recentArticles.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              artigos disponiveis
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Treinamentos</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-training-count">
              {data?.trainingCount || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              conteudos disponiveis
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Tickets Recentes</CardTitle>
                <CardDescription>Seus ultimos tickets de suporte</CardDescription>
              </div>
              <Link href="/portal/tickets">
                <Button variant="ghost" size="sm" data-testid="link-all-tickets">
                  Ver todos
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data?.recentTickets && data.recentTickets.length > 0 ? (
              <div className="space-y-3">
                {data.recentTickets.map((ticket) => (
                  <div 
                    key={ticket.id} 
                    className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50"
                    data-testid={`ticket-item-${ticket.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{ticket.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <Badge 
                      variant={statusConfig[ticket.status]?.variant || 'secondary'}
                      size="sm"
                    >
                      {statusConfig[ticket.status]?.label || ticket.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-6">
                Nenhum ticket encontrado
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Artigos Recentes</CardTitle>
                <CardDescription>Artigos da base de conhecimento</CardDescription>
              </div>
              <Link href="/portal/artigos">
                <Button variant="ghost" size="sm" data-testid="link-all-articles">
                  Ver todos
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {data?.recentArticles && data.recentArticles.length > 0 ? (
              <div className="space-y-3">
                {data.recentArticles.map((article) => (
                  <div 
                    key={article.id} 
                    className="flex items-center gap-2 p-3 rounded-md bg-muted/50"
                    data-testid={`article-item-${article.id}`}
                  >
                    <BookOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <p className="font-medium truncate">{article.title}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-6">
                Nenhum artigo disponivel
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link href="/portal/tickets">
          <Button data-testid="button-new-ticket">
            <Ticket className="h-4 w-4 mr-2" />
            Abrir Novo Ticket
          </Button>
        </Link>
        <Link href="/portal/artigos">
          <Button variant="outline" data-testid="button-view-articles">
            <BookOpen className="h-4 w-4 mr-2" />
            Base de Conhecimento
          </Button>
        </Link>
        <Link href="/portal/treinamentos">
          <Button variant="outline" data-testid="button-view-training">
            <GraduationCap className="h-4 w-4 mr-2" />
            Treinamentos
          </Button>
        </Link>
      </div>
    </div>
  );
}
