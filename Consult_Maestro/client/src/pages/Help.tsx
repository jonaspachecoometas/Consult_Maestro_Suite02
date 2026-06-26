import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Search,
  Book,
  Users,
  FolderKanban,
  LayoutGrid,
  GitBranch,
  ListChecks,
  FileText,
  Settings,
  HelpCircle,
  ChevronRight,
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { HelpArticle } from "@shared/schema";

const categoryIcons: Record<string, any> = {
  "inicio": Book,
  "clientes": Users,
  "projetos": FolderKanban,
  "canvas": LayoutGrid,
  "processos": GitBranch,
  "tarefas": ListChecks,
  "relatorios": FileText,
  "configuracoes": Settings,
  "geral": HelpCircle,
};

const categoryLabels: Record<string, string> = {
  "inicio": "Primeiros Passos",
  "clientes": "Clientes",
  "projetos": "Projetos",
  "canvas": "Canvas BMC",
  "processos": "Processos",
  "tarefas": "Tarefas",
  "relatorios": "Relatorios",
  "configuracoes": "Configuracoes",
  "geral": "Geral",
};

const categories = Object.entries(categoryLabels).map(([value, label]) => ({ value, label }));

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface ArticleFormProps {
  article?: HelpArticle;
  onClose: () => void;
}

