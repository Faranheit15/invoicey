import { describe, it, expect } from "bun:test";
import {
  parseAssistantJsonPayload,
  normalizeAssistantResponse,
} from "@/lib/ai/invoice-assistant/normalization";
import { applyInvoiceAssistantPatch } from "@/lib/ai/invoice-assistant/apply-patch";
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
  it("accepts cgst and sgst", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { cgst: 9.005, sgst: 9 },
    });
    expect(res.patch.cgst).toBe(9.01);
    expect(res.patch.sgst).toBe(9);
  });

  it("drops an unknown legacy `tax` field", () => {
    const res = normalizeAssistantResponse({
      resolution: "ready",
      patch: { tax: 18 },
    });
    expect("tax" in res.patch).toBe(false);
    expect(res.patch.cgst).toBeUndefined();
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

describe("applyInvoiceAssistantPatch", () => {
  it("merges only known fields and reports applied field names", () => {
    const base = createDefaultInvoiceFormState();
    const { nextState, appliedFields } = applyInvoiceAssistantPatch(base, {
      companyName: "Acme",
      cgst: 5,
      sgst: 5,
    });
    expect(nextState.companyName).toBe("Acme");
    expect(nextState.cgst).toBe(5);
    expect(nextState.sgst).toBe(5);
    expect(appliedFields).toEqual(
      expect.arrayContaining(["companyName", "cgst", "sgst"])
    );
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
