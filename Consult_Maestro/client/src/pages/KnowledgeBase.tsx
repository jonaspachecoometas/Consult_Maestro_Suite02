import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { 
  Plus, 
  Trash2, 
  Edit, 
  Loader2, 
  BookOpen,
  FolderOpen,
  MoreVertical,
  FileText,
  Eye,
  EyeOff,
  Search,
  GraduationCap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import type { KnowledgeCategory, KnowledgeArticle, TrainingContent } from "@shared/schema";

interface ArticleWithCategory extends KnowledgeArticle {
  category?: KnowledgeCategory;
}

export default function KnowledgeBase() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("articles");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const [isArticleDialogOpen, setIsArticleDialogOpen] = useState(false);
  const [isTrainingDialogOpen, setIsTrainingDialogOpen] = useState(false);
  const [isDeleteCategoryOpen, setIsDeleteCategoryOpen] = useState(false);
  const [isDeleteArticleOpen, setIsDeleteArticleOpen] = useState(false);
  const [isDeleteTrainingOpen, setIsDeleteTrainingOpen] = useState(false);
  
  const [selectedCategory, setSelectedCategory] = useState<KnowledgeCategory | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ArticleWithCategory | null>(null);
  const [selectedTraining, setSelectedTraining] = useState<TrainingContent | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const [categoryForm, setCategoryForm] = useState({
    name: '',
    description: '',
    isActive: 1,
  });

  const [articleForm, setArticleForm] = useState({
    title: '',
    content: '',
    categoryId: '',
    status: 'draft' as 'draft' | 'published' | 'archived',
    accessLevel: 'public' as 'public' | 'members' | 'premium',
  });

  const [trainingForm, setTrainingForm] = useState({
    title: '',
    description: '',
    contentType: 'document' as 'video' | 'document' | 'link',
    contentUrl: '',
    isActive: 1,
  });

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['/api/knowledge/categories'],
  });

  const { data: articles = [], isLoading: isLoadingArticles } = useQuery<ArticleWithCategory[]>({
    queryKey: ['/api/knowledge/articles'],
  });

  const { data: trainings = [], isLoading: isLoadingTrainings } = useQuery<TrainingContent[]>({
    queryKey: ['/api/training'],
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: typeof categoryForm) => {
      return apiRequest('POST', '/api/knowledge/categories', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/categories'] });
      toast({ title: 'Categoria criada com sucesso' });
      setIsCategoryDialogOpen(false);
      resetCategoryForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar categoria', variant: 'destructive' });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof categoryForm }) => {
      return apiRequest('PATCH', `/api/knowledge/categories/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/categories'] });
      toast({ title: 'Categoria atualizada com sucesso' });
      setIsCategoryDialogOpen(false);
      setSelectedCategory(null);
      setIsEditing(false);
      resetCategoryForm();
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar categoria', variant: 'destructive' });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/knowledge/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/categories'] });
      toast({ title: 'Categoria excluida com sucesso' });
      setIsDeleteCategoryOpen(false);
      setSelectedCategory(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir categoria', variant: 'destructive' });
    },
  });

  const createArticleMutation = useMutation({
    mutationFn: async (data: typeof articleForm) => {
      return apiRequest('POST', '/api/knowledge/articles', {
        ...data,
        categoryId: data.categoryId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/articles'] });
      toast({ title: 'Artigo criado com sucesso' });
      setIsArticleDialogOpen(false);
      resetArticleForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar artigo', variant: 'destructive' });
    },
  });

  const updateArticleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof articleForm }) => {
      return apiRequest('PATCH', `/api/knowledge/articles/${id}`, {
        ...data,
        categoryId: data.categoryId || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/articles'] });
      toast({ title: 'Artigo atualizado com sucesso' });
      setIsArticleDialogOpen(false);
      setSelectedArticle(null);
      setIsEditing(false);
      resetArticleForm();
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar artigo', variant: 'destructive' });
    },
  });

  const deleteArticleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/knowledge/articles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/knowledge/articles'] });
      toast({ title: 'Artigo excluido com sucesso' });
      setIsDeleteArticleOpen(false);
      setSelectedArticle(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir artigo', variant: 'destructive' });
    },
  });

  const createTrainingMutation = useMutation({
    mutationFn: async (data: typeof trainingForm) => {
      return apiRequest('POST', '/api/training', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training'] });
      toast({ title: 'Conteudo de treinamento criado com sucesso' });
      setIsTrainingDialogOpen(false);
      resetTrainingForm();
    },
    onError: () => {
      toast({ title: 'Erro ao criar conteudo', variant: 'destructive' });
    },
  });

  const updateTrainingMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof trainingForm }) => {
      return apiRequest('PATCH', `/api/training/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training'] });
      toast({ title: 'Conteudo atualizado com sucesso' });
      setIsTrainingDialogOpen(false);
      setSelectedTraining(null);
      setIsEditing(false);
      resetTrainingForm();
    },
    onError: () => {
      toast({ title: 'Erro ao atualizar conteudo', variant: 'destructive' });
    },
  });

  const deleteTrainingMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/training/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training'] });
      toast({ title: 'Conteudo excluido com sucesso' });
      setIsDeleteTrainingOpen(false);
      setSelectedTraining(null);
    },
    onError: () => {
      toast({ title: 'Erro ao excluir conteudo', variant: 'destructive' });
    },
  });

  const resetCategoryForm = () => {
    setCategoryForm({ name: '', description: '', isActive: 1 });
  };

  const resetArticleForm = () => {
    setArticleForm({ title: '', content: '', categoryId: '', status: 'draft', accessLevel: 'public' });
  };

  const resetTrainingForm = () => {
    setTrainingForm({ title: '', description: '', contentType: 'document', contentUrl: '', isActive: 1 });
  };

  const openEditCategory = (category: KnowledgeCategory) => {
    setSelectedCategory(category);
    setCategoryForm({
      name: category.name,
      description: category.description || '',
      isActive: category.isActive ?? 1,
    });
    setIsEditing(true);
    setIsCategoryDialogOpen(true);
  };

  const openEditArticle = (article: ArticleWithCategory) => {
    setSelectedArticle(article);
    setArticleForm({
      title: article.title,
      content: article.content || '',
      categoryId: article.categoryId || '',
      status: (article.status as 'draft' | 'published' | 'archived') || 'draft',
      accessLevel: (article.accessLevel as 'public' | 'members' | 'premium') || 'public',
    });
    setIsEditing(true);
    setIsArticleDialogOpen(true);
  };

  const openEditTraining = (training: TrainingContent) => {
    setSelectedTraining(training);
    setTrainingForm({
      title: training.title,
      description: training.description || '',
      contentType: (training.contentType as 'video' | 'document' | 'link') || 'document',
      contentUrl: training.contentUrl || '',
      isActive: training.isActive ?? 1,
    });
    setIsEditing(true);
    setIsTrainingDialogOpen(true);
  };

  const openNewCategory = () => {
    resetCategoryForm();
    setIsEditing(false);
    setSelectedCategory(null);
    setIsCategoryDialogOpen(true);
  };

  const openNewArticle = () => {
    resetArticleForm();
    setIsEditing(false);
    setSelectedArticle(null);
    setIsArticleDialogOpen(true);
  };

  const openNewTraining = () => {
    resetTrainingForm();
    setIsEditing(false);
    setSelectedTraining(null);
    setIsTrainingDialogOpen(true);
  };

  const handleSubmitCategory = () => {
    if (isEditing && selectedCategory) {
      updateCategoryMutation.mutate({ id: selectedCategory.id, data: categoryForm });
    } else {
      createCategoryMutation.mutate(categoryForm);
    }
  };

  const handleSubmitArticle = () => {
    if (isEditing && selectedArticle) {
      updateArticleMutation.mutate({ id: selectedArticle.id, data: articleForm });
    } else {
      createArticleMutation.mutate(articleForm);
    }
  };

  const handleSubmitTraining = () => {
    if (isEditing && selectedTraining) {
      updateTrainingMutation.mutate({ id: selectedTraining.id, data: trainingForm });
    } else {
      createTrainingMutation.mutate(trainingForm);
    }
  };

  const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
    draft: { label: 'Rascunho', variant: 'secondary' },
    published: { label: 'Publicado', variant: 'default' },
    archived: { label: 'Arquivado', variant: 'outline' },
  };

  const contentTypeLabels: Record<string, string> = {
    video: 'Video',
    document: 'Documento',
    link: 'Link',
  };

  const filteredArticles = articles.filter(article => 
    article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (article.content && article.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const isLoading = isLoadingCategories || isLoadingArticles || isLoadingTrainings;

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
            Gerencie artigos, categorias e conteudos de treinamento
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Artigos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-articles">
              {articles.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {articles.filter(a => a.status === 'published').length} publicados
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Treinamentos</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-trainings">
              {trainings.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <TabsList>
            <TabsTrigger value="articles" data-testid="tab-articles">
              <FileText className="h-4 w-4 mr-2" />
              Artigos
            </TabsTrigger>
            <TabsTrigger value="categories" data-testid="tab-categories">
              <FolderOpen className="h-4 w-4 mr-2" />
              Categorias
            </TabsTrigger>
            <TabsTrigger value="training" data-testid="tab-training">
              <GraduationCap className="h-4 w-4 mr-2" />
              Treinamentos
            </TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            {activeTab === 'articles' && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar artigos..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 w-[250px]"
                    data-testid="input-search-articles"
                  />
                </div>
                <Button onClick={openNewArticle} data-testid="button-new-article">
                  <Plus className="h-4 w-4 mr-2" />
                  Novo Artigo
                </Button>
              </>
            )}
            {activeTab === 'categories' && (
              <Button onClick={openNewCategory} data-testid="button-new-category">
                <Plus className="h-4 w-4 mr-2" />
                Nova Categoria
              </Button>
            )}
            {activeTab === 'training' && (
              <Button onClick={openNewTraining} data-testid="button-new-training">
                <Plus className="h-4 w-4 mr-2" />
                Novo Conteudo
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="articles" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Visibilidade</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredArticles.map((article) => (
                    <TableRow key={article.id} data-testid={`row-article-${article.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium" data-testid={`text-article-title-${article.id}`}>
                            {article.title}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {article.category?.name || (
                          <span className="text-muted-foreground">Sem categoria</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={statusConfig[article.status || 'draft']?.variant || 'secondary'}
                          size="sm"
                        >
                          {statusConfig[article.status || 'draft']?.label || article.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {article.accessLevel === 'public' ? (
                            <>
                              <Eye className="h-3 w-3 text-green-500" />
                              <span className="text-sm">Publico</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3 w-3 text-muted-foreground" />
                              <span className="text-sm text-muted-foreground">{article.accessLevel === 'members' ? 'Membros' : 'Premium'}</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" data-testid={`button-article-menu-${article.id}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditArticle(article)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => { setSelectedArticle(article); setIsDeleteArticleOpen(true); }}
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
                  {filteredArticles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {searchQuery 
                          ? 'Nenhum artigo encontrado com os termos buscados.'
                          : 'Nenhum artigo cadastrado. Clique em "Novo Artigo" para adicionar.'
                        }
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <Card key={category.id} data-testid={`card-category-${category.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base" data-testid={`text-category-name-${category.id}`}>
                        {category.name}
                      </CardTitle>
                      {category.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                          {category.description}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-category-menu-${category.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditCategory(category)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setSelectedCategory(category); setIsDeleteCategoryOpen(true); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Badge variant={category.isActive === 1 ? 'default' : 'secondary'} size="sm">
                      {category.isActive === 1 ? 'Ativa' : 'Inativa'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {articles.filter(a => a.categoryId === category.id).length} artigos
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {categories.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhuma categoria cadastrada. Clique em "Nova Categoria" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="training" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {trainings.map((training) => (
              <Card key={training.id} data-testid={`card-training-${training.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base" data-testid={`text-training-title-${training.id}`}>
                        {training.title}
                      </CardTitle>
                      {training.description && (
                        <CardDescription className="mt-1 line-clamp-2">
                          {training.description}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" data-testid={`button-training-menu-${training.id}`}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditTraining(training)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setSelectedTraining(training); setIsDeleteTrainingOpen(true); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={training.isActive === 1 ? 'default' : 'secondary'} size="sm">
                      {training.isActive === 1 ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {contentTypeLabels[training.contentType || 'document']}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
            {trainings.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                Nenhum conteudo de treinamento cadastrado. Clique em "Novo Conteudo" para adicionar.
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Categoria' : 'Nova Categoria'}</DialogTitle>
            <DialogDescription>
              {isEditing 
                ? 'Atualize as informacoes da categoria.'
                : 'Crie uma nova categoria para organizar os artigos.'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="categoryName">Nome</Label>
              <Input
                id="categoryName"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Tutoriais"
                data-testid="input-category-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoryDescription">Descricao</Label>
              <Textarea
                id="categoryDescription"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Descreva a categoria"
                rows={3}
                data-testid="input-category-description"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="categoryActive">Ativa</Label>
                <p className="text-xs text-muted-foreground">
                  Categoria visivel para selecao
                </p>
              </div>
              <Switch
                id="categoryActive"
                checked={categoryForm.isActive === 1}
                onCheckedChange={(checked) => setCategoryForm(f => ({ ...f, isActive: checked ? 1 : 0 }))}
                data-testid="switch-category-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCategoryDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitCategory}
              disabled={!categoryForm.name || createCategoryMutation.isPending || updateCategoryMutation.isPending}
              data-testid="button-submit-category"
            >
              {(createCategoryMutation.isPending || updateCategoryMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isEditing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isArticleDialogOpen} onOpenChange={setIsArticleDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Artigo' : 'Novo Artigo'}</DialogTitle>
            <DialogDescription>
              {isEditing 
                ? 'Atualize o conteudo do artigo.'
                : 'Crie um novo artigo para a base de conhecimento.'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="articleTitle">Titulo</Label>
              <Input
                id="articleTitle"
                value={articleForm.title}
                onChange={(e) => setArticleForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Titulo do artigo"
                data-testid="input-article-title"
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="articleCategory">Categoria</Label>
                <Select
                  value={articleForm.categoryId}
                  onValueChange={(value) => setArticleForm(f => ({ ...f, categoryId: value }))}
                >
                  <SelectTrigger data-testid="select-article-category">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categories.filter(c => c.isActive === 1).map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="articleStatus">Status</Label>
                <Select
                  value={articleForm.status}
                  onValueChange={(value) => setArticleForm(f => ({ ...f, status: value as 'draft' | 'published' | 'archived' }))}
                >
                  <SelectTrigger data-testid="select-article-status">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="published">Publicado</SelectItem>
                    <SelectItem value="archived">Arquivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="articleAccess">Acesso</Label>
                <Select
                  value={articleForm.accessLevel}
                  onValueChange={(value) => setArticleForm(f => ({ ...f, accessLevel: value as 'public' | 'members' | 'premium' }))}
                >
                  <SelectTrigger data-testid="select-article-access">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Publico</SelectItem>
                    <SelectItem value="members">Membros</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="articleContent">Conteudo</Label>
              <Textarea
                id="articleContent"
                value={articleForm.content}
                onChange={(e) => setArticleForm(f => ({ ...f, content: e.target.value }))}
                placeholder="Escreva o conteudo do artigo..."
                rows={10}
                data-testid="input-article-content"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsArticleDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitArticle}
              disabled={!articleForm.title || createArticleMutation.isPending || updateArticleMutation.isPending}
              data-testid="button-submit-article"
            >
              {(createArticleMutation.isPending || updateArticleMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isEditing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTrainingDialogOpen} onOpenChange={setIsTrainingDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Editar Conteudo' : 'Novo Conteudo de Treinamento'}</DialogTitle>
            <DialogDescription>
              {isEditing 
                ? 'Atualize as informacoes do conteudo.'
                : 'Adicione um novo material de treinamento.'
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="trainingTitle">Titulo</Label>
              <Input
                id="trainingTitle"
                value={trainingForm.title}
                onChange={(e) => setTrainingForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Titulo do conteudo"
                data-testid="input-training-title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trainingDescription">Descricao</Label>
              <Textarea
                id="trainingDescription"
                value={trainingForm.description}
                onChange={(e) => setTrainingForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Descreva o conteudo"
                rows={3}
                data-testid="input-training-description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trainingType">Tipo de Conteudo</Label>
              <Select
                value={trainingForm.contentType}
                onValueChange={(value) => setTrainingForm(f => ({ ...f, contentType: value as 'video' | 'document' | 'link' }))}
              >
                <SelectTrigger data-testid="select-training-type">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="document">Documento</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trainingUrl">URL do Conteudo</Label>
              <Input
                id="trainingUrl"
                value={trainingForm.contentUrl}
                onChange={(e) => setTrainingForm(f => ({ ...f, contentUrl: e.target.value }))}
                placeholder="https://..."
                data-testid="input-training-url"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="trainingActive">Ativo</Label>
                <p className="text-xs text-muted-foreground">
                  Conteudo disponivel para acesso
                </p>
              </div>
              <Switch
                id="trainingActive"
                checked={trainingForm.isActive === 1}
                onCheckedChange={(checked) => setTrainingForm(f => ({ ...f, isActive: checked ? 1 : 0 }))}
                data-testid="switch-training-active"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTrainingDialogOpen(false)}>
              Cancelar
            </Button>
            <Button 
              onClick={handleSubmitTraining}
              disabled={!trainingForm.title || createTrainingMutation.isPending || updateTrainingMutation.isPending}
              data-testid="button-submit-training"
            >
              {(createTrainingMutation.isPending || updateTrainingMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isEditing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteCategoryOpen} onOpenChange={setIsDeleteCategoryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Categoria</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a categoria "{selectedCategory?.name}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedCategory && deleteCategoryMutation.mutate(selectedCategory.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCategoryMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteArticleOpen} onOpenChange={setIsDeleteArticleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Artigo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o artigo "{selectedArticle?.title}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedArticle && deleteArticleMutation.mutate(selectedArticle.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteArticleMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isDeleteTrainingOpen} onOpenChange={setIsDeleteTrainingOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Conteudo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o conteudo "{selectedTraining?.title}"?
              Esta acao nao pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedTraining && deleteTrainingMutation.mutate(selectedTraining.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTrainingMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
