import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { 
  Plus, 
  Search, 
  MoreVertical, 
  Mail, 
  Phone, 
  Building2,
  Globe,
  Trash2,
  Edit,
  Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { Client } from "@shared/schema";

export default function Clients() {
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteClient, setDeleteClient] = useState<Client | null>(null);
  const { toast } = useToast();

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (clientId: string) => {
      await apiRequest("DELETE", `/api/clients/${clientId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: "Cliente excluído",
        description: "O cliente foi removido com sucesso.",
      });
      setDeleteClient(null);
    },
    onError: () => {
      toast({
        title: "Erro",
        description: "Não foi possível excluir o cliente.",
        variant: "destructive",
      });
    },
  });

  const filteredClients = clients.filter((client) =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    client.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold">Clientes</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie sua base de clientes e empresas
          </p>
        </div>
        <Button asChild data-testid="button-new-client">
          <Link href="/clientes/novo">
            <Plus className="h-4 w-4 mr-2" />
            Novo Cliente
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar clientes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-search-clients"
          />
        </div>
        <Badge variant="secondary" size="sm">
          {filteredClients.length} cliente{filteredClients.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-card-border">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Skeleton className="h-12 w-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredClients.length === 0 ? (
        <Card className="border-card-border">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Building2 className="h-16 w-16 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Nenhum cliente encontrado</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              {searchQuery 
                ? "Tente ajustar sua busca ou limpe os filtros."
                : "Comece cadastrando seu primeiro cliente para gerenciar projetos de consultoria."}
            </p>
            {!searchQuery && (
              <Button asChild>
                <Link href="/clientes/novo">
                  <Plus className="h-4 w-4 mr-2" />
                  Cadastrar Cliente
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredClients.map((client) => (
            <Card key={client.id} className="border-card-border group">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={client.logoUrl || undefined} alt={client.name} />
                    <AvatarFallback className="bg-primary/10 text-primary font-medium">
                      {client.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate" data-testid={`text-client-name-${client.id}`}>
                          {client.name}
                        </h3>
                        {client.company && (
                          <p className="text-sm text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                            <Building2 className="h-3 w-3 shrink-0" />
                            {client.company}
                          </p>
                        )}
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-client-menu-${client.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/clientes/${client.id}`}>
                              <Eye className="h-4 w-4 mr-2" />
                              Ver Detalhes
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/clientes/${client.id}/editar`}>
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => setDeleteClient(client)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {client.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{client.email}</span>
                        </p>
                      )}
                      {client.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{client.phone}</span>
                        </p>
                      )}
                      {client.website && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Globe className="h-3 w-3 shrink-0" />
                          <span className="truncate">{client.website}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteClient} onOpenChange={() => setDeleteClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o cliente "{deleteClient?.name}"? 
              Esta ação não pode ser desfeita e removerá todos os projetos associados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteClient && deleteMutation.mutate(deleteClient.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
