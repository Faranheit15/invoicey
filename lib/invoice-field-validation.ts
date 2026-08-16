/**
 * Validate-all, and focus the first invalid field.
 *
 * Today saving a blank invoice on a phone is a scroll-and-guess loop: the
 * validator returns ONE error, the editor renders it at the top of a ~2,400px
 * form, and nothing focuses or scrolls to the field it is about. Six missing
 * fields is six round trips of scroll-up, read, scroll-down, guess.
 *
 * The obvious fix — rewrite the validator to collect errors instead of
 * returning the first — is the wrong one. `validateInvoice` is deliberately the
 * single validator, shared by `InvoiceEditor.saveInvoice` and both API write
 * paths, and its "first error wins" contract is what the API depends on. A
 * second, parallel list of rules would drift from it within a release, and the
 * rules it holds are not trivia: they are GST-correctness rules where the
 * editor and the server disagreeing is a wrong document.
 *
 * So this enumerates the errors by RE-RUNNING the one validator. Take its first
 * error, apply the smallest edit that satisfies exactly that rule, run it
 * again, and repeat. What comes out is every blocking error the invoice has, in
 * the validator's own order and its own words — with zero possibility of drift,
 * because there is still only one set of rules.
 *
 * The repairs are applied to a COPY and thrown away. Nothing here mutates the
 * form state, and nothing here is ever saved.
 */

import {
  validateInvoiceDetailed,
  type ValidatableInvoice,
  type ValidatableInvoiceItem,
} from "@/lib/invoice-domain";
import { isValidGstin, normalizeGstin, stateCodeFromGstin } from "@/lib/gstin";

/**
 * The attribute the editor stamps on each control so this module can find it.
 * A data attribute rather than an id: `components/ui/field.tsx` generates its
 * ids with `React.useId()`, so there is no stable id to target.
 */
export const INVOICE_FIELD_ATTRIBUTE = "data-invoice-field";

/**
 * A field path. Invoice-level fields are their form-state key; line-item fields
 * are `items.<index>.<key>`, which is also what the editor stamps on the row's
 * control.
 */
export type InvoiceFieldPath = string;

export interface InvoiceIssue {
  /** `null` for an error that belongs to no single control. */
  field: InvoiceFieldPath | null;
  /** The validator's own message, or friendlier copy where we have it. */
  message: string;
  /** Present for a line-item error, so the editor can expand that row. */
  itemIndex?: number;
}

export interface InvoiceIssueReport {
  issues: InvoiceIssue[];
  /** Non-blocking advice, from the FIRST run — see the note in `collectInvoiceIssues`. */
  warnings: string[];
  isValid: boolean;
}

/**
 * Friendlier copy, keyed by the validator's message.
 *
 * The editor already carries wording like this in the hand-rolled pre-checks at
 * the top of `saveInvoice`; centralising it here is what lets those go away.
 * Anything not listed falls through to the validator's own message, which is
 * always specific enough to act on.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
  "Company name is required":
    "Add your company name — it appears at the top of the invoice.",
  "Bill to is required":
    "Add a client name so the invoice knows who it is addressed to.",
  "Invoice number is required":
    "Give the invoice a number — it is how you and your client refer to it.",
  "Invoice date is invalid": "Pick a valid invoice date.",
  "Due date is invalid": "Pick a valid due date.",
  "At least one line item is required":
    "Describe at least one line item, or there is nothing to bill for.",
};

interface RepairContext {
  invoice: ValidatableInvoice;
}

interface IssueSpec {
  /** The validator message this spec answers to, matched exactly. */
  error: string;
  /** Which control the user has to go and fix. */
  field: (context: RepairContext) => InvoiceFieldPath | null;
  /** The line item at fault, when there is one. */
  itemIndex?: (context: RepairContext) => number | undefined;
  /**
   * The smallest edit that makes THIS rule pass, so the next error can surface.
   * It must not satisfy any other rule and must not introduce a new one — every
   * repair below is chosen for that, and the tests assert the enumeration
   * terminates on a fully-broken invoice.
   */
  repair: (invoice: ValidatableInvoice) => ValidatableInvoice;
}

