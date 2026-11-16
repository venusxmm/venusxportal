// VenusX push-only service worker: shows notifications, no caching.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "VenusX", body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "VenusX", {
      body: d.body || "",
      icon: "/favicon.png",
      badge: "/favicon.png",
      tag: d.tag || undefined,
      data: { url: d.url || "/portal" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/portal", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (new URL(c.url).origin === self.location.origin && "focus" in c) { c.navigate(url); return c.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
