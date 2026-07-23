"use client";

import { useEffect } from "react";

// Root-level boundary: this replaces the whole document when the root layout or
// a shared provider throws, so it must render its own <html>/<body> and must not
// depend on app CSS/components that could be part of the failure. Keep it inline
// and self-contained.
//
// Because globals.css may be exactly what failed to load, the theme cannot come
// from the `.dark` class here. The palette is expressed as CSS variables with a
// prefers-color-scheme fallback so a light-mode user is not dropped onto a black
// screen, and the values match the app's own tokens rather than inventing a new
// accent.
const CRITICAL_CSS = `
  :root {
    color-scheme: light dark;
    --err-bg: #f8fafc;
    --err-surface: #ffffff;
    --err-border: #e2e8f0;
    --err-ink: #0f172a;
    --err-muted: #475569;
    --err-action-bg: #0f172a;
    --err-action-ink: #f8fafc;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --err-bg: #0f172a;
      --err-surface: #111c31;
      --err-border: #27364a;
      --err-ink: #f8fafc;
      --err-muted: #94a3b8;
      --err-action-bg: #f8fafc;
      --err-action-ink: #0f172a;
    }
  }
  .err-body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: var(--err-bg);
    color: var(--err-ink);
    font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .err-card {
    max-width: 30rem;
    width: 100%;
    padding: 2rem;
    border: 1px solid var(--err-border);
    border-radius: 12px;
    background: var(--err-surface);
    box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  }
  .err-kicker {
    margin: 0 0 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--err-muted);
  }
  .err-title { margin: 0; font-size: 1.25rem; font-weight: 600; letter-spacing: -0.015em; }
  .err-copy {
    margin: 0.5rem 0 1.5rem;
    font-size: 0.875rem;
    line-height: 1.625;
    color: var(--err-muted);
  }
  .err-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .err-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 1rem;
    border-radius: 10px;
    border: 1px solid transparent;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    text-decoration: none;
  }
  .err-btn-primary { background: var(--err-action-bg); color: var(--err-action-ink); }
  .err-btn-secondary {
    background: transparent;
    border-color: var(--err-border);
    color: var(--err-ink);
  }
  .err-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--err-surface), 0 0 0 4px #3b82f6;
  }
  .err-digest {
    margin: 1.5rem 0 0;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
    color: var(--err-muted);
    word-break: break-all;
  }
`;

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
      <head>
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_CSS }} />
      </head>
      <body className="err-body">
        <main className="err-card" role="alert">
          <p className="err-kicker">Invoicey</p>
          <h1 className="err-title">This page stopped loading</h1>
          <p className="err-copy">
            Something broke before the page finished rendering. Nothing you saved
            has been lost — your invoices are stored on the server, not in this
            page.
          </p>
          <div className="err-actions">
            <button type="button" onClick={reset} className="err-btn err-btn-primary">
              Reload this page
            </button>
            <a href="/dashboard" className="err-btn err-btn-secondary">
              Go to dashboard
            </a>
          </div>
          {error.digest ? (
            <p className="err-digest">Reference: {error.digest}</p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
