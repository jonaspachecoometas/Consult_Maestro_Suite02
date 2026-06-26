import { useQuery } from "@tanstack/react-query";
import { 
  Loader2, 
  GraduationCap,
  Video,
  FileText,
  Link as LinkIcon,
  ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TrainingContent } from "@shared/schema";

const contentTypeConfig: Record<string, { label: string; icon: typeof Video }> = {
  video: { label: 'Video', icon: Video },
  document: { label: 'Documento', icon: FileText },
  link: { label: 'Link', icon: LinkIcon },
};

export default function PortalTraining() {
  const { data: trainings = [], isLoading } = useQuery<TrainingContent[]>({
    queryKey: ['/api/portal/training'],
  });

  const trainingsByType = trainings.reduce((acc, training) => {
    const type = training.contentType || 'document';
    if (!acc[type]) acc[type] = [];
    acc[type].push(training);
    return acc;
  }, {} as Record<string, TrainingContent[]>);

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
            Treinamentos
          </h1>
          <p className="text-muted-foreground">
            Acesse conteudos de capacitacao
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-trainings">
              {trainings.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Videos</CardTitle>
            <Video className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-video-count">
              {trainingsByType['video']?.length || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documentos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-document-count">
              {trainingsByType['document']?.length || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {trainings.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trainings.map((training) => {
            const typeConfig = contentTypeConfig[training.contentType || 'document'];
            const Icon = typeConfig.icon;
            
            return (
              <Card key={training.id} data-testid={`card-training-${training.id}`}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base line-clamp-2" data-testid={`text-training-title-${training.id}`}>
                        {training.title}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" size="sm">
                          {typeConfig.label}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {training.description && (
                    <CardDescription className="line-clamp-3 mb-4">
                      {training.description}
                    </CardDescription>
                  )}
                  {training.contentUrl && (
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => window.open(training.contentUrl!, '_blank')}
                      data-testid={`button-access-${training.id}`}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Acessar Conteudo
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GraduationCap className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Nenhum conteudo de treinamento disponivel no momento.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
