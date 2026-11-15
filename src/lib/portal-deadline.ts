/** Spanish relative deadline label for the creator portal (dates are Bogotá YYYY-MM-DD). */
export function deadlineLabel(date: string, today: string) {
  const days = Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  const tone: "late" | "today" | "soon" | "later" = days < 0 ? "late" : days === 0 ? "today" : days <= 2 ? "soon" : "later";
  const rel =
    days < 0
      ? `Vencida hace ${-days} ${days === -1 ? "día" : "días"}`
      : days === 0 ? "Hoy" : days === 1 ? "Mañana" : `Vence en ${days} días`;
  const full = new Date(date + "T00:00:00Z").toLocaleDateString("es-CO", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  });
  return { days, rel, full: full.charAt(0).toUpperCase() + full.slice(1), tone };
}