const withItems = (
  invoice: ValidatableInvoice,
  map: (item: ValidatableInvoiceItem, index: number) => ValidatableInvoiceItem
): ValidatableInvoice => ({ ...invoice, items: invoice.items.map(map) });

const isBlank = (value: string | undefined): boolean => !value || !value.trim();

const firstUncodedTaxedLine = ({ invoice }: RepairContext): number | undefined => {
  const index = invoice.items.findIndex(
    (item) =>
      Number.isFinite(item.taxRatePercent) &&
      (item.taxRatePercent as number) > 0 &&
      isBlank(item.hsnSac)
  );
  return index === -1 ? undefined : index;
};

/**
 * One entry per blocking error `validateInvoiceDetailed` can return. Kept in the
 * validator's own order for readability; the lookup is by message, so the order
 * here is not load-bearing.
 */
const ISSUE_SPECS: readonly IssueSpec[] = [
  {
    error: "Company name is required",
    field: () => "companyName",
    repair: (invoice) => ({ ...invoice, companyName: "—" }),
  },
  {
    error: "Bill to is required",
    field: () => "billTo",
    repair: (invoice) => ({ ...invoice, billTo: "—" }),
  },
  {
    error: "Invoice number is required",
    field: () => "invoiceNumber",
    repair: (invoice) => ({ ...invoice, invoiceNumber: "—" }),
  },
  {
    error: "Invoice date is invalid",
    field: () => "invoiceDate",
    repair: (invoice) => ({ ...invoice, invoiceDate: "2000-01-01" }),
  },
  {
    error: "Due date is invalid",
    field: () => "dueDate",
    repair: (invoice) => ({ ...invoice, dueDate: "2000-01-01" }),
  },
  {
    error: "At least one line item is required",
    field: () => "items.0.description",
    itemIndex: () => 0,
    // Fill the FIRST row's description rather than replacing the array: a row
    // may already carry an HSN code or a tax rate whose own errors must still
    // surface on the next pass.
    repair: (invoice) =>
      invoice.items.length === 0
        ? { ...invoice, items: [{ description: "—" }] }
        : withItems(invoice, (item, index) =>
            index === 0 ? { ...item, description: "—" } : item
          ),
  },
  {
    error: "Your GSTIN is not valid. Check the 15 characters.",
    field: () => "companyGstin",
    // Absence is valid, so clearing it is the one repair that cannot trip a
    // different rule. (It can add the "a tax invoice should carry your GSTIN"
    // WARNING, which is why warnings are taken from the first run only.)
    repair: (invoice) => ({ ...invoice, companyGstin: "" }),
  },
  {
    error: "The client's GSTIN is not valid.",
    field: () => "billToGstin",
    repair: (invoice) => ({ ...invoice, billToGstin: "" }),
  },
  {
    error: "Your state must match the first two digits of your GSTIN.",
    // Either half can be the wrong one — the validator refuses to guess, and so
    // does this. The state picker is the one the user is more likely to have
    // got wrong, so that is where the cursor goes.
    field: () => "supplierStateCode",
    // Clear the GSTIN rather than rewriting the state: rewriting the state
    // would then satisfy "Select the state you're registered in" too, hiding a
    // real second error on an invoice that had both.
    repair: (invoice) => ({ ...invoice, companyGstin: "" }),
  },
  {
    error:
      "An SEZ unit is inside India — clear either the SEZ flag or the overseas recipient.",
    field: () => "recipientIsSez",
    repair: (invoice) => ({ ...invoice, recipientIsSez: false }),
  },
  {
    error: "Select the state you're registered in.",
    field: () => "supplierStateCode",
    // Derive it from the GSTIN when there is one, so the repair cannot create
    // the state-mismatch error it would otherwise walk straight into.
    repair: (invoice) => {
      const gstin = normalizeGstin(invoice.companyGstin);
      return {
        ...invoice,
        supplierStateCode:
          gstin && isValidGstin(gstin) ? stateCodeFromGstin(gstin) : "27",
      };
    },
  },
  {
    error: "Select the place of supply.",
    field: () => "placeOfSupplyStateCode",
    repair: (invoice) => ({ ...invoice, placeOfSupplyStateCode: "27" }),
  },
  {
    error: "Add an HSN or SAC code for every taxed line.",
    field: (context) => {
      const index = firstUncodedTaxedLine(context);
      return index === undefined ? null : `items.${index}.hsnSac`;
    },
    itemIndex: firstUncodedTaxedLine,
    repair: (invoice) =>
      withItems(invoice, (item) =>
        Number.isFinite(item.taxRatePercent) &&
        (item.taxRatePercent as number) > 0 &&
        isBlank(item.hsnSac)
          ? { ...item, hsnSac: "998314" }
          : item
      ),
  },
  {
    error: "Country of destination is required on an export invoice.",
    field: () => "countryOfDestination",
    repair: (invoice) => ({ ...invoice, countryOfDestination: "—" }),
  },
  {
    error: "Enter your LUT ARN, or switch to 'with payment of tax'.",
    field: () => "lutArn",
    repair: (invoice) => ({ ...invoice, lutArn: "—" }),
  },
  {
    error: "A composition dealer cannot make an inter-State supply of goods.",
    field: () => "items.0.hsnSac",
    repair: (invoice) =>
      withItems(invoice, (item) =>
        isBlank(item.hsnSac) ? item : { ...item, hsnSac: "9983" }
      ),
  },
  {
    // Tripwires on the derivation, not on anything the user typed. They belong
    // to no control, so there is nothing to focus — they surface as a banner.
    error: "An inter-State supply must be taxed as IGST, not CGST/SGST.",
    field: () => null,
    repair: (invoice) => ({ ...invoice, totals: undefined }),
  },
  {
    error: "An intra-State supply must be taxed as CGST/SGST, not IGST.",
    field: () => null,
    repair: (invoice) => ({ ...invoice, totals: undefined }),
  },
];

