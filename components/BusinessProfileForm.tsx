"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/select-field";
import { NumericInput } from "@/components/ui/numeric-input";
import { Switch } from "@/components/ui/switch";
import type { BusinessProfile } from "@/lib/api-client";
import {
  GST_STATE_CODES,
  GST_STATE_PICKER_CODES,
  isValidGstin,
  normalizeGstin,
  panFromGstin,
  stateCodeFromGstin,
} from "@/lib/gstin";
import { CURRENCY_OPTIONS } from "@/lib/invoices";

const MAX_DUE_DAYS = 365;

const STATE_OPTIONS = [
  { value: "", label: "Not set" },
  ...GST_STATE_PICKER_CODES.map((code) => ({
    value: code,
    label: `${code} — ${GST_STATE_CODES[code]}`,
  })),
];

interface BusinessProfileFormProps {
  initial: BusinessProfile;
  isSaving: boolean;
  onSave: (profile: BusinessProfile) => void;
}

/**
 * Edit the details that never change between invoices.
 *
 * The whole point of the page is that this is the LAST time the user types any
 * of it, so the form is deliberately unhurried: nothing is required, nothing
 * blocks a save, and the two things that can be wrong rather than merely empty
 * — the GSTIN and the due-day count — are the only things it argues with.
 *
 * GSTIN is the anchor. A valid one carries the state code and the PAN inside
 * it, so both of those fields become derived and read-only the moment it
 * validates: a user cannot claim a state their registration contradicts, and
 * nobody ever types a PAN. The server re-derives both — this is convenience,
 * not the check.
 */
