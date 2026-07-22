"use client";

import { useEffect } from "react";

// Root-level boundary: this replaces the whole document when the root layout or
// a shared provider throws, so it must render its own <html>/<body> and must not
// depend on app CSS/components that could be part of the failure. Keep it inline
// and self-contained.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global render error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
          background: "#0f172a",
          color: "#e2e8f0",
        }}
      >
        <main
          style={{
            maxWidth: "28rem",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.875rem",
              color: "#94a3b8",
              marginBottom: "1.5rem",
            }}
          >
            An unexpected error interrupted the page. You can try again, or
            reload if the problem persists.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#6366f1",
              color: "#ffffff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
