"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { auth } from "@/lib/firebase";
import {
  CURRENCY_OPTIONS,
  InvoiceFormItem,
  InvoiceFormState,
  InvoiceRecord,
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

export default function InvoiceEditor({ mode, invoiceId }: InvoiceEditorProps) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceFormState>(
    createDefaultInvoiceFormState()
  );
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(mode === "edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const totals = useMemo(
    () =>
      calculateInvoiceTotals({
        items: invoice.items,
        discount: invoice.discount,
        tax: invoice.tax,
        convenienceCharge: invoice.convenienceCharge,
      }),
    [invoice]
  );

  useEffect(() => {
    if (mode !== "edit") {
      return;
    }

    const fetchInvoice = async () => {
      if (!invoiceId) {
        setError("Missing invoice id");
        setIsLoadingInvoice(false);
        return;
      }

      try {
        if (!auth.currentUser) {
          router.push("/auth");
          return;
        }

        const token = await auth.currentUser.getIdToken();
        const response = await fetch(
          `/api/invoices?id=${encodeURIComponent(invoiceId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = (await response.json()) as InvoiceRecord | { error: string };

        if (!response.ok) {
          setError(
            "error" in data
              ? data.error
              : "Unable to load invoice for editing."
          );
          return;
        }

        setInvoice(mapInvoiceRecordToFormState(data as InvoiceRecord));
      } catch {
        setError("Unable to load invoice for editing.");
      } finally {
        setIsLoadingInvoice(false);
      }
    };

    fetchInvoice();
  }, [invoiceId, mode, router]);

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
    setInvoice((prev) => ({
      ...prev,
      items: [...prev.items, { description: "", quantity: 1, unitPrice: 0 }],
    }));
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

  const saveInvoice = async (status: InvoiceStatus = invoice.status) => {
    setError("");

    if (!invoice.companyName.trim() || !invoice.billTo.trim()) {
      setError("Company name and bill-to name are required.");
      return;
    }

    if (!invoice.invoiceNumber.trim()) {
      setError("Invoice number is required.");
      return;
    }

    if (
      !invoice.invoiceDate ||
      !invoice.dueDate ||
      Number.isNaN(new Date(invoice.invoiceDate).getTime()) ||
      Number.isNaN(new Date(invoice.dueDate).getTime())
    ) {
      setError("Invoice and due dates are required.");
      return;
    }

    const validItems = invoice.items.filter((item) => item.description.trim());
    if (validItems.length === 0) {
      setError("Add at least one line item with a description.");
      return;
    }

    try {
      setIsSaving(true);

      if (!auth.currentUser) {
        router.push("/auth");
        return;
      }

      const token = await auth.currentUser.getIdToken();
      const payload = mapFormStateToPayload({
        ...invoice,
        status,
      });

      const endpoint =
        mode === "edit"
          ? `/api/invoices?id=${encodeURIComponent(invoiceId || "")}`
          : "/api/invoices";

      const response = await fetch(endpoint, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const payloadError = (await response.json()) as { error?: string };
        setError(payloadError.error || "Failed to save invoice.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Failed to save invoice.");
    } finally {
      setIsSaving(false);
    }
  };

  const previewItems = invoice.items.filter((item) => item.description.trim());

  if (isLoadingInvoice) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4 bg-slate-50">
        <Card className="w-full max-w-md border-slate-200">
          <CardContent className="flex items-center gap-3 p-6 text-slate-700">
            <ReloadIcon className="w-4 h-4 animate-spin" />
            Loading invoice...
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 bg-gradient-to-b from-slate-100 via-slate-50 to-white sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <button
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
              onClick={() => router.push("/dashboard")}
              type="button"
            >
              <ArrowLeftIcon className="w-4 h-4" />
              Back to dashboard
            </button>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">
              {mode === "edit" ? "Edit Invoice" : "Create Invoice"}
            </h1>
            <p className="text-sm text-slate-600">
              Build polished invoices with complete business and payment details.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => saveInvoice("draft")}
            >
              Save Draft
            </Button>
            <Button disabled={isSaving} onClick={() => saveInvoice("sent")}>
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

        {error ? (
          <div className="px-4 py-3 mb-4 text-sm border rounded-md border-rose-200 bg-rose-50 text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-xl text-slate-900">Invoice Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-7">
              <section className="space-y-3">
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Seller
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Company name"
                    value={invoice.companyName}
                    onChange={(event) => updateField("companyName", event.target.value)}
                  />
                  <Input
                    placeholder="Company email"
                    value={invoice.companyEmail}
                    onChange={(event) => updateField("companyEmail", event.target.value)}
                  />
                  <Input
                    placeholder="Company phone"
                    value={invoice.companyPhone}
                    onChange={(event) => updateField("companyPhone", event.target.value)}
                  />
                  <Input
                    placeholder="Company logo URL (optional)"
                    value={invoice.companyLogo}
                    onChange={(event) => updateField("companyLogo", event.target.value)}
                  />
                  <Textarea
                    placeholder="Company address"
                    className="sm:col-span-2"
                    value={invoice.companyAddress}
                    onChange={(event) => updateField("companyAddress", event.target.value)}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Client
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Client name"
                    value={invoice.billTo}
                    onChange={(event) => updateField("billTo", event.target.value)}
                  />
                  <Input
                    placeholder="Client email"
                    value={invoice.billToEmail}
                    onChange={(event) => updateField("billToEmail", event.target.value)}
                  />
                  <Textarea
                    placeholder="Client billing address"
                    className="sm:col-span-2"
                    value={invoice.billToAddress}
                    onChange={(event) => updateField("billToAddress", event.target.value)}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                  Meta
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    placeholder="Invoice number"
                    value={invoice.invoiceNumber}
                    onChange={(event) =>
                      updateField("invoiceNumber", event.target.value)
                    }
                  />
                  <Input
                    type="date"
                    value={invoice.invoiceDate}
                    onChange={(event) => updateField("invoiceDate", event.target.value)}
                  />
                  <Input
                    type="date"
                    value={invoice.dueDate}
                    onChange={(event) => updateField("dueDate", event.target.value)}
                  />
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={invoice.currency}
                    onChange={(event) => updateField("currency", event.target.value)}
                  >
                    {CURRENCY_OPTIONS.map((currencyCode) => (
                      <option key={currencyCode} value={currencyCode}>
                        {currencyCode}
                      </option>
                    ))}
                  </select>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={invoice.status}
                    onChange={(event) =>
                      updateField("status", event.target.value as InvoiceStatus)
                    }
                  >
                    <option value="draft">Draft</option>
                    <option value="sent">Sent</option>
                    <option value="paid">Paid</option>
                    <option value="overdue">Overdue</option>
                  </select>
                  <Input
                    placeholder="Payment terms"
                    value={invoice.terms}
                    onChange={(event) => updateField("terms", event.target.value)}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                    Line Items
                  </h2>
                  <Button size="sm" variant="outline" onClick={addItem}>
                    <PlusIcon className="w-4 h-4" />
                    Add Item
                  </Button>
                </div>
                <div className="overflow-x-auto border rounded-md border-slate-200">
                  <div className="grid min-w-[680px] grid-cols-[1.6fr_120px_150px_140px_44px] gap-2 bg-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <div>Description</div>
                    <div>Qty</div>
                    <div>Unit Price</div>
                    <div>Amount</div>
                    <div></div>
                  </div>
                  <div className="min-w-[680px] space-y-2 p-3">
                    {invoice.items.map((item, index) => (
                      <div
                        className="grid grid-cols-[1.6fr_120px_150px_140px_44px] items-center gap-2"
                        key={`${index}-${item.description}`}
                      >
                        <Input
                          placeholder="e.g. Monthly retainer"
                          value={item.description}
                          onChange={(event) =>
                            updateItem(index, "description", event.target.value)
                          }
                        />
                        <Input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, "quantity", Number(event.target.value) || 1)
                          }
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(event) =>
                            updateItem(
                              index,
                              "unitPrice",
                              Number(event.target.value) || 0
                            )
                          }
                        />
                        <div className="text-sm font-medium text-right text-slate-700">
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
                          <TrashIcon className="w-4 h-4 text-slate-500" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Discount"
                  value={invoice.discount}
                  onChange={(event) =>
                    updateField("discount", Number(event.target.value) || 0)
                  }
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Tax"
                  value={invoice.tax}
                  onChange={(event) => updateField("tax", Number(event.target.value) || 0)}
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Service charge"
                  value={invoice.convenienceCharge}
                  onChange={(event) =>
                    updateField("convenienceCharge", Number(event.target.value) || 0)
                  }
                />
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <Textarea
                  placeholder="Payment information"
                  value={invoice.paymentInfo}
                  onChange={(event) => updateField("paymentInfo", event.target.value)}
                />
                <Textarea
                  placeholder="Additional notes"
                  value={invoice.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </section>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm xl:sticky xl:top-24 xl:h-fit">
            <CardHeader className="pb-3 border-b border-slate-200">
              <CardTitle className="text-xl text-slate-900">Live Preview</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-5 border-b border-slate-200 bg-slate-900 text-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs tracking-[0.2em] uppercase text-slate-300">
                      Invoice
                    </p>
                    <p className="mt-1 text-xl font-semibold">
                      {invoice.invoiceNumber || "INV-XXXXXX"}
                    </p>
                  </div>
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
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                      Bill From
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {invoice.companyName || "Your Company"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600">
                      {invoice.companyAddress || "Company address"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                      Bill To
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      {invoice.billTo || "Client name"}
                    </p>
                    <p className="text-xs leading-relaxed whitespace-pre-line text-slate-600">
                      {invoice.billToAddress || "Client address"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 border rounded-md border-slate-200 bg-slate-50">
                    <p className="text-slate-500">Invoice Date</p>
                    <p className="font-medium text-slate-800">
                      {invoice.invoiceDate
                        ? formatDateLong(invoice.invoiceDate)
                        : "Select date"}
                    </p>
                  </div>
                  <div className="p-3 border rounded-md border-slate-200 bg-slate-50">
                    <p className="text-slate-500">Due Date</p>
                    <p className="font-medium text-slate-800">
                      {invoice.dueDate ? formatDateLong(invoice.dueDate) : "Select date"}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden border rounded-md border-slate-200">
                  <div className="grid grid-cols-[1.5fr_70px_100px] bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <div>Item</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Amount</div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {(previewItems.length ? previewItems : invoice.items).map((item, index) => (
                      <div
                        className="grid grid-cols-[1.5fr_70px_100px] px-3 py-2 text-sm"
                        key={`${item.description}-${index}`}
                      >
                        <div className="truncate text-slate-700">
                          {item.description || "Untitled item"}
                        </div>
                        <div className="text-right text-slate-500">{item.quantity}</div>
                        <div className="font-medium text-right text-slate-700">
                          {formatCurrency(item.quantity * item.unitPrice, invoice.currency)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Subtotal</span>
                    <span>{formatCurrency(totals.subtotal, invoice.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Discount</span>
                    <span>- {formatCurrency(totals.discount, invoice.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Tax</span>
                    <span>{formatCurrency(totals.tax, invoice.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Service Charge</span>
                    <span>{formatCurrency(totals.convenienceCharge, invoice.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 text-base font-semibold border-t border-slate-200 text-slate-900">
                    <span>Total</span>
                    <span>{formatCurrency(totals.total, invoice.currency)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
