export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-slate-500 dark:text-slate-400 sm:px-6 lg:px-10">
        <p>© {new Date().getFullYear()} Invoicey</p>
        <p>Built for practical teams shipping invoices, not slide decks.</p>
      </div>
    </footer>
  );
}
