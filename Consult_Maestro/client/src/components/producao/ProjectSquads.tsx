import { useQuery } from "@tanstack/react-query";
import { Users2, Crown, ExternalLink, Plus } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface User { id: string; firstName: string | null; lastName: string | null; email: string | null; profileImageUrl?: string | null; }
interface Member { id: string; userId: string; role: string; user?: User; }
interface Team { id: string; name: string; description: string | null; isActive: number; leader?: User; members?: Member[]; }

const ROLE_LABEL: Record<string, string> = {
  developer: "Dev", analyst: "Analista", consultant: "Consultor",
  support: "Suporte", tester: "Testador",
};

interface Props { projectId: string; }

export function ProjectSquads({ projectId: _projectId }: Props) {
  // Squads são tenant-wide hoje (não há vínculo direto squad↔projeto no schema).
  // Listamos todos para que o usuário possa visualizar e gerenciar; ações
  // avançadas redirecionam à página global.
  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["/api/scrum/teams"],
  });

  if (isLoading) {
    return <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div>;
  }

  const activeTeams = teams.filter(t => t.isActive !== 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Squads disponíveis</h3>
          <Badge variant="outline">{activeTeams.length} ativ{activeTeams.length === 1 ? 'a' : 'as'}</Badge>
        </div>
        <Button asChild size="sm" data-testid="link-global-squads">
          <Link href="/producao/squads">
            <ExternalLink className="h-3 w-3 mr-1" />
            Gerenciar Squads
          </Link>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Squads são compartilhados entre projetos. Crie ou edite squads na página global e atribua membros aos PBIs deste projeto via Backlog.
      </p>

      {activeTeams.length === 0 ? (
        <Card className="border-card-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users2 className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <h3 className="font-semibold mb-2">Nenhum Squad Cadastrado</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Crie squads (times) para organizar quem trabalha em cada PBI deste projeto.
            </p>
            <Button asChild size="sm" data-testid="link-create-squad">
              <Link href="/producao/squads">
                <Plus className="h-3.5 w-3.5 mr-1" />
                Criar Primeiro Squad
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {activeTeams.map(team => (
            <Card key={team.id} className="border-card-border" data-testid={`squad-card-${team.id}`}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold" data-testid={`text-squad-name-${team.id}`}>{team.name}</h4>
                    {team.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{team.description}</p>
                    )}
                  </div>
                  <Badge variant="secondary" size="sm">
                    {(team.members?.length || 0)} membro{(team.members?.length || 0) !== 1 ? 's' : ''}
                  </Badge>
                </div>

                {team.leader && (
                  <div className="flex items-center gap-2 text-xs">
                    <Crown className="h-3 w-3 text-amber-500" />
                    <Avatar className="h-5 w-5">
                      <AvatarImage src={team.leader.profileImageUrl || undefined} />
                      <AvatarFallback className="text-[9px]">
                        {(team.leader.firstName?.[0] || team.leader.email?.[0] || "?").toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-muted-foreground">
                      Líder: {team.leader.firstName || team.leader.email}
                    </span>
                  </div>
                )}

                {team.members && team.members.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {team.members.slice(0, 6).map(m => (
                      <div key={m.id} className="flex items-center gap-1 bg-muted rounded-full pl-0.5 pr-2 py-0.5" data-testid={`member-${m.id}`}>
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={m.user?.profileImageUrl || undefined} />
                          <AvatarFallback className="text-[9px]">
                            {(m.user?.firstName?.[0] || m.user?.email?.[0] || "?").toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[10px] text-muted-foreground">
                          {ROLE_LABEL[m.role] || m.role}
                        </span>
                      </div>
                    ))}
                    {team.members.length > 6 && (
                      <Badge variant="outline" size="sm" className="text-[10px]">
                        +{team.members.length - 6}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
