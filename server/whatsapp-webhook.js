import { createHmac, timingSafeEqual } from "node:crypto";

export const webhookPath = "/webhooks/whatsapp";
const ranks = { sent: 1, failed: 2, delivered: 3, read: 4 };
const statuses = {
  sent: "Enviado",
  failed: "Error de envío",
  delivered: "Entregado",
  read: "Leído",
};

export function verifySignature(secret, bytes, signature) {
  if (
    !secret ||
    !Buffer.isBuffer(bytes) ||
    !/^sha256=[0-9a-f]{64}$/i.test(signature ?? "")
  )
    return false;
  const actual = createHmac("sha256", secret).update(bytes).digest();
  return timingSafeEqual(actual, Buffer.from(signature.slice(7), "hex"));
}

export function updateDeliveries(payload, phoneId, lookup, save) {
  if (
    payload?.object !== "whatsapp_business_account" ||
    !Array.isArray(payload.entry)
  )
    return;
  for (const entry of payload.entry)
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (
        change.field !== "messages" ||
        value?.metadata?.phone_number_id !== phoneId ||
        !Array.isArray(value.statuses)
      )
        continue;
      for (const status of value.statuses) {
        if (
          typeof status?.id !== "string" ||
          !Object.hasOwn(ranks, status.status)
        )
          continue;
        const attempt = lookup(status.id);
        if (!attempt || ranks[status.status] <= (ranks[attempt.delivery] ?? 0))
          continue;
        attempt.delivery = status.status;
        attempt.deliveryLabel = statuses[status.status];
        if (
          status.status === "failed" &&
          Number.isInteger(status.errors?.[0]?.code)
        )
          attempt.deliveryLabel += ` · código Meta ${status.errors[0].code}`;
        save(attempt);
      }
    }
}
