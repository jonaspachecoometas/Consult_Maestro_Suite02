import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Loader2, 
  BookOpen,
  Search,
  FileText,
  FolderOpen
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { KnowledgeArticle, KnowledgeCategory } from "@shared/schema";

interface ArticleWithCategory extends KnowledgeArticle {
  category?: KnowledgeCategory;
}

export default function PortalArticles() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<ArticleWithCategory | null>(null);

  const { data: articles = [], isLoading } = useQuery<ArticleWithCategory[]>({
    queryKey: ['/api/portal/articles'],
  });

  const filteredArticles = articles.filter(article => 
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (article.content && article.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const categories = Array.from(new Set(articles.map(a => a.category?.name).filter(Boolean)));

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
        <div>
          <h1 className="text-2xl font-heading font-bold" data-testid="text-page-title">
            Base de Conhecimento
          </h1>
          <p className="text-muted-foreground">
            Encontre respostas para suas duvidas
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-articles">
              {articles.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Categorias</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-categories">
              {categories.length}
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Buscar</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar artigos..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {filteredArticles.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredArticles.map((article) => (
            <Card 
              key={article.id} 
              className="cursor-pointer hover-elevate"
              onClick={() => setSelectedArticle(article)}
              data-testid={`card-article-${article.id}`}
            >
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-muted">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base line-clamp-2" data-testid={`text-article-title-${article.id}`}>
                      {article.title}
                    </CardTitle>
                    {article.category && (
                      <CardDescription className="mt-1">
                        {article.category.name}
                      </CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              {article.content && (
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {article.content.replace(/<[^>]*>/g, '').substring(0, 150)}...
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              {searchQuery 
                ? 'Nenhum artigo encontrado com os termos buscados.'
                : 'Nenhum artigo disponivel no momento.'
              }
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedArticle} onOpenChange={() => setSelectedArticle(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-article-dialog-title">
              {selectedArticle?.title}
            </DialogTitle>
            {selectedArticle?.category && (
              <p className="text-sm text-muted-foreground">
                {selectedArticle.category.name}
              </p>
            )}
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {selectedArticle?.content ? (
              <div 
                dangerouslySetInnerHTML={{ __html: selectedArticle.content }}
                data-testid="article-content"
              />
            ) : (
              <p className="text-muted-foreground">Sem conteudo disponivel.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
