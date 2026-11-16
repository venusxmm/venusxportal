import { buildPushPayload } from "@block65/webcrypto-web-push";

export type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

/** Sends one Web Push message; returns "ok" | "gone" (expired, delete it) | "error". */
export async function sendPush(sub: Sub, msg: { title: string; body: string; url: string; tag: string }) {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  if (!publicKey || !privateKey) throw new Error("Push keys missing");
  const payload = await buildPushPayload(
    { data: JSON.stringify(msg), options: { ttl: 6 * 3600, urgency: "normal", topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    { subject: "mailto:soporte@venusxportal.lovable.app", publicKey, privateKey },
  );
  const res = await fetch(sub.endpoint, payload);
  if (res.status === 404 || res.status === 410) return "gone" as const;
  return res.ok ? ("ok" as const) : ("error" as const);
}
