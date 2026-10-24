import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VenusX Portal — Agency Operating System" },
      {
        name: "description",
        content: "Sign in to the VenusX Portal for executives, team members and creators.",
      },
      { property: "og:title", content: "VenusX Portal" },
      {
        property: "og:description",
        content: "The unified operating system for the VenusX agency.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const authParameters = [
      "error",
      "error_code",
      "error_description",
      "access_token",
      "refresh_token",
      "token_hash",
      "code",
      "type",
    ];
    if (authParameters.some((key) => query.has(key) || fragment.has(key))) {
      window.location.replace(`/auth${window.location.search}${window.location.hash}`);
    }
  }, []);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--gold-soft),transparent_60%)]" />
      <img
        src="/venusx-logo.jpeg"
        alt="VenusX"
        className="relative h-40 w-40 rounded-full shadow-gold"
      />
      <h1 className="relative mt-10 font-display text-5xl md:text-7xl">
        Venus<span className="text-gold-gradient">X</span> Portal
      </h1>
      <p className="relative mt-4 max-w-md text-muted-foreground">
        One place for the agency, the team and every creator.
      </p>
      <Link
        to="/auth"
        className="relative mt-10 rounded-md bg-gold-gradient px-8 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-gold"
      >
        Enter portal
      </Link>
    </main>
  );
}
