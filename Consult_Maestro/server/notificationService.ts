import { db } from "./db";
import { notifications } from "../shared/schema";

export interface NotificationConfig {
  channel: "inapp" | "whatsapp" | "email";
  recipients: string[];
  title: string;
  message: string;
  type?: "info" | "warning" | "success" | "error";
  sourceType?: string;
  sourceId?: string;
}

/**
 * Sends a notification through the requested channel. The in-app channel
 * is fully implemented (writes rows to the notifications table).
 *
 * WhatsApp and email are stub-fallbacks: until EVOLUTION_API_URL/SMTP
 * credentials are wired up they degrade gracefully into an in-app
 * notification labelled with the originally requested channel, so the
 * automation flow keeps working end-to-end without crashing.
 */
export async function sendNotification(
  tenantId: string,
  config: NotificationConfig,
): Promise<{ delivered: number; channel: string; fallback?: boolean }> {
  switch (config.channel) {
    case "inapp":
      return sendInApp(tenantId, config);
    case "whatsapp":
    case "email":
      return sendStubFallback(tenantId, config);
    default:
      throw new Error(`Canal desconhecido: ${config.channel}`);
  }
}

async function sendInApp(tenantId: string, c: NotificationConfig) {
  const recipients = c.recipients?.length ? c.recipients : [null];
  const rows = recipients.map((userId) => ({
    tenantId,
    userId: userId as string | null,
    title: c.title,
    body: c.message,
    type: c.type ?? "info",
    sourceType: c.sourceType,
    sourceId: c.sourceId,
  }));
  await db.insert(notifications).values(rows as any);
  return { delivered: rows.length, channel: "inapp" as const };
}

async function sendStubFallback(tenantId: string, c: NotificationConfig) {
  console.warn(
    `[notifications] canal "${c.channel}" não configurado — gravando como in-app`,
  );
  await db.insert(notifications).values({
    tenantId,
    userId: null,
    title: `[${c.channel.toUpperCase()}] ${c.title}`,
    body:
      `Destinatários: ${(c.recipients || []).join(", ") || "(nenhum)"}\n\n${c.message}\n\n` +
      `(Canal ${c.channel} ainda não está configurado — entrega em modo in-app.)`,
    type: c.type ?? "info",
    sourceType: c.sourceType,
    sourceId: c.sourceId,
  });
  return {
    delivered: c.recipients?.length || 0,
    channel: c.channel,
    fallback: true,
  };
}