export function BusinessProfileForm({
  initial,
  isSaving,
  onSave,
}: BusinessProfileFormProps) {
  const [form, setForm] = useState<BusinessProfile>(initial);

  const update = useCallback(
    <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) => {
      setForm((previous) => ({ ...previous, [key]: value }));
    },
    []
  );

  const gstin = normalizeGstin(form.companyGstin);
  const gstinIsValid = isValidGstin(gstin);
  const gstinError =
    gstin.length > 0 && !gstinIsValid
      ? "That doesn't look like a valid GSTIN. Check the 15 characters."
      : "";

  // Derived-from-GSTIN values shown live, so the user sees the app read their
  // registration back to them before they save.
  const derivedStateCode = gstinIsValid ? stateCodeFromGstin(gstin) : "";
  const derivedPan = gstinIsValid ? panFromGstin(gstin) : "";
  const effectiveStateCode = derivedStateCode || form.supplierStateCode;

  const isComposition = form.taxTreatment === "composition";

  const currencyOptions = useMemo(
    () => CURRENCY_OPTIONS.map((code) => ({ value: code, label: code })),
    []
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      ...form,
      companyGstin: gstin,
      supplierStateCode: effectiveStateCode,
      companyPan: derivedPan || form.companyPan,
      // "none" whenever there is no GSTIN: an unregistered person's document
      // must never be headed TAX INVOICE, and the server enforces the same.
      taxTreatment: gstinIsValid ? (isComposition ? "composition" : "gst") : "none",
    });
  };

  const cardClass =
    "border-slate-200 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-slate-900/75";
  const titleClass = "text-lg text-slate-900 dark:text-white";
  const helpClass =
    "max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300";

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className={titleClass}>Your business</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={helpClass}>
            This is the &ldquo;from&rdquo; block at the top of every invoice you
            create from now on.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name">
              {(control) => (
                <Input
                  {...control}
                  value={form.companyName}
                  onChange={(event) => update("companyName", event.target.value)}
                  placeholder="Acme Consulting"
                />
              )}
            </Field>
            <Field label="Email" optional>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  value={form.companyEmail}
                  onChange={(event) => update("companyEmail", event.target.value)}
                  placeholder="billing@acme.in"
                />
              )}
            </Field>
            <Field label="Phone" optional>
              {(control) => (
                <Input
                  {...control}
                  value={form.companyPhone}
                  onChange={(event) => update("companyPhone", event.target.value)}
                  placeholder="+91 98765 43210"
                />
              )}
            </Field>
            <Field
              label="Logo URL"
              optional
              hint="An https:// link to your logo image."
            >
              {(control) => (
                <Input
                  {...control}
                  value={form.companyLogo}
                  onChange={(event) => update("companyLogo", event.target.value)}
                  placeholder="https://…/logo.png"
                />
              )}
            </Field>
          </div>
          <Field label="Address" optional>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={form.companyAddress}
                onChange={(event) => update("companyAddress", event.target.value)}
                placeholder={"12 MG Road\nBengaluru 560001"}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className={titleClass}>GST details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={helpClass}>
            Leave the GSTIN empty if you are not registered — most people
            aren&rsquo;t, and an invoice without GST is a perfectly ordinary
            invoice. Fill it in and your invoices become tax invoices.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="GSTIN"
              optional
              hint={
                gstinError ? (
                  <span className="text-rose-600 dark:text-rose-300">
                    {gstinError}
                  </span>
                ) : (
                  "15 characters. Your state and PAN are read from it."
                )
              }
            >
              {(control) => (
                <Input
                  {...control}
                  value={form.companyGstin}
                  onChange={(event) =>
                    update("companyGstin", event.target.value.toUpperCase())
                  }
                  aria-invalid={gstinError ? true : undefined}
                  placeholder="29AAGCB7383J1Z4"
                  className={
                    gstinError
                      ? "border-rose-400 dark:border-rose-400/60"
                      : undefined
                  }
                />
              )}
            </Field>
            <Field
              label="PAN"
              optional
              hint={
                derivedPan
                  ? "Taken from your GSTIN."
                  : "Only needed if you have no GSTIN."
              }
            >
              {(control) => (
                <Input
                  {...control}
                  value={derivedPan || form.companyPan}
                  onChange={(event) =>
                    update("companyPan", event.target.value.toUpperCase())
                  }
                  readOnly={Boolean(derivedPan)}
                  placeholder="AAGCB7383J"
                />
              )}
            </Field>
            <Field
              label="State of registration"
              optional
              hint={
                derivedStateCode
                  ? "Taken from the first two digits of your GSTIN."
                  : "Used to work out whether a supply is intra- or inter-state."
              }
            >
              {(control, labelId) => (
                <SelectField
                  id={control.id}
                  aria-labelledby={`${labelId} ${control.id}`}
                  aria-describedby={control["aria-describedby"]}
                  value={effectiveStateCode}
                  onValueChange={(value) => update("supplierStateCode", value)}
                  options={STATE_OPTIONS}
                  disabled={Boolean(derivedStateCode)}
                  placeholder="Not set"
                />
              )}
            </Field>
            <Field
              label="LUT ARN"
              optional
              hint="Only for zero-rated exports made without payment of tax."
            >
              {(control) => (
                <Input
                  {...control}
                  value={form.lutArn}
                  onChange={(event) =>
                    update("lutArn", event.target.value.toUpperCase())
                  }
                  placeholder="AD290324000000X"
                />
              )}
            </Field>
          </div>

          {/* Composition cannot be derived: a composition dealer holds an
              ordinary GSTIN. It is the one registration question worth asking,
              and only once a GSTIN exists to qualify. */}
          {gstinIsValid ? (
            <div className="flex items-start justify-between gap-4 rounded-md border border-slate-200 px-4 py-3 dark:border-white/10">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  I&rsquo;m registered under the composition scheme
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  Composition dealers may not collect tax. Your documents will
                  be headed &ldquo;Bill of Supply&rdquo; instead of &ldquo;Tax
                  Invoice&rdquo;.
                </p>
              </div>
              <Switch
                checked={isComposition}
                onCheckedChange={(checked) =>
                  update("taxTreatment", checked ? "composition" : "gst")
                }
                aria-label="Registered under the composition scheme"
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className={titleClass}>Invoice defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={helpClass}>
            Starting values for a new invoice. You can still change any of them
            on the invoice itself.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Currency">
              {(control, labelId) => (
                <SelectField
                  id={control.id}
                  aria-labelledby={`${labelId} ${control.id}`}
                  value={form.defaultCurrency}
                  onValueChange={(value) => update("defaultCurrency", value)}
                  options={currencyOptions}
                />
              )}
            </Field>
            <Field
              label="Payment due in (days)"
              hint="0 means due on the invoice date."
            >
              {(control) => (
                <NumericInput
                  {...control}
                  value={form.defaultDueDays}
                  onValueChange={(value) => update("defaultDueDays", value)}
                  min={0}
                  max={MAX_DUE_DAYS}
                  decimals={0}
                />
              )}
            </Field>
          </div>
          <Field label="Default terms" optional>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                value={form.defaultTerms}
                onChange={(event) => update("defaultTerms", event.target.value)}
                placeholder="Payment due within 14 days."
              />
            )}
          </Field>
          <Field
            label="Default payment details"
            optional
            hint="Bank account, UPI ID, or however you'd like to be paid."
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                value={form.defaultPaymentInfo}
                onChange={(event) =>
                  update("defaultPaymentInfo", event.target.value)
                }
                placeholder={"Acme Consulting\nA/C 0000 0000 0000\nIFSC HDFC0000123"}
              />
            )}
          </Field>
          <Field
            label="Invoice number pattern"
            optional
            hint="e.g. INV/{FY}/{SEQ:3} produces INV/2026-27/001. Leave empty to keep numbering by hand."
          >
            {(control) => (
              <Input
                {...control}
                value={form.invoiceNumberPattern}
                onChange={(event) =>
                  update("invoiceNumberPattern", event.target.value)
                }
                placeholder="INV/{FY}/{SEQ:3}"
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card className={cardClass}>
        <CardHeader className="pb-2">
          <CardTitle className={titleClass}>Signature</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Signed by" optional>
              {(control) => (
                <Input
                  {...control}
                  value={form.signatureLabel}
                  onChange={(event) =>
                    update("signatureLabel", event.target.value)
                  }
                  placeholder="For Acme Consulting"
                />
              )}
            </Field>
            <Field label="Signature image URL" optional>
              {(control) => (
                <Input
                  {...control}
                  value={form.signatureImageUrl}
                  onChange={(event) =>
                    update("signatureImageUrl", event.target.value)
                  }
                  placeholder="https://…/signature.png"
                />
              )}
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isSaving || Boolean(gstinError)}>
          {isSaving ? "Saving…" : "Save profile"}
        </Button>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Applies to new invoices. Existing invoices are left exactly as they
          are.
        </p>
      </div>
    </form>
  );
}