const SPEC_BY_ERROR = new Map(ISSUE_SPECS.map((spec) => [spec.error, spec]));

/**
 * A hard stop on the repair loop. There are 18 specs; anything past that many
 * passes means a repair failed to satisfy its own rule, and an infinite loop in
 * a save handler is far worse than an incomplete error list.
 */
const MAX_PASSES = ISSUE_SPECS.length + 4;

/**
 * Checks the editor enforces that the shared validator deliberately does not.
 *
 * There is exactly one: a due date before the invoice date. It is not a GST
 * rule and not something the API rejects, so it does not belong in
 * `validateInvoice` — but the editor has always blocked on it, and dropping it
 * while replacing the editor's hand-rolled checks would be a silent regression.
 * It is appended rather than interleaved, because the shared validator's own
 * ordering is the one the user should work through first.
 */
const editorOnlyIssues = (invoice: ValidatableInvoice): InvoiceIssue[] => {
  const invoiceDate = new Date(invoice.invoiceDate).getTime();
  const dueDate = new Date(invoice.dueDate).getTime();
  if (
    Number.isNaN(invoiceDate) ||
    Number.isNaN(dueDate) ||
    dueDate >= invoiceDate
  ) {
    return [];
  }
  return [
    {
      field: "dueDate",
      message: "The due date falls before the invoice date. Check both dates.",
    },
  ];
};

/**
 * Every blocking error the invoice has, in the validator's order.
 *
 * Warnings come from the FIRST pass only. The repairs can manufacture warnings
 * that the real invoice does not have — clearing an invalid GSTIN produces "a
 * tax invoice should carry your GSTIN" — and a warning the user cannot act on
 * is worse than no warning.
 */
