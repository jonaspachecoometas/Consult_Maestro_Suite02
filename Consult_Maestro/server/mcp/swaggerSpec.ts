/**
 * MCP Hub — OpenAPI/Swagger spec (Sprint 4)
 *
 * Defines the OpenAPI 3.0 contract for the public `/mcp/v1` endpoint, served
 * by `swagger-ui-express` at `/api-docs`. Annotations in `publicRouter.ts`
 * (JSDoc with `@openapi`) are picked up by `swagger-jsdoc`.
 */

import swaggerJSDoc from "swagger-jsdoc";

function deriveServerUrl(): string {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");
  const domains = (process.env.REPLIT_DOMAINS || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (domains.length > 0) return `https://${domains[0]}`;
  const dev = process.env.REPLIT_DEV_DOMAIN?.trim();
  if (dev) return `https://${dev}`;
  return "http://localhost:5000";
}

export function buildSwaggerSpec(): object {
  const serverUrl = deriveServerUrl();
  return swaggerJSDoc({
    definition: {
      openapi: "3.0.3",
      info: {
        title: "Arcádia MCP Hub — Public API",
        version: "1.0.0",
        description: [
          "Public Model Context Protocol (MCP) endpoint for partners.",
          "",
          "Authentication: send the partner API key in the `X-MCP-Key` HTTP header.",
          "",
          "Rate limit: per key, defaults to 60 requests/minute. Headers `X-RateLimit-*` are returned on every response.",
          "",
          "Scopes: each key is bound to one tenant and a list of module scopes (e.g. `control`, `google`, `microsoft`, `whatsapp`, `societario`, `recovery`, `core`). The wildcard `*` grants all modules.",
          "",
          "Tools that mutate external state (`requiresConfirmation: true`) return HTTP 202 with a `__requires_confirmation` sentinel; the partner must repeat the request with `userConfirmed: true` to actually execute.",
        ].join("\n"),
      },
      servers: [{ url: serverUrl, description: "Current deployment" }],
      tags: [
        { name: "MCP Public", description: "Endpoints exposed to external partners via API key." },
      ],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "X-MCP-Key",
            description: "Partner API key, format `arc_<base64url>`. Generated in /configuracoes/api-keys.",
          },
        },
        schemas: {
          ToolDef: {
            type: "object",
            properties: {
              name: { type: "string" },
              module: { type: "string" },
              description: { type: "string" },
              requiresConfirmation: { type: "boolean" },
              inputSchema: { type: "object" },
            },
          },
          ConfirmationRequired: {
            type: "object",
            properties: {
              __requires_confirmation: { type: "boolean", example: true },
              toolName: { type: "string" },
              input: { type: "object" },
              module: { type: "string" },
              description: { type: "string" },
            },
          },
          Error: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    apis: ["./server/mcp/publicRouter.ts"],
  }) as object;
}
