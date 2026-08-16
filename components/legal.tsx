import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The single source of truth for the legal contact details, the retention
 * table, and the shared typography used by /privacy, /terms and /contact.
 *
 * It lives in `components/` rather than `lib/` because most of what it exports
 * is JSX. The point is that the grievance address appears in exactly ONE place
 * in the source, so it cannot drift between three pages.
 *
 * Every value in square brackets is an OWNER ACTION — see §2.5 and §6.3. The
 * pages render bracketed values as inert text rather than broken `mailto:`
 * links, so an unfilled placeholder is visible rather than silently dead.
 */

export const LEGAL = {
  entityName: "[ENTITY NAME]",
  postalAddress: "[POSTAL ADDRESS]",
  grievanceOfficer: "[GRIEVANCE OFFICER NAME]",
  grievanceEmail: "[GRIEVANCE EMAIL]",
  supportEmail: "[SUPPORT EMAIL]",
  securityEmail: "[SECURITY EMAIL]",
  effectiveDate: "[EFFECTIVE DATE]",
  /**
   * SPDI Rule 5(9) requires redressal within one month; DPDP Rule 14(3) allows
   * ninety days. One month is the stricter of the two and is the one in force
   * until 2027-05-13, so it is the only number published. See §1.2 / §2.4.
   */
  grievanceSlaDays: 30,
} as const;

export const isPlaceholder = (value: string) => value.startsWith("[");

/**
 * Retention as the database actually enforces it. Read straight off
 * `computeExpireAt` in `lib/server/log.ts` — a per-document TTL index, not a
 * promise kept by hand. If that function changes, change this table.
 */
export const LOG_RETENTION_ROWS: ReadonlyArray<{ kind: string; window: string }> = [
  { kind: "Errors, including stack traces", window: "365 days" },
  { kind: "Administrator audit records", window: "365 days" },
  { kind: "Warnings", window: "90 days" },
  { kind: "Sign-in and invoice activity", window: "180 days" },
  { kind: "AI-assistant requests and in-browser events", window: "30 days" },
  { kind: "Everything else", window: "30 days" },
];

/** Renders a `mailto:` when the address is real, and inert text when it is not. */
export function EmailLink({ address }: { address: string }) {
  if (isPlaceholder(address)) {
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
        {address}
      </span>
    );
  }

  return (
    <a
      href={`mailto:${address}`}
      className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
    >
      {address}
    </a>
  );
}

/** Same treatment for non-email owner inputs (entity name, address, city). */
export function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[0.85em] text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
      {children}
    </span>
  );
}

/**
 * The unmissable banner at the top of both documents. These are an engineer's
 * drafts, accurate about the code and unreviewed as law. Saying so is not
 * modesty — a policy that implies legal review it has not had is itself a
 * misrepresentation.
 */
export function DraftNotice({ document }: { document: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-100">
      <p className="font-semibold uppercase tracking-eyebrow text-[11px]">
        Draft — not yet reviewed by a lawyer
      </p>
      <p className="mt-2">
        This {document} was written by the person who wrote the code, so that the
        facts about what Invoicey does are correct. It is pending the owner&apos;s
        legal review and is not legal advice. Text in{" "}
        <Placeholder>[brackets]</Placeholder> has not been filled in yet.
      </p>
    </div>
  );
}

/** One `<section>` of a legal document: a heading and its prose. */
export function LegalSection({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {children}
      </div>
    </section>
  );
}

/** A bullet list in the document's body voice. */
export function LegalList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-4 list-disc space-y-2 marker:text-slate-400 dark:marker:text-slate-500">
      {children}
    </ul>
  );
}

/**
 * Tables in a legal document are the part readers actually check, so they get
 * a horizontal scroll container of their own rather than forcing the page body
 * to scroll sideways on a phone.
 */
export function LegalTable({
  headers,
  rows,
  className,
}: {
  headers: readonly string[];
  rows: ReadonlyArray<readonly React.ReactNode[]>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-lg border border-slate-200 dark:border-white/10",
        className
      )}
    >
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead className="bg-slate-50 dark:bg-white/5">
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-t border-slate-200 align-top dark:border-white/10"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className="px-4 py-2.5 text-slate-600 dark:text-slate-300"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The grievance contact block, rendered identically on all three pages. */
export function GrievanceBlock() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white/85 p-5 text-sm leading-relaxed text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/75 dark:text-slate-300">
      <p className="text-base font-semibold text-slate-900 dark:text-white">
        Grievance Officer
      </p>
      <p className="mt-3">
        <Placeholder>{LEGAL.grievanceOfficer}</Placeholder>
      </p>
      <p className="mt-1">
        <EmailLink address={LEGAL.grievanceEmail} />
      </p>
      <p className="mt-1">
        <Placeholder>{LEGAL.postalAddress}</Placeholder>, India
      </p>
      <p className="mt-4 font-medium text-slate-900 dark:text-white">
        We respond to privacy grievances within {LEGAL.grievanceSlaDays} days.
      </p>
      <p className="mt-1">
        If we need longer, we will tell you why before those{" "}
        {LEGAL.grievanceSlaDays} days are up.
      </p>
    </div>
  );
}
