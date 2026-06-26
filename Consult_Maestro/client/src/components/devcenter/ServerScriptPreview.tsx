import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Copy, Play, Check, FileCode } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Props {
  code: string;
  fileName: string;
  language?: string;
}

// Highlight muito leve para Python/JS — apenas keywords e strings.
// Sem dependências externas. Funciona como dica visual, não como parser real.
function highlight(code: string, lang: string): string {
  const escaped = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const pyKeywords = [
    "def", "class", "return", "if", "elif", "else", "for", "while", "import",
    "from", "as", "try", "except", "finally", "raise", "with", "in", "not",
    "and", "or", "is", "None", "True", "False", "self", "lambda", "pass",
    "yield", "global", "nonlocal",
  ];
  const jsKeywords = [
    "function", "const", "let", "var", "return", "if", "else", "for", "while",
    "import", "from", "as", "try", "catch", "finally", "throw", "new", "this",
    "class", "extends", "async", "await", "true", "false", "null", "undefined",
    "typeof", "instanceof",
  ];

  const kw = lang === "javascript" || lang === "typescript" ? jsKeywords : pyKeywords;

  let html = escaped;
  // strings (greedy mas suficiente)
  html = html.replace(/("([^"\\]|\\.)*"|'([^'\\]|\\.)*')/g, '<span class="text-emerald-600 dark:text-emerald-400">$1</span>');
  // comentários
  if (lang === "javascript" || lang === "typescript") {
    html = html.replace(/(\/\/[^\n]*)/g, '<span class="text-muted-foreground italic">$1</span>');
  } else {
    html = html.replace(/(#[^\n]*)/g, '<span class="text-muted-foreground italic">$1</span>');
  }
  // keywords
  const kwRe = new RegExp(`\\b(${kw.join("|")})\\b`, "g");
  html = html.replace(kwRe, '<span class="text-purple-600 dark:text-purple-400 font-medium">$1</span>');
  // numbers
  html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="text-amber-600 dark:text-amber-400">$1</span>');
  return html;
}

export default function ServerScriptPreview({ code, fileName, language = "python" }: Props) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: "Código copiado", description: fileName });
    } catch {
      toast({ title: "Falha ao copiar", variant: "destructive" });
    }
  };

  const html = highlight(code, language);
  const lineCount = code.split("\n").length;

  return (
    <div className="space-y-3" data-testid="preview-server-script">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-purple-600" />
          <h3 className="text-sm font-semibold" data-testid="text-script-name">{fileName}</h3>
          <Badge variant="outline" className="text-[10px]">{language}</Badge>
          <Badge variant="secondary" className="text-[10px]">{lineCount} linhas</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            data-testid="button-copy-code"
            className="h-7 text-xs gap-1.5"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    data-testid="button-run-test"
                    className="h-7 text-xs gap-1.5 cursor-not-allowed"
                  >
                    <Play className="h-3 w-3" />
                    Executar teste
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Disponível após deploy em homologação (Sprint 3)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      <ScrollArea className="max-h-[480px] border rounded-md bg-zinc-950 dark:bg-zinc-900">
        <pre
          className="text-xs font-mono leading-relaxed p-4 text-zinc-100"
          data-testid="code-block"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </ScrollArea>

      <p className="text-[10px] text-muted-foreground italic">
        Highlight visual aproximado · Para análise sintática completa, exporte o arquivo e abra na sua IDE.
      </p>
    </div>
  );
}
