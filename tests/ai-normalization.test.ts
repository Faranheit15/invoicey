import { describe, it, expect } from "bun:test";
import {
  parseAssistantJsonPayload,
  normalizeAssistantResponse,
} from "@/lib/ai/invoice-assistant/normalization";
import { applyInvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/apply-patch";
import { INVOICE_ASSISTANT_SYSTEM_PROMPT } from "@/lib/ai/invoice-assistant/prompt";
import { createDefaultInvoiceFormState } from "@/lib/invoices";

describe("parseAssistantJsonPayload", () => {
  it("parses plain JSON", () => {
    expect(parseAssistantJsonPayload('{"resolution":"ready"}')).toEqual({
      resolution: "ready",
    });
  });

  it("strips ```json fences", () => {
    const raw = '```json\n{"resolution":"ready"}\n```';
    expect(parseAssistantJsonPayload(raw)).toEqual({ resolution: "ready" });
  });

  it("throws on empty input", () => {
    expect(() => parseAssistantJsonPayload("   ")).toThrow();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseAssistantJsonPayload("not json {")).toThrow();
  });
});

describe("normalizeAssistantResponse — patch field handling", () => {
  // Phase 2: tax is per line and DERIVED. The assistant may no longer emit tax
  // amounts at all — an even CGST/SGST split (what the old prompt asked for) is
  // right for an intra-State supply and silently wrong for an inter-State one.
  it("ignores cgst and sgst entirely — they are not fields any more", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { cgst: 500, sgst: 500 },
    });
    expect("cgst" in res.patch).toBe(false);
    expect("sgst" in res.patch).toBe(false);
    expect(Object.keys(res.patch)).toEqual([]);
  });

  it("drops an unknown legacy `tax` field", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { tax: 18 },
    });
    expect("tax" in res.patch).toBe(false);
  });

  it("refuses to let the model claim a tax treatment", () => {
    // Registration status comes from the GSTIN on the business profile. A model
    // that could set this could head an unregistered person's document
    // "TAX INVOICE".
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { taxTreatment: "gst", companyGstin: "29AAGCB7383J1Z4" },
    });
    expect("taxTreatment" in res.patch).toBe(false);
    expect("companyGstin" in res.patch).toBe(false);
  });

  it("clamps negative amounts to 0 and enforces quantity >= 1", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: {
        discount: -50,
        items: [{ description: "A", quantity: -3, unitPrice: -10 }],
      },
    });
    expect(res.patch.discount).toBe(0);
    expect(res.patch.items?.[0]).toEqual({
      description: "A",
      quantity: 1,
      unitPrice: 0,
    });
  });

  it("caps item count at 40", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `Item ${i}`,
      quantity: 1,
      unitPrice: 1,
    }));
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { items: many },
    });
    expect(res.patch.items?.length).toBe(40);
  });

  it("upgrades resolution to needs_clarification when questions exist", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      clarifyingQuestions: ["What currency?"],
    });
    expect(res.resolution).toBe("needs_clarification");
  });
});

describe("normalizeAssistantResponse — the invoice number", () => {
  it("drops a model-invented number that breaks Rule 46(b)", () => {
    // The draft already carries the number the server suggested. A patch
    // carrying "INV #2026/0001" would land in form state and then block the
    // save it was supposed to speed up.
    for (const invalid of ["INV #2026/0001", "INVOICE/2026-27/0001", "INV_001"]) {
      const res = normalizeAssistantResponse({
        resolution: "ready",
        patch: { invoiceNumber: invalid },
      });
      expect(res.patch.invoiceNumber).toBeUndefined();
    }
  });

  it("keeps a legal one, with its whitespace normalised away", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { invoiceNumber: " INV/2026-27/008 " },
    });
    expect(res.patch.invoiceNumber).toBe("INV/2026-27/008");
  });
});

describe("applyInvoiceAssistantPatch", () => {
  it("merges only known fields and reports applied field names", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState, appliedFields } = applyInvoiceAssistantPatch(base, {
      companyName: "Acme",
      discount: 5,
    });
    expect(nextState.companyName).toBe("Acme");
    expect(nextState.discount).toBe(5);
    expect(appliedFields).toEqual(
      expect.arrayContaining(["companyName", "discount"])
    );
  });

  it("never applies a tax amount, even if one is forced into the patch", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState, appliedFields } = applyInvoiceAssistantPatch(base, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ cgst: 500, sgst: 500, taxTreatment: "gst" } as any),
    });
    expect(nextState.cgst).toBe(0);
    expect(nextState.sgst).toBe(0);
    expect(nextState.taxTreatment).toBe("none");
    expect(appliedFields).toEqual([]);
  });

  it("ignores prototype-polluting keys (only explicit fields are applied)", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState } = applyInvoiceAssistantPatch(base, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { __proto__: { polluted: true } } as any ),
      companyName: "Safe",
    });
    expect(nextState.companyName).toBe("Safe");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 2: the per-line GST contract                                          */
