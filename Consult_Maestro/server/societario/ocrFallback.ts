import Anthropic from "@anthropic-ai/sdk";
import { runWithOrchestration } from "../agentService";

// Limites de segurança (Claude PDF beta aceita até ~32 MB / 100 páginas em base64)
const MAX_OCR_BYTES = 20 * 1024 * 1024; // 20 MB
// PDFs multi-página (10-50 páginas) podem levar 2-4 min no Claude.
const OCR_TIMEOUT_MS = 240_000; // 4 min

const PROMPT_OCR =
  "Você é um extrator de texto OCR. Sua tarefa é transcrever TODO o conteúdo " +
  "textual visível neste documento, página por página. Inclua cabeçalhos, " +
  "rodapés, números de página, assinaturas (se legíveis), carimbos, datas, " +
  "valores e qualquer texto manuscrito que consiga decifrar. " +
  "Mantenha a ordem de leitura e as quebras de seção. Para tabelas, use " +
  "formato markdown ou linha-por-linha. " +
  "IMPORTANTE: tente extrair MESMO QUE a qualidade seja baixa — texto parcial " +
  "é melhor que nada. Use [ilegível] apenas para trechos pontuais que não " +
  "consegue decifrar, mas continue extraindo o resto. " +
  "NÃO adicione introduções, conclusões ou comentários seus — apenas o texto " +
  "transcrito do documento. Comece direto pelo conteúdo da primeira página.";

function imageMediaType(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m === "image/png" || m === "image/jpeg" || m === "image/webp" || m === "image/gif") return m;
  return null;
}

/**
 * OCR/extração via Claude. Funciona para:
 *  - application/pdf  (PDFs com texto E PDFs escaneados — Claude renderiza páginas)
 *  - image/png|jpeg|webp|gif
 * Retorna texto extraído ou string vazia em caso de falha/ilegível.
 *
 * Task #48 — embrulhado em runWithOrchestration (`societario:ocr`,
 * anthropic-only) para auditoria em llm_decisions. Outros providers não
 * suportam o mesmo formato de PDF/vision; cascata real fica restrita ao
 * Anthropic. Se anthropic estiver unhealthy, o orquestrador falha e o caller
 * trata como `failed` (mesma semântica anterior).
 */
export async function runOcrViaClaude(
  buffer: Buffer,
  mimeType: string,
  tenantId: string | null,
): Promise<{ text: string; status: "ok" | "empty" | "failed"; errorMessage?: string }> {
  if (!buffer || buffer.length === 0) return { text: "", status: "empty" };
  if (buffer.length > MAX_OCR_BYTES) {
    return {
      text: "",
      status: "failed",
      errorMessage: `Arquivo excede limite de OCR (${(MAX_OCR_BYTES / 1024 / 1024).toFixed(0)} MB).`,
    };
  }

  const isPdf = mimeType === "application/pdf";
  const imgMime = imageMediaType(mimeType);
  if (!isPdf && !imgMime) {
    return { text: "", status: "failed", errorMessage: `OCR não suportado para ${mimeType}.` };
  }

  const base64 = buffer.toString("base64");
  const block: any = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: imgMime, data: base64 } };

  // OCR só roda para tenants reais (chave + audit). Se vier null, mantemos o
  // comportamento anterior de pular a chamada.
  if (!tenantId) {
    return { text: "", status: "failed", errorMessage: "OCR exige tenantId." };
  }

  try {
    const orch = await runWithOrchestration(
      "societario:ocr",
      tenantId,
      // OCR de PDFs societários = dados sensíveis do cliente, mas Ollama não
      // suporta PDF vision. Mantemos sensitivity=internal e forceProvider para
      // pular eventual prepend de Ollama por budget low (que falharia antes).
      { sensitivity: "internal", tierTimeoutMs: OCR_TIMEOUT_MS, forceProvider: "anthropic" },
      async (cb) => {
        if (cb.provider !== "anthropic") {
          throw new Error(`OCR via vision exige Anthropic; orquestrador escolheu ${cb.provider}.`);
        }
        const client = new Anthropic({ apiKey: cb.apiKey ?? undefined, baseURL: cb.baseUrl ?? undefined });
        const resp: any = await client.messages.create(
          {
            model: cb.model,
            max_tokens: 8000,
            messages: [
              { role: "user", content: [block, { type: "text", text: PROMPT_OCR }] },
            ],
          } as any,
          {
            signal: cb.signal as any,
            // Beta header para garantir suporte a PDF em modelos antigos.
            // Claude 3.7+/4.x suportam nativamente, mas o header é inofensivo.
            headers: { "anthropic-beta": "pdfs-2024-09-25" },
          },
        );
        const stop = resp?.stop_reason || "?";
        const usage = resp?.usage || {};
        console.log(
          `[ocr] mime=${mimeType} bytes=${buffer.length} model=${cb.model} stop=${stop} ` +
          `in=${usage.input_tokens || "?"} out=${usage.output_tokens || "?"}`,
        );
        const text = (resp?.content || [])
          .filter((b: any) => b?.type === "text")
          .map((b: any) => String(b.text || ""))
          .join("\n")
          .trim();
        return {
          data: text,
          tokensIn: usage.input_tokens || 0,
          tokensOut: usage.output_tokens || 0,
        };
      },
    );

    const text = orch.data;
    // Heurística mais permissiva: se Claude devolveu pelo menos uma frase
    // (>=15 chars úteis) entrega como ok. Só consideramos "empty" se vier
    // realmente vazio ou for só uma anotação genérica.
    if (!text) return { text: "", status: "empty" };
    if (text.length < 15) {
      console.log(`[ocr] resposta muito curta (${text.length} chars): "${text}"`);
      return { text: "", status: "empty" };
    }
    return { text, status: "ok" };
  } catch (e: any) {
    console.error("[ocr] erro:", e?.message);
    return { text: "", status: "failed", errorMessage: e?.message || "Falha no OCR" };
  }
}