export const collectInvoiceIssues = (
  invoice: ValidatableInvoice
): InvoiceIssueReport => {
  const first = validateInvoiceDetailed(invoice);
  const warnings = first.warnings;
  const editorOnly = editorOnlyIssues(invoice);

  if (!first.error) {
    return {
      issues: editorOnly,
      warnings,
      isValid: editorOnly.length === 0,
    };
  }

  const issues: InvoiceIssue[] = [];
  let current = invoice;
  let error: string | null = first.error;
  const seen = new Set<string>();

  for (let pass = 0; pass < MAX_PASSES && error; pass += 1) {
    // A repeated message means a repair did not take. Record it once and stop
    // rather than spinning.
    if (seen.has(error)) {
      break;
    }
    seen.add(error);

    const spec = SPEC_BY_ERROR.get(error);
    if (!spec) {
      // A rule added to the validator without a spec here. Report it verbatim
      // and stop — an unknown error is still an error the user must see, and
      // guessing a repair for it could hide a different one.
      issues.push({ field: null, message: error });
      break;
    }

    const context: RepairContext = { invoice: current };
    const itemIndex = spec.itemIndex?.(context);
    issues.push({
      field: spec.field(context),
      message: FRIENDLY_MESSAGES[error] ?? error,
      ...(itemIndex === undefined ? {} : { itemIndex }),
    });

    current = spec.repair(current);
    error = validateInvoiceDetailed(current).error;
  }

  return { issues: [...issues, ...editorOnly], warnings, isValid: false };
};

/**
 * The blocking answer, unchanged in meaning from `validateInvoice`: the first
 * issue's message, or null. Provided so a caller can adopt this module without
 * changing what it shows first.
 */
export const firstInvoiceIssue = (
  invoice: ValidatableInvoice
): InvoiceIssue | null => collectInvoiceIssues(invoice).issues[0] ?? null;

/* ------------------------------------------------------------------------- *
 * Focus
 * ------------------------------------------------------------------------- */

/** Minimal DOM surface, so the helper can be exercised without a real document. */
export interface FocusableRoot {
  querySelector(selectors: string): FocusableElement | null;
}

export interface FocusableElement {
  focus(options?: { preventScroll?: boolean }): void;
  scrollIntoView?(options?: { block?: string; behavior?: string }): void;
}

/**
 * Field paths are our own strings ("items.3.hsnSac"), not user input, but the
 * selector is still built by concatenation — quote anything that would end the
 * attribute selector early rather than trusting that they stay tame.
 */
const escapeAttributeValue = (value: string): string =>
  value.replace(/["\\]/g, "\\$&");

export const invoiceFieldSelector = (field: InvoiceFieldPath): string =>
  `[${INVOICE_FIELD_ATTRIBUTE}="${escapeAttributeValue(field)}"]`;

/**
 * Scroll to and focus one field. Returns false when the editor has not stamped
 * that field (or the control is on a collapsed section), so the caller can fall
 * back to its error banner rather than silently doing nothing.
 *
 * `scrollIntoView` first, `focus({ preventScroll: true })` second: focusing a
 * control 2,000px down the page scrolls it to the very edge of the viewport,
 * where its label is off-screen and the user cannot see what is being asked of
 * them. Centring it and then focusing without a second scroll puts the label,
 * the control and its error message all in view.
 */
export const focusInvoiceField = (
  field: InvoiceFieldPath,
  root?: FocusableRoot | null
): boolean => {
  const doc =
    root ?? (typeof document === "undefined" ? null : (document as FocusableRoot));
  if (!doc) {
    return false;
  }
  const element = doc.querySelector(invoiceFieldSelector(field));
  if (!element) {
    return false;
  }
  element.scrollIntoView?.({ block: "center", behavior: "smooth" });
  element.focus({ preventScroll: true });
  return true;
};

/**
 * Focus the first issue that names a field. Returns the issue that was focused,
 * or null if none could be — the banner still lists all of them either way.
 */
export const focusFirstInvoiceIssue = (
  issues: readonly InvoiceIssue[],
  root?: FocusableRoot | null
): InvoiceIssue | null => {
  for (const issue of issues) {
    if (issue.field && focusInvoiceField(issue.field, root)) {
      return issue;
    }
  }
  return null;
};