/* -------------------------------------------------------------------------- */

describe("normalizeAssistantResponse — per-line GST fields", () => {
  const itemPatch = (item: Record<string, unknown>) =>
    normalizeAssistantResponse({
      resolution: "ready",
      patch: {
        items: [{ description: "Consulting", quantity: 1, unitPrice: 100, ...item }],
      },
    }).patch.items?.[0] as Record<string, unknown> | undefined;

  it("keeps a live slab rate", () => {
    expect(itemPatch({ taxRatePercent: 18 })?.taxRatePercent).toBe(18);
    expect(itemPatch({ taxRatePercent: 40 })?.taxRatePercent).toBe(40);
    expect(itemPatch({ taxRatePercent: 0.25 })?.taxRatePercent).toBe(0.25);
  });

  it("keeps a RETIRED rate — 12% is real, just withdrawn", () => {
    // A back-dated invoice legitimately carries it; validateInvoice warns.
    expect(itemPatch({ taxRatePercent: 12 })?.taxRatePercent).toBe(12);
    expect(itemPatch({ taxRatePercent: 28 })?.taxRatePercent).toBe(28);
  });

  it("drops a hallucinated rate rather than clamping it into range", () => {
    // 15% is not a rate that needs bringing into range; it does not exist.
    expect("taxRatePercent" in (itemPatch({ taxRatePercent: 15 }) ?? {})).toBe(false);
    expect("taxRatePercent" in (itemPatch({ taxRatePercent: 8.5 }) ?? {})).toBe(false);
    expect("taxRatePercent" in (itemPatch({ taxRatePercent: "eighteen" }) ?? {})).toBe(
      false
    );
  });

  it("keeps a well-formed HSN/SAC and drops a malformed one", () => {
    expect(itemPatch({ hsnSac: "998314" })?.hsnSac).toBe("998314");
    expect(itemPatch({ hsnSac: "8471" })?.hsnSac).toBe("8471");
    expect(itemPatch({ hsnSac: "84713010" })?.hsnSac).toBe("84713010");
    expect("hsnSac" in (itemPatch({ hsnSac: "99A314" }) ?? {})).toBe(false);
    expect("hsnSac" in (itemPatch({ hsnSac: "99831" }) ?? {})).toBe(false);
  });

  it("upper-cases and caps a UQC, and leaves it absent when blank", () => {
    expect(itemPatch({ unit: "hrs" })?.unit).toBe("HRS");
    expect("unit" in (itemPatch({ unit: "   " }) ?? {})).toBe(false);
  });

  it("leaves every new per-line field ABSENT when the model omits it", () => {
    const item = itemPatch({}) ?? {};
    expect("hsnSac" in item).toBe(false);
    expect("unit" in item).toBe(false);
    expect("taxRatePercent" in item).toBe(false);
    expect("discount" in item).toBe(false);
  });
});

describe("normalizeAssistantResponse — place of supply", () => {
  const posPatch = (value: unknown) =>
    normalizeAssistantResponse({
      resolution: "ready",
      patch: { placeOfSupplyStateCode: value },
    }).patch;

  it("accepts a real state code and derives the printed label itself", () => {
    expect(posPatch("27").placeOfSupplyStateCode).toBe("27");
    expect(posPatch("27").placeOfSupplyLabel).toBe("Maharashtra");
  });

  it("accepts the outside-India sentinel and never prints the bare code", () => {
    expect(posPatch("96").placeOfSupplyStateCode).toBe("96");
    expect(posPatch("96").placeOfSupplyLabel).toBe("Outside India");
  });

  it("drops a state code that is not a state", () => {
    expect("placeOfSupplyStateCode" in posPatch("88")).toBe(false);
    expect("placeOfSupplyStateCode" in posPatch("Maharashtra")).toBe(false);
    expect("placeOfSupplyStateCode" in posPatch(27)).toBe(false);
  });

  it("never takes a model-supplied place label", () => {
    const patch = normalizeAssistantResponse({
      resolution: "ready",
      patch: {
        placeOfSupplyStateCode: "27",
        placeOfSupplyLabel: "<script>alert(1)</script>",
      },
    }).patch;
    expect(patch.placeOfSupplyLabel).toBe("Maharashtra");
  });
});