function ArticleForm({ article, onClose }: ArticleFormProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(article?.title || "");
  const [slug, setSlug] = useState(article?.slug || "");
  const [summary, setSummary] = useState(article?.summary || "");
  const [content, setContent] = useState(article?.content || "");
  const [category, setCategory] = useState(article?.category || "geral");
  const [isPublished, setIsPublished] = useState(article?.isPublished ?? 1);

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/help", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help"] });
      toast({ title: "Artigo criado com sucesso" });
      onClose();
    },
    onError: () => toast({ title: "Erro ao criar artigo", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiRequest(`/api/help/${article?.id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help"] });
      toast({ title: "Artigo atualizado com sucesso" });
      onClose();
    },
    onError: () => toast({ title: "Erro ao atualizar artigo", variant: "destructive" }),
  });

  const handleSubmit = () => {
    const data = {
      title,
      slug: slug || generateSlug(title),
      summary,
      content,
      category,
      isPublished,
    };
    if (article) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        <div className="space-y-2">
          <Label>Titulo</Label>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (!article) setSlug(generateSlug(e.target.value));
            }}
            placeholder="Titulo do artigo"
            data-testid="input-article-title"
          />
        </div>
        <div className="space-y-2">
          <Label>Slug (URL)</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="slug-do-artigo"
            data-testid="input-article-slug"
          />
        </div>
        <div className="space-y-2">
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger data-testid="select-article-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Resumo</Label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Breve resumo do artigo"
            rows={2}
            data-testid="input-article-summary"
          />
        </div>
        <div className="space-y-2">
          <Label>Conteudo (suporta Markdown basico)</Label>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Conteudo do artigo..."
            rows={10}
            data-testid="input-article-content"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button
          onClick={handleSubmit}
          disabled={createMutation.isPending || updateMutation.isPending || !title || !content}
          data-testid="button-save-article"
        >
          {article ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function HelpList() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<HelpArticle | undefined>();

  const isAdmin = user?.role === "admin";

  const { data: articles, isLoading } = useQuery<HelpArticle[]>({
    queryKey: ["/api/help"],
  });

  const { data: searchResults } = useQuery<HelpArticle[]>({
    queryKey: ["/api/help/search", searchQuery],
    queryFn: async () => {
      const response = await fetch(`/api/help/search?q=${encodeURIComponent(searchQuery)}`);
      if (!response.ok) throw new Error("Failed to search");
      return response.json();
    },
    enabled: searchQuery.length >= 2,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest(`/api/help/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/help"] });
      toast({ title: "Artigo excluido com sucesso" });
    },
    onError: () => toast({ title: "Erro ao excluir artigo", variant: "destructive" }),
  });

  const displayArticles = searchQuery.length >= 2 ? searchResults : articles;

  const groupedArticles = displayArticles?.reduce((acc, article) => {
    const category = article.category || "geral";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(article);
    return acc;
  }, {} as Record<string, HelpArticle[]>);

  const handleNewArticle = () => {
    setEditingArticle(undefined);
    setDialogOpen(true);
  };

  const handleEditArticle = (article: HelpArticle) => {
    setEditingArticle(article);
    setDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Central de Ajuda</h1>
            <p className="text-muted-foreground">
              Encontre respostas para suas duvidas sobre a plataforma
            </p>
          </div>
          {isAdmin && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleNewArticle} data-testid="button-new-article">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Artigo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editingArticle ? "Editar Artigo" : "Novo Artigo"}</DialogTitle>
                  <DialogDescription>
                    {editingArticle ? "Atualize as informacoes do artigo" : "Crie um novo artigo de ajuda"}
                  </DialogDescription>
                </DialogHeader>
                <ArticleForm 
                  article={editingArticle} 
                  onClose={() => setDialogOpen(false)} 
                />
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Pesquisar artigos de ajuda..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-help-search"
          />
        </div>
      </div>

      {!displayArticles || displayArticles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <HelpCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Nenhum artigo encontrado</h3>
            <p className="text-muted-foreground">
              {searchQuery
                ? "Tente buscar com outros termos"
                : "Os artigos de ajuda serao adicionados em breve"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedArticles || {}).map(([category, categoryArticles]) => {
            const Icon = categoryIcons[category] || HelpCircle;
            return (
              <div key={category}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <h2 className="text-lg font-medium">
                    {categoryLabels[category] || category}
                  </h2>
                  <Badge variant="secondary" className="ml-2">
                    {categoryArticles.length}
                  </Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {categoryArticles.map((article) => (
                    <Card key={article.id} className="h-full hover-elevate relative group">
                      {isAdmin && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleEditArticle(article);
                            }}
                            data-testid={`button-edit-article-${article.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (confirm("Deseja excluir este artigo?")) {
                                deleteMutation.mutate(article.id);
                              }
                            }}
                            data-testid={`button-delete-article-${article.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                      <Link href={`/ajuda/${article.slug}`}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{article.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <CardDescription className="line-clamp-2">
                            {article.summary || article.content.substring(0, 100)}
                          </CardDescription>
                          <div className="flex items-center gap-1 mt-3 text-sm text-primary">
                            <span>Ler mais</span>
                            <ChevronRight className="h-4 w-4" />
                          </div>
                        </CardContent>
                      </Link>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HelpArticlePage({ slug }: { slug: string }) {
  const { data: article, isLoading } = useQuery<HelpArticle>({
    queryKey: ["/api/help/slug", slug],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <HelpCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Artigo nao encontrado</h3>
            <p className="text-muted-foreground mb-4">
              O artigo que voce procura nao existe ou foi removido
            </p>
            <Link href="/ajuda">
              <Button>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar para Ajuda
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const Icon = categoryIcons[article.category] || HelpCircle;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/ajuda">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para Ajuda
          </Button>
        </Link>

        <div className="flex items-center gap-2 mb-2">
          <Badge variant="secondary" className="flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {categoryLabels[article.category] || article.category}
          </Badge>
        </div>

        <h1 className="text-2xl font-semibold">{article.title}</h1>
        {article.summary && (
          <p className="text-muted-foreground mt-2">{article.summary}</p>
        )}
      </div>

      <Separator className="my-6" />

      <Card>
        <CardContent className="prose prose-neutral dark:prose-invert max-w-none p-6">
          <div
            dangerouslySetInnerHTML={{ __html: formatContent(article.content) }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function formatContent(content: string): string {
  return content
    .replace(/\n/g, "<br/>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/^### (.*?)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*?)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*?)$/gm, "<h1>$1</h1>");
}

export default function Help() {
  const [, params] = useRoute("/ajuda/:slug");

  if (params?.slug) {
    return <HelpArticlePage slug={params.slug} />;
  }

  return <HelpList />;
}
