"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { SelectField } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner, LiveStatus } from "@/components/ui/alert-banner";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { ValidationSummary } from "@/components/ui/validation-summary";
import { MicroLabel } from "@/components/ui/micro-label";
import { PageShell } from "@/components/ui/page-shell";
import InvoiceAiAssistant from "@/components/InvoiceAiAssistant";
import ClientPicker from "@/components/ClientPicker";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  invoicesApi,
  profileApi,
  getAuthToken,
  describeRequestError,
  UnauthenticatedError,
  type BusinessProfile,
} from "@/lib/api-client";
import type { ClientSummary } from "@/lib/clients";
import {
  collectInvoiceIssues,
  focusFirstInvoiceIssue,
  type InvoiceIssue,
} from "@/lib/invoice-field-validation";
import { useInvoiceDraft } from "@/lib/hooks/use-invoice-draft";
import { useUnsavedChangesGuard } from "@/lib/hooks/use-unsaved-changes";
import { UNSAVED_CHANGES_MESSAGE } from "@/lib/navigation-guard";
import UserSessionManager from "@/modules/UserSessionManager";
import { buildDuplicateFormState } from "@/lib/invoice-duplicate";
import type { InvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/contracts";
import { applyInvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/apply-patch";
import {
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  MAX_MONEY_VALUE,
  MAX_TDS_RATE_PERCENT,
  TDS_SECTIONS,
  buildLineItemColumns,
  buildTotalsRows,
  tdsSpecFor,
  type TdsSection,
} from "@/lib/invoice-domain";
import {
  COMPOSITION_BANNER,
  DOCUMENT_TITLES,
  TAX_SUPPRESSION_NOTES,
  deriveSupplyKind,
  documentTypeFor,
} from "@/lib/gst-supply";
import {
  GST_RETIRED_RATE_WARNING,
  MAX_UNIT_LENGTH,
  UQC_CODES,
  gstRateOptions,
  isRetiredGstRate,
  placeOfSupplyLabelFor,
} from "@/lib/gst-rates";
import {
  GST_STATE_CODES,
  GST_STATE_PICKER_CODES,
  OTHER_COUNTRY_STATE_CODE,
  isValidGstin,
  panFromGstin,
} from "@/lib/gstin";
// `buildLineItemColumns` now lives in lib/invoice-domain, beside
// buildTotalsRows, and all three renderers read it from there.
// `buildLineItemCells` stays here because it formats currency via lib/invoices,
// which imports the domain module — see the note on the helper itself.
import {
  buildLineItemCells,
  exportEndorsementFor,
} from "@/lib/invoice-export";
import { amountInWordsIndian } from "@/lib/amount-in-words";
import {
  STATUS_PILL_BASE,
  statusPillOnMastheadClass,
} from "@/lib/invoice-status";
import {
  CURRENCY_OPTIONS,
  InvoiceFormItem,
  InvoiceFormState,
  InvoiceStatus,
  calculateInvoiceTotals,
  checkSupplierStateAgainstGstin,
  createDefaultInvoiceFormState,
  formatCurrency,
  formatDateLong,
  mapFormStateToPayload,
  mapInvoiceRecordToFormState,
  profileToSeed,
} from "@/lib/invoices";
import {
  ArrowLeftIcon,
  CheckIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
} from "@radix-ui/react-icons";

type EditorMode = "create" | "edit";

interface InvoiceEditorProps {
  mode: EditorMode;
  invoiceId?: string;
}

// Input ceilings. The server recomputes and clamps every total, so these exist
// to stop a paste or a stuck key from producing an invoice no client would
// accept — and to keep the preview and the printed sheet legible. The numeric
// ceilings live in lib/invoice-domain so the API enforces the same ones.
const TEXT_FIELD_MAX = 120;
const INVOICE_NUMBER_MAX = 40;
const ADDRESS_FIELD_MAX = 400;
const NOTES_FIELD_MAX = 1000;
const URL_FIELD_MAX = 2048;
const MAX_LINE_ITEMS = 100;
const HSN_FIELD_MAX = 8;

/**
 * "moments ago" / "4 minutes ago" / "2 days ago", for the draft-restore offer.
 * Coarse on purpose: the question is "is this recent enough to want back?",
 * and a to-the-second answer invites reading it as a save receipt.
 */
const formatDraftAge = (ageMs: number): string => {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return "moments ago";
  }
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const STATE_OPTIONS = GST_STATE_PICKER_CODES.map((code) => ({
  value: code,
  label: `${code} — ${GST_STATE_CODES[code]}`,
}));

/**
 * Place of supply adds one entry the supplier-state picker must never have:
 * "96" is Invoicey's outside-India sentinel, not a state anyone is registered
 * in. It is also never PRINTED as a code — `placeOfSupplyLabelFor` turns it into
 * words.
 */
const PLACE_OF_SUPPLY_OPTIONS = [
  ...STATE_OPTIONS,
  { value: OTHER_COUNTRY_STATE_CODE, label: "Outside India" },
];

/**
 * A labelled boolean. The GST section has four of them and they all read the
 * same way: the switch is the control, the sentence under the label says what
 * turning it on MEANS, not what it is called.
 */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-slate-200 px-3 py-2.5 dark:border-slate-700">
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

export default function InvoiceEditor({ mode, invoiceId }: InvoiceEditorProps) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceFormState>(
    createDefaultInvoiceFormState()
  );
  const [isAiPanelVisible, setIsAiPanelVisible] = useState(false);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(mode === "edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  // Set only when repeating the exact failed request could succeed, so the
  // banner never offers a retry for something the user has to fix by hand.
  const [errorRetry, setErrorRetry] = useState<(() => void) | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  /** Set once a duplicate has landed, so the user knows what they are looking at. */
  const [duplicateNotice, setDuplicateNotice] = useState("");
  /**
   * A chosen client whose details would overwrite something already typed. Held
   * here rather than applied, until the user says so.
   */
  const [pendingClient, setPendingClient] = useState<ClientSummary | null>(null);
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [signatureLoadFailed, setSignatureLoadFailed] = useState(false);
  // Non-blocking advice from the shared validator — a wrong-LOOKING but legal
  // invoice must still save, so these are shown, never enforced.
  const [warnings, setWarnings] = useState<string[]>([]);
  /**
   * EVERY blocking problem, not just the first. The form is ~2,400px tall on a
   * phone; one error at a time turns filling in a blank invoice into six
   * scroll-up-read-scroll-down round trips.
   */
  const [issues, setIssues] = useState<InvoiceIssue[]>([]);
  /**
   * Mirrors `isPristineRef` as RENDER state. The ref is read inside async
   * callbacks (where a stale closure would be wrong); the guard and the draft
   * autosave need a value React can re-render on.
   */
  const [isDirty, setIsDirty] = useState(false);
  /** Firebase uid, for the draft key. Drafts are per-user — see lib/invoice-draft.ts. */
  const [userId, setUserId] = useState("");
  /** A navigation the guard stopped, waiting on the confirm dialog. */
  const [pendingLeave, setPendingLeave] = useState<{ proceed: () => void } | null>(
    null
  );
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  /**
   * False the moment the user touches anything. The profile fetch is async and
   * the form is usable immediately, so without this the seed would land on top
   * of whatever they had already typed — the one thing seeding must never do.
   */
  const isPristineRef = useRef(true);
  const markDirty = useCallback(() => {
    isPristineRef.current = false;
    setIsDirty(true);
  }, []);
  /**
   * True from the instant a `?duplicate=` link is recognised until the copy has
   * either landed or failed. The profile seed reads it AFTER its own await, so
   * a slow profile fetch cannot land on top of a duplicated draft.
   */
  const isDuplicatePendingRef = useRef(false);
  const authRedirectPath = useMemo(() => {
    if (mode === "edit" && invoiceId) {
      return `/auth?next=${encodeURIComponent(`/create-invoice/${invoiceId}`)}`;
    }
    return "/auth?next=%2Fcreate-invoice";
  }, [invoiceId, mode]);

  // The draft key is per-user (a shared machine must not hand one person's
  // client details to the next), so nothing is stored until the uid resolves.
  useEffect(() => {
    setUserId(new UserSessionManager().user?.uid || "");
  }, []);

  /**
   * Autosave to localStorage, and offer to restore. Disabled while an existing
   * invoice is still loading (the placeholder would be written over a real
   * draft) and while saving.
   */
  const { pendingDraft, restoreDraft, discardDraft, clearDraft, savedAt } =
    useInvoiceDraft({
      userId,
      mode,
      invoiceId,
      state: invoice,
      isDirty,
      enabled: !isLoadingInvoice && !isSaving,
    });

  /**
   * Warn before a back gesture, a link, or a tab close throws the form away.
   * Disabled while saving: the post-save `router.push` is a navigation the user
   * asked for, and `isSaving` has already rendered by the time it runs.
   */
  const { confirmLeave } = useUnsavedChangesGuard({
    enabled: isDirty && !isSaving,
    onBlocked: ({ proceed }) => setPendingLeave({ proceed }),
  });

  /** Every deliberate return to the dashboard goes through the guard. */
  const leaveForDashboard = useCallback(() => {
    confirmLeave(() => router.push("/dashboard"), "/dashboard");
  }, [confirmLeave, router]);

  /**
   * Which of the two line-item renderings is actually on screen.
   *
   * Both are always in the DOM — the table and the cards swap by media query
   * (see the note above the table) — so stamping `data-invoice-field` on both
   * would leave `focusFirstInvoiceIssue` focusing whichever comes first in
   * document order, which is `display:none` half the time. A hidden element
   * cannot be focused or scrolled to, so the jump would silently do nothing.
   * The query below is the exact complement of `hidden md:block lg:hidden
   * xl:block`; it starts false so SSR and first paint stamp the cards.
   */
  const [isLineTableVisible, setIsLineTableVisible] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 768px) and (max-width: 1023.98px), (min-width: 1280px)"
    );
    const sync = () => setIsLineTableVisible(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const applyPendingDraft = useCallback(() => {
    const restored = restoreDraft();
    if (restored) {
      setInvoice(restored);
      markDirty();
    }
  }, [markDirty, restoreDraft]);

  // The whole form goes in: the GST fields are members of `InvoiceFormState`
  // now, and `calculateInvoiceTotals` routes them through the same
  // `resolveTaxContext` the server uses. The preview cannot arrive at a
  // different number from the API by construction.
  const totals = useMemo(() => calculateInvoiceTotals(invoice), [invoice]);

  const isGst = invoice.taxTreatment === "gst";
  /** GST or composition — anyone the supply geography actually matters to. */
  const isRegisteredSupplier =
    invoice.taxTreatment === "gst" || invoice.taxTreatment === "composition";
  /** A pre-Phase-2 document: no treatment at all, still on the legacy formula. */
  const isLegacyDocument = invoice.taxTreatment === undefined;

  /**
   * Derived, never stored on form state. `supplyKind` is a pure function of the
   * geography fields, and a stored copy is one more thing that can go stale
   * while the user is still typing. The server derives it again and only the
   * server's answer is persisted.
   */
  const supplyKind = useMemo(
    () =>
      invoice.taxTreatment === undefined
        ? undefined
        : deriveSupplyKind({
            supplierStateCode: invoice.supplierStateCode,
            placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
            recipientIsSez: invoice.recipientIsSez,
            recipientIsOutsideIndia: invoice.recipientIsOutsideIndia,
          }),
    [
      invoice.taxTreatment,
      invoice.supplierStateCode,
      invoice.placeOfSupplyStateCode,
      invoice.recipientIsSez,
      invoice.recipientIsOutsideIndia,
    ]
  );

  const isZeroRated = supplyKind === "export" || supplyKind === "sez";
  const documentType = invoice.taxTreatment
    ? documentTypeFor(invoice.taxTreatment)
    : "invoice";
  const endorsement = exportEndorsementFor({
    supplyKind,
    withPaymentOfTax: invoice.withPaymentOfTax,
  });

  /** Validation and other failures the user must fix themselves: no retry. */
  const showError = useCallback((message: string) => {
    setError(message);
    setErrorRetry(null);
  }, []);

  const fetchInvoice = useCallback(async () => {
    if (!invoiceId) {
      showError("This edit link is missing an invoice id.");
      setIsLoadingInvoice(false);
      return;
    }

    setIsLoadingInvoice(true);
    setError("");
    setErrorRetry(null);

    try {
      const data = await invoicesApi.get(invoiceId);
      setInvoice(mapInvoiceRecordToFormState(data));
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        if (err.reason === "verify-email") {
          showError("Verify your email before editing invoices.");
          router.replace(`${authRedirectPath}&reason=verify-email`);
        } else {
          router.replace(authRedirectPath);
        }
        return;
      }
      const { message, canRetry } = describeRequestError(
        err,
        "Couldn't open this invoice for editing."
      );
      setError(message);
      setErrorRetry(canRetry ? () => fetchInvoice : null);
    } finally {
      setIsLoadingInvoice(false);
    }
  }, [authRedirectPath, invoiceId, router, showError]);

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }
    fetchInvoice();
  }, [fetchInvoice, mode]);

  /**
   * DUPLICATE: `/create-invoice?duplicate=<id>` loads that invoice as a NEW
   * draft — everything carried over except the number, the dates and the status.
   *
   * Client-side on purpose (see lib/invoice-duplicate.ts): a duplicate is a
   * draft, and a server-side copy would both save a document nobody reviewed
   * and burn a number out of a series Rule 46(b) requires to be consecutive.
   *
   * The id is read from `window.location.search` rather than `useSearchParams`,
   * which would force this whole editor behind a Suspense boundary at build
   * time — the `/create-invoice` page is a thin server shell with nowhere to put
   * one, and adding a bailout would opt the route out of static rendering.
   *
   * Nothing about the FAILURE path guesses: if the source cannot be read the
   * user gets an empty form and a message, never a half-copied invoice.
   */
  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    const sourceId = new URLSearchParams(window.location.search).get("duplicate");
    if (!sourceId) {
      return;
    }
    // Set SYNCHRONOUSLY, before the first await: both effects mount in the same
    // commit, and this is what the profile seed checks once its fetch resolves.
    isDuplicatePendingRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const source = await invoicesApi.get(sourceId);
        const today = new Date();

        // The number comes from the server, which is the only place that can
        // see the whole series. Advisory: a failure leaves the field EMPTY
        // rather than reusing the source's number, which would be a duplicate
        // in the sense the law cares about.
        let invoiceNumber = "";
        try {
          const suggestion = await invoicesApi.suggestNumber(
            today.toISOString().split("T")[0]
          );
          invoiceNumber = suggestion.invoiceNumber ?? "";
        } catch {
          invoiceNumber = "";
        }

        // Whatever the user has typed in the meantime wins — the same rule the
        // profile seed follows, for the same reason.
        if (cancelled || !isPristineRef.current) {
          return;
        }

        setInvoice(
          buildDuplicateFormState(mapInvoiceRecordToFormState(source), {
            invoiceNumber,
            today,
          })
        );
        // A copied draft is not a pristine one: the profile seed must not land
        // on top of it if it happens to resolve later.
        markDirty();
        setDuplicateNotice(
          invoiceNumber
            ? `Copied from ${source.invoiceNumber || "an earlier invoice"}. New number and today's dates — check them, then save.`
            : `Copied from ${source.invoiceNumber || "an earlier invoice"}. Give it an invoice number before saving.`
        );
      } catch (err) {
        // The duplicate did not happen, so let the profile seed run instead.
        isDuplicatePendingRef.current = false;
        if (cancelled || err instanceof UnauthenticatedError) {
          return;
        }
        const { message } = describeRequestError(
          err,
          "Couldn't copy that invoice. Start from a blank one instead."
        );
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [markDirty, mode]);

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [invoice.companyLogo]);

  useEffect(() => {
    setSignatureLoadFailed(false);
  }, [invoice.signatureImageUrl]);

  // The two percent-mode effects that used to recompute `invoice.cgst` and
  // `invoice.sgst` from `subtotal x rate` are GONE, along with the %/₹ toggle
  // they served. Tax is per line and derived now, so an invoice-level rate has
  // nothing to multiply. The %/₹ toggle survives only on `discount`, where both
  // modes are genuinely meaningful.
  //
  // NOTE for lib/numeric-input.ts: its comment cites "the percent-mode effects"
  // as the reason an empty draft must publish the field MINIMUM rather than 0.
  // That coupling is gone; the reason is now the per-line tax derivation, which
  // has exactly the same hazard — a blank Qty would momentarily zero a line's
  // taxable value and, on the server, its stored tax split. The behaviour must
  // not be relaxed.

  /**
   * Seed a NEW invoice from the saved business profile.
   *
   * Gated on `isPristineRef`: this fetch is async, the form is usable the
   * instant it renders, and a seed that landed on top of typed values would
   * destroy work. It also runs in edit mode (without seeding) because the
   * profile carries the GSTIN that the supplier-state validation rule needs.
   *
   * A failure is swallowed. Seeding is a convenience; "nothing between sign-in
   * and the first invoice" means a profile the server could not return must not
   * stop anyone creating one.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { profile: saved } = await profileApi.get();
        if (cancelled) {
          return;
        }
        setProfile(saved);
        if (
          mode === "create" &&
          isPristineRef.current &&
          // A `?duplicate=` copy is in flight (or has landed): seeding here
          // would blank the client and line items it just carried over.
          !isDuplicatePendingRef.current
        ) {
          setInvoice(createDefaultInvoiceFormState(profileToSeed(saved)));
        }
      } catch {
        // Intentionally silent — see above.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  const getAuthTokenForAssistant = useCallback(async () => {
    try {
      return await getAuthToken();
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        if (err.reason === "verify-email") {
          showError("Verify your email before using the AI assistant.");
          router.replace(`${authRedirectPath}&reason=verify-email`);
        } else {
          router.replace(authRedirectPath);
        }
        return null;
      }
      showError("Your session expired. Sign in again to continue.");
      router.replace(authRedirectPath);
      return null;
    }
  }, [authRedirectPath, router, showError]);

  const applyAiPatch = useCallback((patch: InvoiceAssistantPatch) => {
    let appliedFields: string[] = [];
    // An assistant-filled draft is no longer pristine: the profile seed must not
    // land on top of it.
    markDirty();

    setInvoice((previousState) => {
      const { nextState, appliedFields: nextAppliedFields } = applyInvoiceAssistantPatch(
        previousState,
        patch
      );
      appliedFields = nextAppliedFields;
      return nextState;
    });

    return appliedFields;
  }, [markDirty]);

  /**
   * The four fields a saved client fills, with the labels the form uses — so
   * the confirmation can name exactly what it is about to change rather than
   * saying "some details".
   */
  const clientFieldsFor = (client: ClientSummary) => [
    { key: "billTo" as const, label: "Client name", value: client.name },
    { key: "billToEmail" as const, label: "Client email", value: client.email },
    { key: "billToGstin" as const, label: "Client GSTIN", value: client.gstin },
    {
      key: "billToAddress" as const,
      label: "Client billing address",
      value: client.address,
    },
  ];

  /**
   * Fill from a saved client. A field the client record has nothing for is left
   * alone — picking a client whose GSTIN was never recorded must not wipe one
   * the user has just typed in.
   */
  const applyClient = (client: ClientSummary) => {
    markDirty();
    setInvoice((prev) => ({
      ...prev,
      billTo: client.name || prev.billTo,
      billToEmail: client.email || prev.billToEmail,
      billToGstin: client.gstin || prev.billToGstin,
      billToAddress: client.address || prev.billToAddress,
    }));
  };

  /**
   * The picker's entry point. Filling BLANK fields needs no permission;
   * replacing a value the user typed is a decision, and it is theirs — so a
   * conflict opens a dialog naming every field that would change instead of
   * quietly overwriting them.
   */
  const chooseClient = (client: ClientSummary) => {
    const conflicts = clientFieldsFor(client).filter(
      (field) =>
        field.value &&
        invoice[field.key].trim() &&
        invoice[field.key].trim() !== field.value
    );
    if (conflicts.length === 0) {
      applyClient(client);
      return;
    }
    setPendingClient(client);
  };

  const pendingClientConflicts = pendingClient
    ? clientFieldsFor(pendingClient).filter(
        (field) =>
          field.value &&
          invoice[field.key].trim() &&
          invoice[field.key].trim() !== field.value
      )
    : [];

  const updateField = <K extends keyof InvoiceFormState>(
    key: K,
    value: InvoiceFormState[K]
  ) => {
    markDirty();
    setInvoice((prev) => ({ ...prev, [key]: value }));
  };

  const updateItem = <K extends keyof InvoiceFormItem>(
    index: number,
    key: K,
    value: InvoiceFormItem[K]
  ) => {
    markDirty();
    setInvoice((prev) => {
      const items = [...prev.items];
      // An `undefined` value DELETES the key rather than storing undefined:
      // absence is what tells the API "this line never had an HSN/rate", and a
      // present-but-undefined key would be serialized away anyway, leaving the
      // two shapes subtly different.
      const next = { ...items[index] };
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      items[index] = next;
      return { ...prev, items };
    });
  };

  const addItem = () => {
    markDirty();
    setInvoice((prev) => {
      if (prev.items.length >= MAX_LINE_ITEMS) {
        showError(
          `An invoice can hold ${MAX_LINE_ITEMS} line items. Combine a few, or split this into a second invoice.`
        );
        return prev;
      }
      return {
        ...prev,
        items: [...prev.items, { description: "", quantity: 1, unitPrice: 0 }],
      };
    });
  };

  const removeItem = (index: number) => {
    markDirty();
    setInvoice((prev) => {
      if (prev.items.length === 1) {
        return prev;
      }
      return {
        ...prev,
        items: prev.items.filter((_, itemIndex) => itemIndex !== index),
      };
    });
  };

  const saveInvoice = async (status: InvoiceStatus = invoice.status) => {
    if (isSaving) {
      return;
    }
    setError("");
    setErrorRetry(null);
    setIssues([]);

    // ONE validate-all pass. `collectInvoiceIssues` re-runs the shared
    // `validateInvoiceDetailed` — the same rules the API enforces, in the same
    // order — until it has enumerated every blocking error, so the seven
    // hand-rolled pre-checks that used to live here cannot drift from it.
    const report = collectInvoiceIssues({
      companyName: invoice.companyName,
      billTo: invoice.billTo,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      items: invoice.items,
      companyGstin: invoice.companyGstin,
      billToGstin: invoice.billToGstin,
      taxTreatment: invoice.taxTreatment,
      supplyKind,
      supplierStateCode: invoice.supplierStateCode,
      placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
      recipientIsSez: invoice.recipientIsSez,
      recipientIsOutsideIndia: invoice.recipientIsOutsideIndia,
      withPaymentOfTax: invoice.withPaymentOfTax,
      lutArn: invoice.lutArn,
      countryOfDestination: invoice.countryOfDestination,
      totals: { cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst },
    });

    setIssues(report.issues);
    setWarnings(report.warnings);
    if (!report.isValid) {
      // Scroll to and focus the first control at fault; the summary lists the
      // rest, each one its own jump target.
      focusFirstInvoiceIssue(report.issues);
      return;
    }

    // §5.9's GSTIN-prefix rule now lives inside `validateInvoice` (the invoice
    // carries its own GSTIN), which is also where the API enforces it. This
    // second call covers only the case the validator cannot see: a draft with
    // no GSTIN of its own, belonging to a user whose PROFILE has one.
    const stateError = checkSupplierStateAgainstGstin({
      companyGstin: invoice.companyGstin || profile?.companyGstin,
      supplierStateCode: invoice.supplierStateCode,
      taxTreatment: invoice.taxTreatment,
    });
    if (stateError) {
      setIssues([{ field: "supplierStateCode", message: stateError }]);
      focusFirstInvoiceIssue([{ field: "supplierStateCode", message: stateError }]);
      return;
    }


    const runSave = async () => {
      try {
        setIsSaving(true);
        setSaveStatus(mode === "edit" ? "Saving changes…" : "Creating invoice…");

        const payload = mapFormStateToPayload({
          ...invoice,
          status,
        });

        if (mode === "edit") {
          await invoicesApi.update(invoiceId || "", payload);
        } else {
          await invoicesApi.create(payload);
        }

        setSaveStatus("Saved. Returning to dashboard.");
        // The invoice is on the server now; the local copy of the client's
        // name, email and address has no reason to outlive it.
        clearDraft();
        setIsDirty(false);
        isPristineRef.current = true;
        confirmLeave(() => router.push("/dashboard"), "/dashboard");
      } catch (err) {
        setSaveStatus("");
        if (err instanceof UnauthenticatedError) {
          if (err.reason === "verify-email") {
            showError("Verify your email before saving invoices.");
            router.replace(`${authRedirectPath}&reason=verify-email`);
          } else {
            router.replace(authRedirectPath);
          }
          return;
        }
        const { message, canRetry } = describeRequestError(
          err,
          "Couldn't save this invoice."
        );
        // Nothing was navigated away from, so the form still holds every value
        // the user typed; retrying re-sends exactly what failed.
        setError(message);
        setErrorRetry(canRetry ? () => runSave : null);
      } finally {
        setIsSaving(false);
      }
    };

    await runSave();
  };

  /**
   * Item 6's per-line particulars: HSN/SAC (Rule 46(f)), UQC, the GST rate and
   * a line discount.
   *
   * They live in a sub-row rather than as extra columns because the line-item
   * grid is already ~556px wide inside a ~434px form column at lg. Nine columns
   * would horizontally scroll at every desktop size.
   *
   * HSN/SAC and the rate appear only for a GST document — an unregistered
   * person has no rate to pick and no classification to declare, and showing
   * the fields anyway is how a document ends up shaped like a tax invoice
   * without being one.
   */
  const renderLineGstFields = (
    item: InvoiceFormItem,
    index: number,
    /** Stamp the focus target only on the rendering that is on screen. */
    isStamped: boolean
  ) => (
    <div className="grid gap-2 rounded-md border border-dashed border-slate-200 bg-slate-50/70 p-2 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-700 dark:bg-slate-800/50">
      {isGst ? (
        <Field label="HSN/SAC">
          {(field) => (
            <Input
              {...field}
              inputMode="numeric"
              data-invoice-field={
                isStamped ? `items.${index}.hsnSac` : undefined
              }
              maxLength={HSN_FIELD_MAX}
              placeholder="998314"
              value={item.hsnSac ?? ""}
              onChange={(event) =>
                updateItem(
                  index,
                  "hsnSac",
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, HSN_FIELD_MAX) || undefined
                )
              }
            />
          )}
        </Field>
      ) : null}
      <Field label="Unit">
        {(field) => (
          <Input
            {...field}
            list="uqc-codes"
            maxLength={MAX_UNIT_LENGTH}
            placeholder="NOS"
            value={item.unit ?? ""}
            onChange={(event) =>
              updateItem(
                index,
                "unit",
                event.target.value
                  .toUpperCase()
                  .slice(0, MAX_UNIT_LENGTH) || undefined
              )
            }
          />
        )}
      </Field>
      {isGst ? (
        <Field
          label="GST rate"
          hint={
            isRetiredGstRate(item.taxRatePercent ?? -1)
              ? GST_RETIRED_RATE_WARNING
              : undefined
          }
        >
          {(field, labelId) => (
            <SelectField
              {...field}
              aria-labelledby={`${labelId} ${field.id}`}
              value={
                item.taxRatePercent === undefined
                  ? ""
                  : String(item.taxRatePercent)
              }
              onValueChange={(value) =>
                updateItem(
                  index,
                  "taxRatePercent",
                  value === "" ? undefined : Number(value)
                )
              }
              options={[
                { value: "", label: "Not taxed" },
                ...gstRateOptions(item.taxRatePercent),
              ]}
              placeholder="Pick a rate"
              className="text-slate-900 dark:text-slate-100"
            />
          )}
        </Field>
      ) : null}
      <Field label="Line discount">
        {(field) => (
          <NumericInput
            {...field}
            min={0}
            max={MAX_MONEY_VALUE}
            placeholder="0.00"
            value={item.discount ?? 0}
            onValueChange={(discount) =>
              updateItem(index, "discount", discount)
            }
          />
        )}
      </Field>
    </div>
  );

  const previewItems = invoice.items.filter((item) => item.description.trim());

  /**
   * Row indexes, not a filtered array: `totals.lines` is indexed against
   * `invoice.items`, so a preview built from a filtered copy would read another
   * line's tax. Before anything is typed there is nothing to filter, so the
   * placeholder row set is every line.
   */
  const previewRowIndexes = previewItems.length
    ? invoice.items
        .map((item, index) => ({ item, index }))
        .filter((entry) => entry.item.description.trim())
        .map((entry) => entry.index)
    : invoice.items.map((_, index) => index);
  const previewTableInput = {
    items: invoice.items,
    totals,
    currency: invoice.currency,
  };
  const previewColumns = buildLineItemColumns(previewTableInput);
  const previewAmountInWords = amountInWordsIndian(
    totals.total,
    invoice.currency
  );
  const previewSuppressionNote = totals.suppressedBecause
    ? TAX_SUPPRESSION_NOTES[totals.suppressedBecause]
    : "";
  const showCompanyLogo = Boolean(invoice.companyLogo.trim()) && !logoLoadFailed;
  const showSignatureImage =
    Boolean(invoice.signatureImageUrl.trim()) && !signatureLoadFailed;

  // A logo that fails to load is silent in the preview and on the printed
  // sheet, so say it here rather than letting the user discover it after send.
  const logoHint = logoLoadFailed
    ? "That image didn't load. Check the link is public and points straight at the file."
    : "Must be a public https:// link to an image file.";

  const dueDateHint =
    invoice.invoiceDate &&
    invoice.dueDate &&
    new Date(invoice.dueDate) < new Date(invoice.invoiceDate)
      ? "This is before the invoice date."
      : undefined;

  if (isLoadingInvoice) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 bg-slate-50 dark:bg-slate-950">
        <Card className="w-full max-w-md border-slate-200 dark:border-slate-700">
          <CardContent className="flex items-center gap-3 p-6 text-slate-700 dark:text-slate-200">
            <ReloadIcon className="w-4 h-4 animate-spin" />
            Loading invoice…
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageShell tone="app">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={leaveForDashboard}
              className="h-auto p-0 text-sm font-normal text-slate-600 hover:bg-transparent hover:text-slate-900 dark:text-slate-300 dark:hover:bg-transparent dark:hover:text-white"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Back to dashboard
            </Button>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-100">
              {mode === "edit" ? "Edit Invoice" : "Create Invoice"}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Build polished invoices with complete business and payment details.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {mode === "create" ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving}
                onClick={() => setIsAiPanelVisible((previousState) => !previousState)}
                className="w-full sm:w-auto"
              >
                {isAiPanelVisible ? "Hide AI Assistant" : "Show AI Assistant"}
              </Button>
            ) : null}
            {/* Desktop only. Below md these two live in the StickyActionBar at
                the bottom of the form, where the user actually finishes. */}
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => saveInvoice("draft")}
              className="hidden w-full sm:w-auto md:inline-flex"
            >
              Save Draft
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => saveInvoice("sent")}
              className="hidden w-full sm:w-auto md:inline-flex"
            >
              {isSaving ? (
                <>
                  <ReloadIcon className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckIcon className="w-4 h-4" />
                  {mode === "edit" ? "Update Invoice" : "Create Invoice"}
                </>
              )}
            </Button>
          </div>
        </div>

        {mode === "create" && isAiPanelVisible ? (
          <div className="mb-6">
            <InvoiceAiAssistant
              invoice={invoice}
              getAuthToken={getAuthTokenForAssistant}
              onApplyPatch={applyAiPatch}
            />
          </div>
        ) : null}

        <LiveStatus>{saveStatus}</LiveStatus>

        {/* Every blocking problem at once, each one a jump to its own field —
            rather than one error at a time at the top of a 2,400px form. */}
        <ValidationSummary issues={issues} className="mb-4" />

        {error ? (
          <AlertBanner className="mb-4" onRetry={errorRetry ?? undefined}>
            {error}
          </AlertBanner>
        ) : null}

        {/* A draft is OFFERED, never applied silently: the user may have
            abandoned it deliberately, and overwriting a freshly loaded invoice
            with a stale draft is the one failure worse than losing it. */}
        {pendingDraft ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
            <p className="min-w-0 flex-1">
              You have unsaved work on this invoice from{" "}
              {formatDraftAge(pendingDraft.ageMs)}. Restore it?
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" size="sm" onClick={applyPendingDraft}>
                Restore
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={discardDraft}
              >
                Discard
              </Button>
            </div>
          </div>
        ) : null}

        {/* Says plainly that this form was pre-filled from another invoice, and
            which one. A duplicate that arrives silently is indistinguishable
            from an editor that failed to clear itself. */}
        {duplicateNotice ? (
          <AlertBanner tone="success" className="mb-4">
            {duplicateNotice}
          </AlertBanner>
        ) : null}

        {/* Warnings, not errors. Each one describes an invoice that is unusual
            but legal, and a blocked save is a lost invoice. */}
        {warnings.length ? (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Two columns from lg, not xl: at 1024–1279 (iPad landscape, small
            laptops, split-screen windows) the preview used to sit ~1500px down,
            so the user scrolled past the entire form to see the document they
            were building. min-w-0 is load-bearing — grid items default to
            min-width:auto, and without it the line-item grid's min-w-[680px]
            propagates up and pushes the whole page into horizontal scroll. */}
        <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] xl:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
          <Card className="border-slate-200 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl text-slate-900 dark:text-slate-100">
                Invoice Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-7">
              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  Seller
                </MicroLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Company name">
                    {(field) => (
                      <Input
                        {...field}
                        data-invoice-field="companyName"
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="Acme Studio"
                        value={invoice.companyName}
                        onChange={(event) =>
                          updateField("companyName", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label="Company email">
                    {(field) => (
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="billing@acme.studio"
                        value={invoice.companyEmail}
                        onChange={(event) =>
                          updateField("companyEmail", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label="Company phone" optional>
                    {(field) => (
                      <Input
                        {...field}
                        type="tel"
                        inputMode="tel"
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="+91 98765 43210"
                        value={invoice.companyPhone}
                        onChange={(event) =>
                          updateField("companyPhone", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  {/* Rule 46(a). Seeded from the business profile but stored
                      ON THE INVOICE and editable here, because a user who
                      later changes registration must be able to reprint an old
                      document exactly as it was issued. Blank is a first-class
                      answer: most users are below the registration threshold. */}
                  <Field
                    label="Your GSTIN"
                    optional
                    hint="15 characters. Leave blank if you are not registered."
                  >
                    {(field) => (
                      <Input
                        {...field}
                        data-invoice-field="companyGstin"
                        maxLength={15}
                        placeholder="27AAPFU0939F1ZV"
                        value={invoice.companyGstin}
                        onChange={(event) => {
                          const companyGstin = event.target.value.toUpperCase();
                          markDirty();
                          setInvoice((prev) => ({
                            ...prev,
                            companyGstin,
                            // The PAN is characters 3-12 of the GSTIN, so a
                            // registered user never types it. A hand-typed one
                            // is only kept while there is no GSTIN to derive
                            // from — a printed PAN that contradicts the printed
                            // GSTIN is worse than no PAN at all.
                            companyPan:
                              panFromGstin(companyGstin) ||
                              (isValidGstin(prev.companyGstin)
                                ? ""
                                : prev.companyPan),
                          }));
                        }}
                      />
                    )}
                  </Field>
                  <Field
                    label="Your PAN"
                    optional
                    hint={
                      panFromGstin(invoice.companyGstin)
                        ? "Taken from your GSTIN."
                        : "Clients deducting TDS need this."
                    }
                  >
                    {(field) => (
                      <Input
                        {...field}
                        maxLength={10}
                        placeholder="AAPFU0939F"
                        readOnly={Boolean(panFromGstin(invoice.companyGstin))}
                        value={invoice.companyPan}
                        onChange={(event) =>
                          updateField(
                            "companyPan",
                            event.target.value.toUpperCase()
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field
                    label="Company logo URL"
                    optional
                    hint={logoHint}
                  >
                    {(field) => (
                      <Input
                        {...field}
                        type="url"
                        inputMode="url"
                        maxLength={URL_FIELD_MAX}
                        placeholder="https://acme.studio/logo.png"
                        value={invoice.companyLogo}
                        onChange={(event) =>
                          updateField("companyLogo", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label="Company address" className="sm:col-span-2">
                    {(field) => (
                      <Textarea
                        {...field}
                        maxLength={ADDRESS_FIELD_MAX}
                        placeholder="221B Residency Road&#10;Bengaluru, KA 560025"
                        value={invoice.companyAddress}
                        onChange={(event) =>
                          updateField("companyAddress", event.target.value)
                        }
                      />
                    )}
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MicroLabel as="h2" variant="section">
                    Client
                  </MicroLabel>
                  {/* The client half of the product's memory. Derived from this
                      user's own invoices, so it needs no setup and is empty
                      only for someone who has never sent anything. */}
                  <ClientPicker onSelect={chooseClient} disabled={isSaving} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client name">
                    {(field) => (
                      <Input
                        {...field}
                        data-invoice-field="billTo"
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="Nova Health Pvt Ltd"
                        value={invoice.billTo}
                        onChange={(event) => updateField("billTo", event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Client email" optional>
                    {(field) => (
                      <Input
                        {...field}
                        type="email"
                        inputMode="email"
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="accounts@novahealth.in"
                        value={invoice.billToEmail}
                        onChange={(event) =>
                          updateField("billToEmail", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  {/* Rule 46(e). Blank whenever the client is unregistered or
                      overseas, which is common and must stay unremarkable. */}
                  <Field
                    label="Client GSTIN"
                    optional
                    hint="Ask for it if the client is registered — they need it to claim input credit."
                  >
                    {(field) => (
                      <Input
                        {...field}
                        data-invoice-field="billToGstin"
                        maxLength={15}
                        placeholder="29AAGCB7383J1Z4"
                        value={invoice.billToGstin}
                        onChange={(event) =>
                          updateField(
                            "billToGstin",
                            event.target.value.toUpperCase()
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label="Client billing address" className="sm:col-span-2">
                    {(field) => (
                      <Textarea
                        {...field}
                        maxLength={ADDRESS_FIELD_MAX}
                        placeholder="4th Floor, Prestige Tower&#10;Mumbai, MH 400001"
                        value={invoice.billToAddress}
                        onChange={(event) =>
                          updateField("billToAddress", event.target.value)
                        }
                      />
                    )}
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  Invoice Details
                </MicroLabel>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Invoice number">
                    {(field) => (
                      <Input
                        {...field}
                        data-invoice-field="invoiceNumber"
                        maxLength={INVOICE_NUMBER_MAX}
                        placeholder="INV-2026-014"
                        value={invoice.invoiceNumber}
                        onChange={(event) =>
                          updateField("invoiceNumber", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label="Invoice date">
                    {(field, labelId) => (
                      <DatePickerField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        data-invoice-field="invoiceDate"
                        value={invoice.invoiceDate}
                        onValueChange={(value) => updateField("invoiceDate", value)}
                        placeholder="Pick a date"
                      />
                    )}
                  </Field>
                  <Field label="Due date" hint={dueDateHint}>
                    {(field, labelId) => (
                      <DatePickerField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        data-invoice-field="dueDate"
                        value={invoice.dueDate}
                        onValueChange={(value) => updateField("dueDate", value)}
                        placeholder="Pick a date"
                      />
                    )}
                  </Field>
                  <Field label="Currency">
                    {(field, labelId) => (
                      <SelectField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        value={invoice.currency}
                        onValueChange={(value) => updateField("currency", value)}
                        options={CURRENCY_OPTIONS.map((currencyCode) => ({
                          value: currencyCode,
                          label: currencyCode,
                        }))}
                        className="text-slate-900 dark:text-slate-100"
                      />
                    )}
                  </Field>
                  <Field label="Status">
                    {(field, labelId) => (
                      <SelectField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        value={invoice.status}
                        onValueChange={(value) =>
                          updateField("status", value as InvoiceStatus)
                        }
                        options={[
                          { value: "draft", label: "Draft" },
                          { value: "sent", label: "Sent" },
                          { value: "paid", label: "Paid" },
                          { value: "overdue", label: "Overdue" },
                        ]}
                        className="text-slate-900 dark:text-slate-100"
                      />
                    )}
                  </Field>
                  <Field label="Payment terms" optional>
                    {(field) => (
                      <Input
                        {...field}
                        maxLength={TEXT_FIELD_MAX}
                        placeholder="Net 30"
                        value={invoice.terms}
                        onChange={(event) => updateField("terms", event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <MicroLabel as="h2" variant="section">
                    Line Items
                  </MicroLabel>
                  <Button size="sm" variant="outline" onClick={addItem}>
                    <PlusIcon className="w-4 h-4" />
                    Add Item
                  </Button>
                </div>
                {/* One datalist for every Unit field: suggestions, not an enum.
                    A wrong UQC is a return-filing annoyance; a blocked save is
                    a lost invoice. */}
                <datalist id="uqc-codes">
                  {UQC_CODES.map((code) => (
                    <option key={code} value={code} />
                  ))}
                </datalist>
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                  {/* Table vs. cards is decided by how wide the *form column*
                      is, not by viewport size — and the column is not monotonic
                      in the viewport. Single column below lg is roughly
                      viewport-wide (657px at 768), so the table fits. From lg
                      the editor splits in two and the form column drops to
                      ~434px, so cards read better. From xl the split column is
                      back up to ~641px and the table fits again. Hence the
                      table appearing, disappearing, and reappearing. */}
                  <div className="hidden md:block lg:hidden xl:block">
                    {/* The form column is ~635px even at a 1440px viewport
                        (max-w-7xl caps the container), so the old 680px grid
                        scrolled sideways inside its own card at every desktop
                        size. Retuned to 580px so it fits the column it lives
                        in; the wrapper's scroll is now a genuine last resort. */}
                    <div className="grid min-w-[556px] grid-cols-[minmax(0,1.6fr)_84px_120px_112px_40px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <div>Description</div>
                      <div>Qty</div>
                      <div>Unit Price</div>
                      <div>Amount</div>
                      <div></div>
                    </div>
                    <div className="min-w-[556px] space-y-3 p-3">
                      {invoice.items.map((item, index) => (
                        <div className="space-y-2" key={`item-${index}`}>
                        <div className="grid grid-cols-[minmax(0,1.6fr)_84px_120px_112px_40px] items-center gap-2">
                          <Input
                            aria-label={`Line ${index + 1} description`}
                            data-invoice-field={
                              isLineTableVisible
                                ? `items.${index}.description`
                                : undefined
                            }
                            maxLength={TEXT_FIELD_MAX}
                            placeholder="e.g. Monthly retainer"
                            value={item.description}
                            onChange={(event) =>
                              updateItem(index, "description", event.target.value)
                            }
                          />
                          <NumericInput
                            aria-label={`Line ${index + 1} quantity`}
                            min={1}
                            max={MAX_ITEM_QUANTITY}
                            decimals={0}
                            value={item.quantity}
                            onValueChange={(quantity) =>
                              updateItem(index, "quantity", quantity)
                            }
                          />
                          <NumericInput
                            aria-label={`Line ${index + 1} unit price`}
                            min={0}
                            max={MAX_ITEM_UNIT_PRICE}
                            value={item.unitPrice}
                            onValueChange={(unitPrice) =>
                              updateItem(index, "unitPrice", unitPrice)
                            }
                            placeholder="0.00"
                          />
                          <div className="tabular min-w-0 truncate text-right text-sm font-medium text-slate-700 dark:text-slate-200">
                            {formatCurrency(
                              Math.max(0, item.quantity) * Math.max(0, item.unitPrice),
                              invoice.currency
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(index)}
                            disabled={invoice.items.length === 1}
                            aria-label="Remove item"
                          >
                            <TrashIcon className="w-4 h-4 text-slate-500 dark:text-slate-300" />
                          </Button>
                        </div>
                        {renderLineGstFields(item, index, isLineTableVisible)}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3 p-3 md:hidden lg:block xl:hidden">
                    {invoice.items.map((item, index) => (
                      <div
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-800/80"
                        key={`item-mobile-${index}`}
                      >
                        <div className="space-y-2">
                          <Field label={`Line ${index + 1} description`}>
                            {(field) => (
                              <Input
                                {...field}
                                data-invoice-field={
                                  isLineTableVisible
                                    ? undefined
                                    : `items.${index}.description`
                                }
                                maxLength={TEXT_FIELD_MAX}
                                placeholder="e.g. Monthly retainer"
                                value={item.description}
                                onChange={(event) =>
                                  updateItem(index, "description", event.target.value)
                                }
                              />
                            )}
                          </Field>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="Qty">
                              {(field) => (
                                <NumericInput
                                  {...field}
                                  min={1}
                                  max={MAX_ITEM_QUANTITY}
                                  decimals={0}
                                  value={item.quantity}
                                  onValueChange={(quantity) =>
                                    updateItem(index, "quantity", quantity)
                                  }
                                />
                              )}
                            </Field>
                            <Field label="Unit price">
                              {(field) => (
                                <NumericInput
                                  {...field}
                                  min={0}
                                  max={MAX_ITEM_UNIT_PRICE}
                                  value={item.unitPrice}
                                  onValueChange={(unitPrice) =>
                                    updateItem(index, "unitPrice", unitPrice)
                                  }
                                  placeholder="0.00"
                                />
                              )}
                            </Field>
                          </div>
                          {renderLineGstFields(item, index, !isLineTableVisible)}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-300">Amount</span>
                          <span className="tabular font-semibold text-slate-700 dark:text-slate-100">
                            {formatCurrency(
                              Math.max(0, item.quantity) * Math.max(0, item.unitPrice),
                              invoice.currency
                            )}
                          </span>
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(index)}
                            disabled={invoice.items.length === 1}
                            aria-label="Remove item"
                          >
                            <TrashIcon className="w-4 h-4 text-slate-500 dark:text-slate-300" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  Discounts &amp; Tax
                </MicroLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="discount"
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Discount
                    </label>
                    <NumericInput
                      id="discount"
                      min={0}
                      max={MAX_MONEY_VALUE}
                      placeholder="0.00"
                      value={invoice.discount}
                      onValueChange={(discount) => updateField("discount", discount)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="service-charge"
                      className="text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Service Charge
                    </label>
                    <NumericInput
                      id="service-charge"
                      min={0}
                      max={MAX_MONEY_VALUE}
                      placeholder="0.00"
                      value={invoice.convenienceCharge}
                      onValueChange={(convenienceCharge) =>
                        updateField("convenienceCharge", convenienceCharge)
                      }
                    />
                  </div>
                </div>
              </section>

              {/* GST identity, geography and reverse charge.
                  The one question this section does NOT ask is "are you
                  registered?". Registration status is derived from the GSTIN on
                  the business profile — a GSTIN is a thing a user HAS, a
                  registration status is a thing they would have to interpret.
                  See docs/design/phase-2-gst-correctness.md §2.3. */}
              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  GST &amp; Place of Supply
                </MicroLabel>

                <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                  {isLegacyDocument ? (
                    <div className="space-y-2">
                      <p className="text-slate-700 dark:text-slate-200">
                        This invoice was created before Invoicey had GST fields.
                        Its tax is kept exactly as it was saved
                        {invoice.cgst || invoice.sgst
                          ? ` (${formatCurrency(
                              invoice.cgst + invoice.sgst,
                              invoice.currency
                            )})`
                          : ""}
                        .
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          markDirty();
                          setInvoice((prev) => ({
                            ...prev,
                            taxTreatment: profile?.taxTreatment ?? "none",
                            // The identity comes across too, or the migrated
                            // document would be headed TAX INVOICE with no
                            // GSTIN under it.
                            companyGstin:
                              prev.companyGstin || profile?.companyGstin || "",
                            companyPan:
                              prev.companyPan || profile?.companyPan || "",
                            supplierStateCode:
                              prev.supplierStateCode ||
                              profile?.supplierStateCode ||
                              "",
                            placeOfSupplyStateCode:
                              prev.placeOfSupplyStateCode ||
                              profile?.supplierStateCode ||
                              "",
                            lutArn: prev.lutArn || profile?.lutArn || "",
                          }));
                        }}
                      >
                        Move this invoice onto GST fields
                      </Button>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Tax will then be worked out per line from the rate and
                        the place of supply. The flat amount above is replaced.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {DOCUMENT_TITLES[documentType]}
                        {invoice.companyGstin || profile?.companyGstin
                          ? ` · GSTIN ${
                              invoice.companyGstin || profile?.companyGstin
                            }`
                          : ""}
                      </p>
                      <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        {invoice.taxTreatment === "gst"
                          ? "GST is worked out per line, from the rate you pick and the place of supply."
                          : invoice.taxTreatment === "composition"
                            ? "Composition levy: tax is not collected from the client, and this prints as a Bill of Supply."
                            : "No GST is charged on this invoice."}
                      </p>
                      {invoice.taxTreatment === "none" ? (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          Add your GSTIN in your{" "}
                          <a
                            href="/profile"
                            className="font-medium underline underline-offset-2"
                          >
                            business profile
                          </a>{" "}
                          to issue tax invoices.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Geography is asked ONLY of a registered supplier. Someone
                    with no GSTIN charges no tax anywhere in India, so a place
                    of supply has nothing to decide for them — and setup
                    ceremony they cannot act on is the defect PRODUCT.md names
                    first. */}
                {isRegisteredSupplier ? (
                <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Your state"
                    hint="Must match the first two digits of your GSTIN."
                  >
                    {(field, labelId) => (
                      <SelectField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        data-invoice-field="supplierStateCode"
                        value={invoice.supplierStateCode}
                        onValueChange={(value) => {
                          markDirty();
                          setInvoice((prev) => ({
                            ...prev,
                            supplierStateCode: value,
                            // The place of supply follows the supplier's state
                            // until the user moves it themselves. Intra-State is
                            // the overwhelmingly common case, and a default good
                            // enough to skip is the point.
                            ...(prev.placeOfSupplyOverridden
                              ? {}
                              : {
                                  placeOfSupplyStateCode: value,
                                  placeOfSupplyLabel:
                                    placeOfSupplyLabelFor(value),
                                }),
                          }));
                        }}
                        options={STATE_OPTIONS}
                        placeholder="Select your state"
                        className="text-slate-900 dark:text-slate-100"
                      />
                    )}
                  </Field>
                  <Field
                    label="Place of supply"
                    hint="Where the client receives this supply."
                  >
                    {(field, labelId) => (
                      <SelectField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        data-invoice-field="placeOfSupplyStateCode"
                        value={invoice.placeOfSupplyStateCode}
                        onValueChange={(value) => {
                          markDirty();
                          setInvoice((prev) => ({
                            ...prev,
                            placeOfSupplyStateCode: value,
                            placeOfSupplyLabel: placeOfSupplyLabelFor(value),
                            // Records that the user moved it deliberately, so a
                            // later change of supplier state cannot drag it back.
                            placeOfSupplyOverridden: true,
                            recipientIsOutsideIndia:
                              value === OTHER_COUNTRY_STATE_CODE
                                ? true
                                : prev.recipientIsOutsideIndia,
                          }));
                        }}
                        options={PLACE_OF_SUPPLY_OPTIONS}
                        placeholder="Select the place of supply"
                        className="text-slate-900 dark:text-slate-100"
                      />
                    )}
                  </Field>
                </div>

                <div className="space-y-2">
                  <ToggleRow
                    label="Recipient is an SEZ unit or developer"
                    description="An SEZ supply is inter-State even when the SEZ is in your own state."
                    checked={invoice.recipientIsSez}
                    onChange={(checked) => {
                      markDirty();
                      updateField("recipientIsSez", checked);
                    }}
                  />
                  <ToggleRow
                    label="Recipient is outside India"
                    description="Makes this an export: zero-rated, with or without payment of tax."
                    checked={invoice.recipientIsOutsideIndia}
                    onChange={(checked) => {
                      markDirty();
                      updateField("recipientIsOutsideIndia", checked);
                    }}
                  />
                  <ToggleRow
                    label="Tax payable by the recipient (reverse charge)"
                    description="Rule 46(o). The rate is shown, the amount is not collected."
                    checked={invoice.reverseCharge}
                    onChange={(checked) => {
                      markDirty();
                      updateField("reverseCharge", checked);
                    }}
                  />
                </div>

                {isZeroRated ? (
                  <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <ToggleRow
                      label="With payment of integrated tax"
                      description="Off means under bond or LUT, with no IGST charged."
                      checked={invoice.withPaymentOfTax}
                      onChange={(checked) => {
                        markDirty();
                        updateField("withPaymentOfTax", checked);
                      }}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      {supplyKind === "export" ? (
                        <Field label="Country of destination">
                          {(field) => (
                            <Input
                              {...field}
                              data-invoice-field="countryOfDestination"
                              maxLength={TEXT_FIELD_MAX}
                              placeholder="United States"
                              value={invoice.countryOfDestination}
                              onChange={(event) => {
                                markDirty();
                                updateField(
                                  "countryOfDestination",
                                  event.target.value
                                );
                              }}
                            />
                          )}
                        </Field>
                      ) : null}
                      {invoice.withPaymentOfTax ? null : (
                        <Field label="LUT ARN">
                          {(field) => (
                            <Input
                              {...field}
                              data-invoice-field="lutArn"
                              maxLength={60}
                              placeholder="AD290123456789A"
                              value={invoice.lutArn}
                              onChange={(event) => {
                                markDirty();
                                updateField("lutArn", event.target.value);
                              }}
                            />
                          )}
                        </Field>
                      )}
                    </div>
                    {endorsement ? (
                      <p className="rounded-md bg-slate-100 p-2 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {endorsement}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                </>
                ) : null}
              </section>

              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  Payment &amp; Notes
                </MicroLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Payment information" optional>
                    {(field) => (
                      <Textarea
                        {...field}
                        maxLength={NOTES_FIELD_MAX}
                        placeholder="Account name, account number, IFSC, UPI ID"
                        value={invoice.paymentInfo}
                        onChange={(event) =>
                          updateField("paymentInfo", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field label="Additional notes" optional>
                    {(field) => (
                      <Textarea
                        {...field}
                        maxLength={NOTES_FIELD_MAX}
                        placeholder="Thanks for your business."
                        value={invoice.notes}
                        onChange={(event) => updateField("notes", event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              </section>

              {/* TDS and the signature block (item 7).
                  TDS is the CLIENT's deduction: it is printed so both sides
                  agree on what will arrive, and it never changes the invoice
                  total. See `buildTotalsRows`. */}
              <section className="space-y-3">
                <MicroLabel as="h2" variant="section">
                  TDS &amp; Signature
                </MicroLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="TDS section"
                    optional
                    hint="Deducted by the client. It does not reduce this invoice."
                  >
                    {(field, labelId) => (
                      <SelectField
                        {...field}
                        aria-labelledby={`${labelId} ${field.id}`}
                        value={invoice.tdsSection}
                        onValueChange={(value) => {
                          const tdsSection = value as TdsSection;
                          markDirty();
                          setInvoice((prev) => ({
                            ...prev,
                            tdsSection,
                            // Prefill the statutory rate, overridable below. A
                            // 0 here would print "TDS @0%", so the section's
                            // own rate is the only sensible landing value.
                            tdsRatePercent:
                              tdsSpecFor(tdsSection)?.ratePercent ?? 0,
                          }));
                        }}
                        options={[
                          { value: "none", label: "No TDS" },
                          ...TDS_SECTIONS.map((spec) => ({
                            value: spec.value,
                            label: spec.label,
                          })),
                        ]}
                        className="text-slate-900 dark:text-slate-100"
                      />
                    )}
                  </Field>
                  {invoice.tdsSection === "none" ? null : (
                    <Field
                      label="TDS rate %"
                      hint="On the pre-GST value, per CBDT Circular 23/2017."
                    >
                      {(field) => (
                        <NumericInput
                          {...field}
                          min={0}
                          max={MAX_TDS_RATE_PERCENT}
                          placeholder="10"
                          value={invoice.tdsRatePercent}
                          onValueChange={(tdsRatePercent) =>
                            updateField("tdsRatePercent", tdsRatePercent)
                          }
                        />
                      )}
                    </Field>
                  )}
                  <Field
                    label="Signature label"
                    optional
                    hint="Defaults to “For <your company>”."
                  >
                    {(field) => (
                      <Input
                        {...field}
                        maxLength={TEXT_FIELD_MAX}
                        placeholder={`For ${invoice.companyName || "your company"}`}
                        value={invoice.signatureLabel}
                        onChange={(event) =>
                          updateField("signatureLabel", event.target.value)
                        }
                      />
                    )}
                  </Field>
                  <Field
                    label="Signature image URL"
                    optional
                    hint="A public https:// link to a signature image."
                  >
                    {(field) => (
                      <Input
                        {...field}
                        type="url"
                        inputMode="url"
                        maxLength={URL_FIELD_MAX}
                        placeholder="https://acme.studio/signature.png"
                        value={invoice.signatureImageUrl}
                        onChange={(event) =>
                          updateField("signatureImageUrl", event.target.value)
                        }
                      />
                    )}
                  </Field>
                </div>
              </section>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:sticky lg:top-24 lg:h-fit">
            <CardHeader className="border-b border-slate-200 pb-3 dark:border-slate-700">
              <CardTitle className="text-xl text-slate-900 dark:text-slate-100">
                Live Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-b border-slate-200 bg-slate-900 p-5 text-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <div>
                    <MicroLabel variant="onDark">
                      {DOCUMENT_TITLES[documentType]}
                    </MicroLabel>
                    <p className="mt-1 text-xl font-semibold tracking-tight">
                      {invoice.invoiceNumber || "INV-XXXXXX"}
                    </p>
                  </div>
                  {showCompanyLogo ? (
                    <img
                      src={invoice.companyLogo}
                      alt={`${invoice.companyName || "Company"} logo`}
                      className="h-12 w-12 rounded-md border border-white/20 bg-white/10 object-contain p-1"
                      onError={() => setLogoLoadFailed(true)}
                    />
                  ) : null}
                  <span
                    className={`${STATUS_PILL_BASE} px-3 ${statusPillOnMastheadClass[invoice.status]}`}
                  >
                    {invoice.status}
                  </span>
                </div>
              </div>

              {/* Statutory wording, printed verbatim from the constants in
                  lib/gst-supply.ts. Do not reflow, re-case or "improve" it —
                  and never rebuild it from parts here, or the preview and the
                  exported document stop being the same sentence. */}
              {invoice.taxTreatment === "composition" ? (
                <p className="border-b border-slate-200 bg-slate-100 px-5 py-2 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {COMPOSITION_BANNER}
                </p>
              ) : null}
              {endorsement ? (
                <p className="border-b border-slate-200 bg-slate-100 px-5 py-2 text-xs font-semibold leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                  {endorsement}
                </p>
              ) : null}

              <div className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <MicroLabel as="p" variant="section">
                      Bill From
                    </MicroLabel>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {invoice.companyName || "Your Company"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">
                      {invoice.companyAddress || "Company address"}
                    </p>
                    {/* Rule 46(a)/(e): each party's GSTIN sits with that
                        party's name, which is where a reader looks for it.
                        Omitted entirely when blank — an unregistered supplier's
                        document should not mention GSTIN at all. */}
                    {invoice.companyGstin ? (
                      <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          GSTIN{" "}
                        </span>
                        {invoice.companyGstin}
                      </p>
                    ) : null}
                    {invoice.companyPan ? (
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          PAN{" "}
                        </span>
                        {invoice.companyPan}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <MicroLabel as="p" variant="section">
                      Bill To
                    </MicroLabel>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {invoice.billTo || "Client name"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">
                      {invoice.billToAddress || "Client address"}
                    </p>
                    {invoice.billToGstin ? (
                      <p className="mt-1 text-xs font-medium text-slate-700 dark:text-slate-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          GSTIN{" "}
                        </span>
                        {invoice.billToGstin}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-slate-500 dark:text-slate-300">Invoice Date</p>
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {invoice.invoiceDate
                        ? formatDateLong(invoice.invoiceDate)
                        : "Select date"}
                    </p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-slate-500 dark:text-slate-300">Due Date</p>
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {invoice.dueDate ? formatDateLong(invoice.dueDate) : "Select date"}
                    </p>
                  </div>
                </div>

                {/* Rule 46(o) asks for the reverse-charge INDICATOR, not the
                    flag: it is printed even when the answer is "No". */}
                {isLegacyDocument ? null : (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-slate-500 dark:text-slate-300">
                        Place of Supply
                      </p>
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {invoice.placeOfSupplyLabel ||
                          placeOfSupplyLabelFor(invoice.placeOfSupplyStateCode) ||
                          "—"}
                      </p>
                    </div>
                    {invoice.taxTreatment === "none" ? null : (
                      <div>
                        <p className="text-slate-500 dark:text-slate-300">
                          Reverse Charge
                        </p>
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {invoice.reverseCharge ? "Yes" : "No"}
                        </p>
                      </div>
                    )}
                    {invoice.countryOfDestination ? (
                      <div>
                        <p className="text-slate-500 dark:text-slate-300">
                          Country of Destination
                        </p>
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {invoice.countryOfDestination}
                        </p>
                      </div>
                    ) : null}
                    {invoice.lutArn ? (
                      <div>
                        <p className="text-slate-500 dark:text-slate-300">LUT ARN</p>
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {invoice.lutArn}
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Same column list the exported document uses. The two
                    renderings cannot disagree about which columns exist, in what
                    order, or what an empty one means. */}
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {previewColumns.map((column) => (
                          <th
                            key={column.key}
                            scope="col"
                            className={`px-3 py-2 ${
                              column.align === "right" ? "text-right" : "text-left"
                            } ${column.wrap ? "" : "whitespace-nowrap"}`}
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {previewRowIndexes.map((itemIndex) => (
                        <tr key={`preview-item-${itemIndex}`}>
                          {buildLineItemCells(
                            previewColumns,
                            previewTableInput,
                            itemIndex
                          ).map((cell, cellIndex) => (
                            <td
                              key={previewColumns[cellIndex].key}
                              className={`px-3 py-2 ${
                                previewColumns[cellIndex].align === "right"
                                  ? "text-right text-slate-700 dark:text-slate-100"
                                  : "text-slate-700 dark:text-slate-200"
                              } ${
                                previewColumns[cellIndex].wrap
                                  ? "max-w-0 truncate"
                                  : "whitespace-nowrap"
                              }`}
                            >
                              {previewColumns[cellIndex].key === "description"
                                ? cell || "Untitled item"
                                : cell || "-"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 text-sm">
                  {buildTotalsRows(totals).map((row) => (
                    <div
                      // Two tax rows can share a label the moment a rate suffix
                      // is dropped; the head is the stable identity.
                      key={row.head ?? row.label}
                      className={
                        row.kind === "grand"
                          ? "flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                          : row.kind === "info"
                            ? // Non-arithmetic: quieter than a real line, so it
                              // cannot read as a reduction of the total.
                              "flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"
                            : "flex items-center justify-between text-slate-600 dark:text-slate-300"
                      }
                    >
                      <span>{row.label}</span>
                      <span className="tabular">
                        {row.kind === "discount" ? "- " : ""}
                        {formatCurrency(row.amount, invoice.currency)}
                      </span>
                    </div>
                  ))}
                </div>

                {previewSuppressionNote ? (
                  <p className="text-right text-xs text-slate-500 dark:text-slate-400">
                    {previewSuppressionNote}
                  </p>
                ) : null}

                {previewAmountInWords ? (
                  <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">
                      Amount in words:
                    </span>{" "}
                    {previewAmountInWords}
                  </p>
                ) : null}

                {/* Ubiquitous practice, NOT a statutory safe harbour — worded
                    so it does not promise otherwise. */}
                <div className="border-t border-slate-200 pt-3 text-right text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <p className="text-slate-700 dark:text-slate-200">
                    {invoice.signatureLabel ||
                      `For ${invoice.companyName || "your company"}`}
                  </p>
                  {showSignatureImage ? (
                    <img
                      src={invoice.signatureImageUrl}
                      alt="Signature"
                      className="ml-auto mt-2 max-h-16 max-w-[200px] object-contain"
                      onError={() => setSignatureLoadFailed(true)}
                    />
                  ) : null}
                  <p className={showSignatureImage ? "mt-2" : "mt-6"}>
                    Authorised Signatory
                  </p>
                  <p className="mt-1">
                    This is a computer-generated invoice and does not require a
                    signature.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* The same two actions as the header, pinned to the bottom of the
            viewport below md. Filling the last field and then scrolling the
            whole form back up to save is the problem this removes. */}
        <StickyActionBar
          status={
            issues.length
              ? `${issues.length} ${
                  issues.length === 1 ? "thing" : "things"
                } to fix before saving — see the list above.`
              : isDirty && savedAt
                ? "Draft saved on this device."
                : null
          }
        >
          <Button
            variant="outline"
            disabled={isSaving}
            onClick={() => saveInvoice("draft")}
            className="flex-1"
          >
            Save Draft
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => saveInvoice("sent")}
            className="flex-1"
          >
            {isSaving ? (
              <>
                <ReloadIcon className="w-4 h-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <CheckIcon className="w-4 h-4" />
                {mode === "edit" ? "Update Invoice" : "Create Invoice"}
              </>
            )}
          </Button>
        </StickyActionBar>
      </div>

      {/* Unsaved work is never thrown away without asking. `beforeunload`
          covers a tab close with the browser's own wording; this covers the
          back gesture and every in-app link. */}
      <ConfirmDialog
        open={Boolean(pendingLeave)}
        title="Leave without saving?"
        description={UNSAVED_CHANGES_MESSAGE}
        confirmLabel="Leave"
        cancelLabel="Stay on this page"
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.proceed();
        }}
        onCancel={() => setPendingLeave(null)}
      />

      {/* The picker never overwrites typed work on its own. This is the
          "explicit choice" — and it names every field it is about to change,
          because "replace client details?" is not enough to answer with. */}
      <ConfirmDialog
        open={Boolean(pendingClient)}
        tone="default"
        title="Replace the client details you've typed?"
        description={
          <>
            <strong className="font-semibold text-slate-800 dark:text-slate-100">
              {pendingClient?.name || "This client"}
            </strong>{" "}
            has different details on file. Continuing overwrites:
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {pendingClientConflicts.map((field) => (
                <li key={field.key}>{field.label}</li>
              ))}
            </ul>
          </>
        }
        confirmLabel="Replace details"
        cancelLabel="Keep what I typed"
        onConfirm={() => {
          if (pendingClient) {
            applyClient(pendingClient);
          }
          setPendingClient(null);
        }}
        onCancel={() => setPendingClient(null)}
      />
    </PageShell>
  );
}