describe("applyInvoiceAssistantPatch — the same rules client-side", () => {
  it("drops a hallucinated rate and a malformed HSN/SAC on the client too", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState } = applyInvoiceAssistantPatch(base, {
      items: [
        { description: "A", quantity: 1, unitPrice: 10, taxRatePercent: 15, hsnSac: "9X" },
        { description: "B", quantity: 1, unitPrice: 10, taxRatePercent: 18, hsnSac: "998314" },
      ],
    });
    expect("taxRatePercent" in nextState.items[0]).toBe(false);
    expect("hsnSac" in nextState.items[0]).toBe(false);
    expect(nextState.items[1].taxRatePercent).toBe(18);
    expect(nextState.items[1].hsnSac).toBe("998314");
  });

  it("sets the place of supply, its label and the overridden flag together", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState, appliedFields } = applyInvoiceAssistantPatch(base, {
      placeOfSupplyStateCode: "29",
    });
    expect(nextState.placeOfSupplyStateCode).toBe("29");
    expect(nextState.placeOfSupplyLabel).toBe("Karnataka");
    expect(nextState.placeOfSupplyOverridden).toBe(true);
    expect(appliedFields).toContain("placeOfSupplyStateCode");
  });
});

describe("the AI contract stays identical across the four files", () => {
  it("advertises every per-line field the normalizer accepts, and no tax amount", () => {
    for (const field of ["taxRatePercent", "hsnSac", "unit", "placeOfSupplyStateCode"]) {
      expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).toContain(field);
    }
    // The old rule 11 told the model to split a single "tax" evenly between
    // cgst and sgst. That is correct intra-State and silently wrong
    // inter-State, so both the rule and the fields are gone.
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).not.toContain('"cgst"?: number');
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).not.toContain('"sgst"?: number');
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).toContain("Never invent a GSTIN");
  });
});

describe("the client's GSTIN is the one identity field the model may set", () => {
  const CLIENT_GSTIN = "29AAGCB7383J1Z4";

  it("accepts a valid client GSTIN and normalizes the paste", () => {
    const result = normalizeAssistantResponse({
      resolution: "ready",
      patch: { billToGstin: " 29aagcb7383j 1z4 " },
    });
    expect(result.patch.billToGstin).toBe(CLIENT_GSTIN);
  });

  it("DROPS one that fails the checksum rather than passing it through", () => {
    // A hallucinated GSTIN is worse than none: it costs the recipient their
    // input tax credit. The check digit is what makes accepting this field safe.
    const result = normalizeAssistantResponse({
      resolution: "ready",
      patch: { billToGstin: "29AAGCB7383J1Z9" },
    });
    expect(result.patch.billToGstin).toBeUndefined();
  });

  it("still ignores the supplier's own GSTIN and any registration status", () => {
    const result = normalizeAssistantResponse({
      resolution: "ready",
      patch: {
        companyGstin: "27AAPFU0939F1ZV",
        taxTreatment: "gst",
        billToGstin: CLIENT_GSTIN,
      },
    });
    expect(result.patch).toEqual({ billToGstin: CLIENT_GSTIN });
  });

  it("applies the same two rules client-side", () => {
    const base = createDefaultInvoiceFormState();
    const applied = applyInvoiceAssistantPatch(base, {
      billToGstin: "29aagcb7383j1z4",
    });
    expect(applied.nextState.billToGstin).toBe(CLIENT_GSTIN);
    expect(applied.appliedFields).toContain("billToGstin");

    const dropped = applyInvoiceAssistantPatch(base, {
      billToGstin: "not-a-gstin",
    });
    expect(dropped.nextState.billToGstin).toBe("");
    expect(dropped.appliedFields).not.toContain("billToGstin");
  });

  it("is advertised in the prompt, with the never-invent rule", () => {
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).toContain('"billToGstin"?: string');
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).toContain(
      "Only echo a GSTIN the user typed"
    );
    // The supplier's own GSTIN stays out of the contract entirely.
    expect(INVOICE_ASSISTANT_SYSTEM_PROMPT).not.toContain('"companyGstin"');
  });
});
