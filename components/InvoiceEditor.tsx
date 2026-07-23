"use client";

import { type FocusEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker-field";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner, LiveStatus } from "@/components/ui/alert-banner";
import InvoiceAiAssistant from "@/components/InvoiceAiAssistant";
import {
  invoicesApi,
  getAuthToken,
  describeRequestError,
  UnauthenticatedError,
} from "@/lib/api-client";
import type { InvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/contracts";
import { applyInvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/apply-patch";
import { buildTotalsRows } from "@/lib/invoice-domain";
import {
  CURRENCY_OPTIONS,
  InvoiceFormItem,
  InvoiceFormState,
  InvoiceStatus,
  calculateInvoiceTotals,
  createDefaultInvoiceFormState,
  formatCurrency,
  formatDateLong,
  mapFormStateToPayload,
  mapInvoiceRecordToFormState,
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

const statusClassName: Record<InvoiceStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
};

// Input ceilings. The server recomputes and clamps every total, so these exist
// to stop a paste or a stuck key from producing an invoice no client would
// accept — and to keep the preview and the printed sheet legible.
const TEXT_FIELD_MAX = 120;
const INVOICE_NUMBER_MAX = 40;
const ADDRESS_FIELD_MAX = 400;
const NOTES_FIELD_MAX = 1000;
const URL_FIELD_MAX = 2048;
const MAX_ITEM_QUANTITY = 100_000;
const MAX_ITEM_UNIT_PRICE = 100_000_000;
const MAX_LINE_ITEMS = 100;

const clampQuantity = (value: number) =>
  Math.min(MAX_ITEM_QUANTITY, Math.max(1, Math.round(value)));

const clampUnitPrice = (value: number) =>
  Math.min(MAX_ITEM_UNIT_PRICE, Math.max(0, value));

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
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [cgstMode, setCgstMode] = useState<"percent" | "amount">("amount");
  const [sgstMode, setSgstMode] = useState<"percent" | "amount">("amount");
  const [cgstRate, setCgstRate] = useState(0);
  const [sgstRate, setSgstRate] = useState(0);
  const authRedirectPath = useMemo(() => {
    if (mode === "edit" && invoiceId) {
      return `/auth?next=${encodeURIComponent(`/create-invoice/${invoiceId}`)}`;
    }
    return "/auth?next=%2Fcreate-invoice";
  }, [invoiceId, mode]);

  const totals = useMemo(
    () =>
      calculateInvoiceTotals({
        items: invoice.items,
        discount: invoice.discount,
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        convenienceCharge: invoice.convenienceCharge,
      }),
    [invoice]
  );

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

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [invoice.companyLogo]);

  useEffect(() => {
    if (cgstMode !== "percent") {
      return;
    }
    setInvoice((prev) => ({
      ...prev,
      cgst: Number(((cgstRate / 100) * totals.subtotal).toFixed(2)),
    }));
  }, [totals.subtotal, cgstMode, cgstRate]);

  useEffect(() => {
    if (sgstMode !== "percent") {
      return;
    }
    setInvoice((prev) => ({
      ...prev,
      sgst: Number(((sgstRate / 100) * totals.subtotal).toFixed(2)),
    }));
  }, [totals.subtotal, sgstMode, sgstRate]);

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

    setInvoice((previousState) => {
      const { nextState, appliedFields: nextAppliedFields } = applyInvoiceAssistantPatch(
        previousState,
        patch
      );
      appliedFields = nextAppliedFields;
      return nextState;
    });

    return appliedFields;
  }, []);

  const updateField = <K extends keyof InvoiceFormState>(
    key: K,
    value: InvoiceFormState[K]
  ) => {
    setInvoice((prev) => ({ ...prev, [key]: value }));
  };

  const updateItem = <K extends keyof InvoiceFormItem>(
    index: number,
    key: K,
    value: InvoiceFormItem[K]
  ) => {
    setInvoice((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [key]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => {
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

  const parseNumberInput = (value: string, fallback = 0) => {
    if (!value.trim()) {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const selectZeroValueOnFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (event.target.value === "0") {
      event.target.select();
    }
  };

  const saveInvoice = async (status: InvoiceStatus = invoice.status) => {
    if (isSaving) {
      return;
    }
    setError("");
    setErrorRetry(null);

    // Each check names the one field to fix, so the message maps to a single
    // place on screen rather than making the user hunt through the form.
    if (!invoice.companyName.trim()) {
      showError("Add your company name — it appears at the top of the invoice.");
      return;
    }

    if (!invoice.billTo.trim()) {
      showError("Add a client name so the invoice knows who it is addressed to.");
      return;
    }

    if (!invoice.invoiceNumber.trim()) {
      showError("Give this invoice a number, for example INV-2026-014.");
      return;
    }

    if (!invoice.invoiceDate || Number.isNaN(new Date(invoice.invoiceDate).getTime())) {
      showError("Pick an invoice date.");
      return;
    }

    if (!invoice.dueDate || Number.isNaN(new Date(invoice.dueDate).getTime())) {
      showError("Pick a due date.");
      return;
    }

    if (new Date(invoice.dueDate) < new Date(invoice.invoiceDate)) {
      showError("The due date falls before the invoice date. Check both dates.");
      return;
    }

    const validItems = invoice.items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      showError("Add at least one line item with a description.");
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
        router.push("/dashboard");
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

  const previewItems = invoice.items.filter((item) => item.description.trim());
  const showCompanyLogo = Boolean(invoice.companyLogo.trim()) && !logoLoadFailed;

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
            Loading invoice...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white px-4 py-8 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/dashboard")}
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
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => saveInvoice("draft")}
              className="w-full sm:w-auto"
            >
              Save Draft
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => saveInvoice("sent")}
              className="w-full sm:w-auto"
            >
              {isSaving ? (
                <>
                  <ReloadIcon className="w-4 h-4 animate-spin" />
                  Saving...
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

        {error ? (
          <AlertBanner className="mb-4" onRetry={errorRetry ?? undefined}>
            {error}
          </AlertBanner>
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
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                  Seller
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Company name">
                    {(field) => (
                      <Input
                        {...field}
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
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                  Client
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Client name">
                    {(field) => (
                      <Input
                        {...field}
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
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                  Meta
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Invoice number">
                    {(field) => (
                      <Input
                        {...field}
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
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                    Line Items
                  </h2>
                  <Button size="sm" variant="outline" onClick={addItem}>
                    <PlusIcon className="w-4 h-4" />
                    Add Item
                  </Button>
                </div>
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
                    <div className="grid min-w-[556px] grid-cols-[minmax(0,1.6fr)_84px_120px_112px_40px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      <div>Description</div>
                      <div>Qty</div>
                      <div>Unit Price</div>
                      <div>Amount</div>
                      <div></div>
                    </div>
                    <div className="min-w-[556px] space-y-2 p-3">
                      {invoice.items.map((item, index) => (
                        <div
                          className="grid grid-cols-[minmax(0,1.6fr)_84px_120px_112px_40px] items-center gap-2"
                          key={`item-${index}`}
                        >
                          <Input
                            aria-label={`Line ${index + 1} description`}
                            maxLength={TEXT_FIELD_MAX}
                            placeholder="e.g. Monthly retainer"
                            value={item.description}
                            onChange={(event) =>
                              updateItem(index, "description", event.target.value)
                            }
                          />
                          <Input
                            aria-label={`Line ${index + 1} quantity`}
                            type="number"
                            min={1}
                            max={MAX_ITEM_QUANTITY}
                            value={item.quantity}
                            onFocus={selectZeroValueOnFocus}
                            onChange={(event) =>
                              updateItem(
                                index,
                                "quantity",
                                clampQuantity(parseNumberInput(event.target.value, 1))
                              )
                            }
                          />
                          <Input
                            aria-label={`Line ${index + 1} unit price`}
                            type="number"
                            min={0}
                            max={MAX_ITEM_UNIT_PRICE}
                            step="0.01"
                            value={item.unitPrice}
                            onFocus={selectZeroValueOnFocus}
                            onChange={(event) =>
                              updateItem(
                                index,
                                "unitPrice",
                                clampUnitPrice(parseNumberInput(event.target.value, 0))
                              )
                            }
                            placeholder="0.00"
                          />
                          <div className="min-w-0 truncate text-right text-sm font-medium text-slate-700 dark:text-slate-200">
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
                                <Input
                                  {...field}
                                  type="number"
                                  min={1}
                                  max={MAX_ITEM_QUANTITY}
                                  value={item.quantity}
                                  onFocus={selectZeroValueOnFocus}
                                  onChange={(event) =>
                                    updateItem(
                                      index,
                                      "quantity",
                                      clampQuantity(parseNumberInput(event.target.value, 1))
                                    )
                                  }
                                />
                              )}
                            </Field>
                            <Field label="Unit price">
                              {(field) => (
                                <Input
                                  {...field}
                                  type="number"
                                  min={0}
                                  max={MAX_ITEM_UNIT_PRICE}
                                  step="0.01"
                                  value={item.unitPrice}
                                  onFocus={selectZeroValueOnFocus}
                                  onChange={(event) =>
                                    updateItem(
                                      index,
                                      "unitPrice",
                                      clampUnitPrice(parseNumberInput(event.target.value, 0))
                                    )
                                  }
                                  placeholder="0.00"
                                />
                              )}
                            </Field>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-slate-500 dark:text-slate-300">Amount</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-100">
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

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="discount"
                    className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
                  >
                    Discount
                  </label>
                  <Input
                    id="discount"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={invoice.discount}
                    onFocus={selectZeroValueOnFocus}
                    onChange={(event) =>
                      updateField(
                        "discount",
                        Math.max(0, parseNumberInput(event.target.value, 0))
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="service-charge"
                    className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
                  >
                    Service Charge
                  </label>
                  <Input
                    id="service-charge"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={invoice.convenienceCharge}
                    onFocus={selectZeroValueOnFocus}
                    onChange={(event) =>
                      updateField(
                        "convenienceCharge",
                        Math.max(0, parseNumberInput(event.target.value, 0))
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="cgst"
                    className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
                  >
                    CGST
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      id="cgst"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={cgstMode === "percent" ? cgstRate : invoice.cgst}
                      onFocus={selectZeroValueOnFocus}
                      onChange={(event) => {
                        const val = Math.max(0, parseNumberInput(event.target.value, 0));
                        if (cgstMode === "percent") {
                          setCgstRate(val);
                          updateField("cgst", Number(((val / 100) * totals.subtotal).toFixed(2)));
                        } else {
                          updateField("cgst", val);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 px-3 font-mono text-xs"
                      aria-label={
                        cgstMode === "percent"
                          ? "CGST entered as a percentage. Switch to a fixed amount."
                          : "CGST entered as a fixed amount. Switch to a percentage."
                      }
                      onClick={() => {
                        if (cgstMode === "amount") {
                          setCgstMode("percent");
                          const rate = totals.subtotal > 0
                            ? Number(((invoice.cgst / totals.subtotal) * 100).toFixed(2))
                            : 0;
                          setCgstRate(rate);
                        } else {
                          setCgstMode("amount");
                        }
                      }}
                    >
                      {cgstMode === "percent" ? "%" : "₹"}
                    </Button>
                  </div>
                  {cgstMode === "percent" ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      = {formatCurrency(invoice.cgst, invoice.currency)}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="sgst"
                    className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
                  >
                    SGST
                  </label>
                  <div className="flex gap-1.5">
                    <Input
                      id="sgst"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0.00"
                      value={sgstMode === "percent" ? sgstRate : invoice.sgst}
                      onFocus={selectZeroValueOnFocus}
                      onChange={(event) => {
                        const val = Math.max(0, parseNumberInput(event.target.value, 0));
                        if (sgstMode === "percent") {
                          setSgstRate(val);
                          updateField("sgst", Number(((val / 100) * totals.subtotal).toFixed(2)));
                        } else {
                          updateField("sgst", val);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 px-3 font-mono text-xs"
                      aria-label={
                        sgstMode === "percent"
                          ? "SGST entered as a percentage. Switch to a fixed amount."
                          : "SGST entered as a fixed amount. Switch to a percentage."
                      }
                      onClick={() => {
                        if (sgstMode === "amount") {
                          setSgstMode("percent");
                          const rate = totals.subtotal > 0
                            ? Number(((invoice.sgst / totals.subtotal) * 100).toFixed(2))
                            : 0;
                          setSgstRate(rate);
                        } else {
                          setSgstMode("amount");
                        }
                      }}
                    >
                      {sgstMode === "percent" ? "%" : "₹"}
                    </Button>
                  </div>
                  {sgstMode === "percent" ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      = {formatCurrency(invoice.sgst, invoice.currency)}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
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
                    <p className="text-xs tracking-[0.2em] uppercase text-slate-300">
                      Invoice
                    </p>
                    <p className="mt-1 text-xl font-semibold">
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
                    className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusClassName[invoice.status]}`}
                  >
                    {invoice.status}
                  </span>
                </div>
              </div>

              <div className="space-y-5 p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      Bill From
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {invoice.companyName || "Your Company"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">
                      {invoice.companyAddress || "Company address"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 dark:text-slate-400">
                      Bill To
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {invoice.billTo || "Client name"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600 dark:text-slate-300">
                      {invoice.billToAddress || "Client address"}
                    </p>
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

                <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                  <div className="grid grid-cols-[1.5fr_70px_100px] bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <div>Item</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Amount</div>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(previewItems.length ? previewItems : invoice.items).map((item, index) => (
                      <div
                        className="grid grid-cols-[1.5fr_70px_100px] px-3 py-2 text-sm"
                        key={`${item.description}-${index}`}
                      >
                        <div className="truncate text-slate-700 dark:text-slate-200">
                          {item.description || "Untitled item"}
                        </div>
                        <div className="text-right text-slate-500 dark:text-slate-300">
                          {item.quantity}
                        </div>
                        <div className="font-medium text-right text-slate-700 dark:text-slate-100">
                          {formatCurrency(item.quantity * item.unitPrice, invoice.currency)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {buildTotalsRows(totals).map((row) => (
                    <div
                      key={row.label}
                      className={
                        row.kind === "grand"
                          ? "flex items-center justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100"
                          : "flex items-center justify-between text-slate-600 dark:text-slate-300"
                      }
                    >
                      <span>{row.label}</span>
                      <span>
                        {row.kind === "discount" ? "- " : ""}
                        {formatCurrency(row.amount, invoice.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
