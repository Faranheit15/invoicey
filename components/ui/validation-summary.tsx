"use client";

import { AlertBanner } from "@/components/ui/alert-banner";
import {
  focusInvoiceField,
  type InvoiceIssue,
} from "@/lib/invoice-field-validation";

interface ValidationSummaryProps {
  issues: readonly InvoiceIssue[];
  className?: string;
}

/**
 * Every blocking problem at once, each one a link to the field it is about.
 *
 * The editor reports one error at a time, at the top of a form that is about
 * 2,400px tall on a phone, and never scrolls to the field. A blank invoice
 * therefore takes six separate save attempts to fill in, each one a scroll-up,
 * read, scroll-down, guess. Listing all of them turns that into one pass, and
 * making each one a jump target removes the guessing.
 *
 * `AlertBanner` carries `role="alert"`, so the whole list is announced on
 * appearance — which is also why the list is short and each entry names its
 * field rather than describing the form.
 */
export function ValidationSummary({ issues, className }: ValidationSummaryProps) {
  if (!issues.length) {
    return null;
  }

  const heading =
    issues.length === 1
      ? "One thing to fix before saving:"
      : `${issues.length} things to fix before saving:`;

  return (
    <AlertBanner className={className}>
      <div className="space-y-1">
        <p className="font-medium">{heading}</p>
        <ul className="space-y-1">
          {issues.map((issue, index) => (
            <li key={`${issue.field ?? "general"}-${index}`}>
              {issue.field ? (
                <button
                  type="button"
                  onClick={() => focusInvoiceField(issue.field as string)}
                  className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {issue.message}
                </button>
              ) : (
                <span>{issue.message}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </AlertBanner>
  );
}
