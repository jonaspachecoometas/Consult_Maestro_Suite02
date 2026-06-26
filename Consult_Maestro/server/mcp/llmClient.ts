/**
 * Task #47 — Chat helper unificado para os 4 providers.
 *
 * Usado dentro do callback de runWithOrchestration para enviar uma mensagem
 * de chat e obter texto + tokens. Cada provider tem seu próprio formato:
 *   - anthropic: SDK oficial (@anthropic-ai/sdk).
 *   - gemini:   REST direto (`generateContent`) — sem SDK, evita dependência.
 *   - kimi:     OpenAI-compatible (POST /chat/completions).
 *   - ollama:   POST /api/chat (modelo local).
 *
 * Esse helper NÃO faz cascata sozinho — quem orquestra é llmOrchestrator.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { OrchestrationCallbackArgs, OrchestrationCallbackResult } from "./llmOrchestrator";

export interface ChatLLMRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  /**
   * AbortSignal opcional. Quando o orquestrador faz timeout de tier, ele
   * aborta este signal para que `fetch` (Gemini/Kimi/Ollama) e Anthropic SDK
   * cancelem a request em vez de deixar a conexão pendurada.
   */
  signal?: AbortSignal;
}

export async function callChatLLM(
  args: OrchestrationCallbackArgs,
  req: ChatLLMRequest,
): Promise<OrchestrationCallbackResult<string>> {
  const maxTokens = req.maxTokens ?? 2048;
  const signal = req.signal;

  if (args.provider === "anthropic") {
    if (!args.apiKey) throw new Error("anthropic sem apiKey");
    const client = new Anthropic({ apiKey: args.apiKey, baseURL: args.baseUrl ?? undefined });
    const result = await client.messages.create(
      {
        model: args.model,
        max_tokens: maxTokens,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.userPrompt }],
      },
      { signal },
    );
    const text = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    return {
      data: text,
      tokensIn: result.usage?.input_tokens ?? 0,
      tokensOut: result.usage?.output_tokens ?? 0,
    };
  }

  if (args.provider === "gemini") {
    if (!args.apiKey) throw new Error("gemini sem apiKey");
    // Modelo pode vir com prefixo "models/"; normalize.
    const modelId = args.model.replace(/^models\//, "");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: req.userPrompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) throw new Error(`gemini HTTP ${r.status}`);
    const j: any = await r.json();
    const text = (j?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "").join("\n");
    return {
      data: text,
      tokensIn: j?.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: j?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }

  if (args.provider === "kimi") {
    if (!args.apiKey) throw new Error("kimi sem apiKey");
    const root = (args.baseUrl ?? "https://api.moonshot.cn/v1").replace(/\/$/, "");
    const r = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        model: args.model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
      }),
      signal,
    });
    if (!r.ok) throw new Error(`kimi HTTP ${r.status}`);
    const j: any = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    return {
      data: text,
      tokensIn: j?.usage?.prompt_tokens ?? 0,
      tokensOut: j?.usage?.completion_tokens ?? 0,
    };
  }

  if (args.provider === "ollama") {
    if (!args.baseUrl) throw new Error("ollama sem baseUrl");
    const root = args.baseUrl.replace(/\/$/, "");
    const r = await fetch(`${root}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: args.model,
        stream: false,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userPrompt },
        ],
        options: { num_predict: maxTokens },
      }),
      signal,
    });
    if (!r.ok) throw new Error(`ollama HTTP ${r.status}`);
    const j: any = await r.json();
    const text = j?.message?.content ?? "";
    return {
      data: text,
      tokensIn: j?.prompt_eval_count ?? 0,
      tokensOut: j?.eval_count ?? 0,
    };
  }

  throw new Error(`provider não suportado: ${args.provider}`);
}
