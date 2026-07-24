interface InvoiceyMarkProps {
  className?: string;
}

/**
 * The Invoicey monogram: the initial "i" drawn as a torn receipt (printed
 * lines + perforated bottom edge) with a ₹ coin as its tittle.
 *
 * Inlined as JSX rather than an <img> so the tile/coin can invert with the
 * theme via Tailwind `dark:` classes — no theme-dependent src swap, so no
 * flash of the wrong variant on first paint. The standalone file equivalents
 * live at public/icon.svg (light) and public/icon-dark.svg (dark).
 */
export function InvoiceyMark({ className }: InvoiceyMarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Invoicey"
    >
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        rx="24"
        className="fill-slate-900 dark:fill-blue-500"
      />
      <path
        d="M40 68 V35 a3 3 0 0 1 3 -3 h14 a3 3 0 0 1 3 3 V68 l-3.3 4 l-3.3 -4 l-3.4 4 l-3.3 -4 l-3.4 4 l-3.3 -4 Z"
        className="fill-white"
      />
      <rect x="44" y="42" width="12" height="2" rx="1" className="fill-slate-900 dark:fill-blue-700" />
      <rect x="44" y="48" width="12" height="2" rx="1" className="fill-slate-900 dark:fill-blue-700" />
      <rect x="44" y="54" width="8" height="2" rx="1" className="fill-slate-900 dark:fill-blue-700" />
      <circle cx="50" cy="20" r="9" className="fill-blue-500 dark:fill-slate-900" />
      <circle
        cx="50"
        cy="20"
        r="9"
        fill="none"
        strokeWidth="1.5"
        className="stroke-blue-300 dark:stroke-blue-700"
      />
      <text
        x="50"
        y="23.5"
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        className="fill-white"
      >
        ₹
      </text>
    </svg>
  );
}

export default InvoiceyMark;
