import Link from "next/link";

/**
 * The global footer, and the app's only route to the legal pages.
 *
 * SPDI Rule 4 makes publishing a privacy policy a duty, and a policy nobody can
 * reach from the product is not published — so these links are load-bearing,
 * not decoration (docs/design/phase-1-legal-and-ops.md §2.3, §6.2). Google's
 * OAuth brand verification also expects the policy URL to be reachable on the
 * app's own domain.
 */
const footerLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-xs text-slate-500 dark:text-slate-400 sm:px-6 lg:px-10">
        <p>© {new Date().getFullYear()} Invoicey</p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="transition hover:text-slate-900 hover:underline hover:underline-offset-4 dark:hover:text-slate-100"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>Built for practical teams shipping invoices, not slide decks.</p>
      </div>
    </footer>
  );
}
