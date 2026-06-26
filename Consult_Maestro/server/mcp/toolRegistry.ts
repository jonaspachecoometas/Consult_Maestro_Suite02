/**
 * MCP Hub — Tool Registry (Sprint 1)
 *
 * Centralized registry for all agent tools. Replaces the hardcoded switch/case
 * in superAgentService. Each module registers its tools once at boot via
 * `registerAllTools()` (Sprint 2). Sprint 1 only registers the 5 core tools
 * already used by the Super Agent.
 *
 * Tools with `requiresConfirmation: true` short-circuit when `ctx.userConfirmed`
 * is missing, returning a sentinel object the frontend can detect to render
 * a confirmation modal.
 */

/**
 * Minimal Zod-shaped contract — accepted because we don't want to make the
 * registry depend on `zod` directly. Any object with `.safeParse(input)` that
 * returns `{ success, data, error? }` works (notably zod's ZodSchema).
 */
export interface InputValidator {
  safeParse: (input: unknown) =>
    | { success: true; data: any }
    | { success: false; error: { errors?: Array<{ path?: any[]; message: string }>; issues?: Array<{ path?: any[]; message: string }> } };
}

export interface ToolDefinition {
  /** Unique tool name. Convention: snake_case, prefix with module if module-specific. */
  name: string;
  /** Human-readable description shown to the LLM. */
  description: string;
  /** JSON Schema describing the tool's input. Passed straight to Anthropic tools API. */
  inputSchema: Record<string, any>;
  /** Module that owns this tool: 'core' | 'control' | 'societario' | 'recovery' | 'google' | ... */
  module: string;
  /** If true, executor must pass `ctx.userConfirmed === true` or the call short-circuits. */
  requiresConfirmation: boolean;
  /**
   * Optional Zod (or compatible) validator. When present, the registry runs
   * `.safeParse(input)` BEFORE calling `handler` and short-circuits with
   * `{ error }` if validation fails. Sprint 2 made this central so callers
   * (`/api/mcp/tools/:name`, Super Agent loop) don't have to duplicate the
   * `safeParse` boilerplate inside every handler.
   */
  inputValidator?: InputValidator;
  /** Async handler. Receives validated input + context, returns any JSON-serialisable result. */
  handler: (input: any, ctx: ToolContext) => Promise<any>;
}

export interface ToolContext {
  tenantId: string;
  userId?: string | null;
  /** Optional project context (used by core tools to scope to a project). */
  projectId?: string | null;
  /** Set by the API layer when the user has explicitly confirmed an action via UI. */
  userConfirmed?: boolean;
  /** Free-form per-tool extras (e.g. session id, request id). */
  meta?: Record<string, any>;
}

/** Sentinel returned when a confirmation-required tool is invoked without `userConfirmed`. */
export interface ConfirmationRequired {
  __requires_confirmation: true;
  toolName: string;
  input: any;
  module: string;
  description: string;
}

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      // Re-registration is allowed (e.g. hot reload in dev) but we warn.
      console.warn(`[mcp/toolRegistry] tool '${def.name}' already registered — overwriting`);
    }
    this.tools.set(def.name, def);
  }

  /** True if a tool with this name exists. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Returns the registered ToolDefinition or null. */
  get(name: string): ToolDefinition | null {
    return this.tools.get(name) ?? null;
  }

  /**
   * List tools available for a given tenant context. Sprint 1 returns all tools.
   * Sprint 4 will filter by partner API key scopes / module gating.
   */
  listForAgent(_tenantId: string): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools in the Anthropic tools API format (for LLM tool-calling).
   * Mirrors the previous TOOL_DEFS shape from superAgentService.
   */
  listForAnthropic(tenantId: string): Array<{ name: string; description: string; input_schema: any }> {
    return this.listForAgent(tenantId).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }

  /**
   * Execute a tool by name. Catches handler errors and returns `{ error }` so
   * tool-calling loops keep going rather than crashing.
   */
  async execute(toolName: string, input: any, ctx: ToolContext): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { error: `Tool desconhecida: ${toolName}` };
    }
    if (tool.requiresConfirmation && !ctx.userConfirmed) {
      const sentinel: ConfirmationRequired = {
        __requires_confirmation: true,
        toolName,
        input,
        module: tool.module,
        description: tool.description,
      };
      return sentinel;
    }
    // Sprint 2 — central Zod validation. Tools that opt-in via `inputValidator`
    // get parsed/coerced here so handlers always receive trusted shapes, and
    // every caller (Super Agent loop, /api/mcp/tools/:name, future MCP-public
    // route) gets the same {error} contract on bad input.
    let validatedInput: any = input ?? {};
    if (tool.inputValidator) {
      const parsed = tool.inputValidator.safeParse(validatedInput);
      if (!parsed.success) {
        const issues = parsed.error.issues ?? parsed.error.errors ?? [];
        const msg = issues
          .map((i) => {
            const path = (i.path ?? []).join(".");
            return path ? `${path}: ${i.message}` : i.message;
          })
          .join("; ");
        return { error: `Input inválido: ${msg || "schema rejected input"}` };
      }
      validatedInput = parsed.data;
    }
    try {
      return await tool.handler(validatedInput, ctx);
    } catch (e: any) {
      console.error(`[mcp/toolRegistry] tool '${toolName}' failed:`, e?.message ?? e);
      return { error: e?.message ?? String(e) };
    }
  }

  /** Reset registry (test-only). */
  _reset(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
