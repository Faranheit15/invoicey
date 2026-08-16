import { describe, it, expect } from "bun:test";
import {
  validateAssistantRequest,
  MAX_DRAFT_BYTES,
  DRAFT_TOO_LARGE_MESSAGE,
} from "@/lib/ai/invoice-assistant/service";
import { createDefaultInvoiceFormState } from "@/lib/invoices";

// The draft is serialized wholesale into the Gemini prompt, so its size is the
// per-request bill. These lock the cap that stops one POST from spending a
// megabyte of tokens on the owner's key.

const draftOfSize = (bytes: number) => {
  const draft = createDefaultInvoiceFormState();
  const overhead = JSON.stringify(draft).length;
  return { ...draft, notes: "x".repeat(Math.max(0, bytes - overhead)) };
};

const requestWith = (draft: unknown) => ({ message: "Bill Acme 5000", draft });

describe("validateAssistantRequest — draft size cap", () => {
  it("accepts an ordinary draft", () => {
    const request = validateAssistantRequest(
      requestWith(createDefaultInvoiceFormState())
    );
    expect(request.message).toBe("Bill Acme 5000");
  });

  it("accepts a draft sitting just under the cap", () => {
    expect(() =>
      validateAssistantRequest(requestWith(draftOfSize(MAX_DRAFT_BYTES - 10)))
    ).not.toThrow();
  });

  it("rejects a draft over the cap", () => {
    expect(() =>
      validateAssistantRequest(requestWith(draftOfSize(MAX_DRAFT_BYTES + 100)))
    ).toThrow(DRAFT_TOO_LARGE_MESSAGE);
  });

  it("rejects the megabyte payload the cap exists for", () => {
    const draft = { ...createDefaultInvoiceFormState(), notes: "x".repeat(1_000_000) };
    expect(() => validateAssistantRequest(requestWith(draft))).toThrow(
      DRAFT_TOO_LARGE_MESSAGE
    );
  });

  it("rejects a non-serializable draft rather than letting the provider 500", () => {
    const draft = createDefaultInvoiceFormState() as unknown as Record<
      string,
      unknown
    >;
    draft.self = draft;
    expect(() => validateAssistantRequest(requestWith(draft))).toThrow(
      DRAFT_TOO_LARGE_MESSAGE
    );
  });

  it("throws the exact message the route classifies as a 400", () => {
    // app/api/ai/invoice-assistant/route.ts matches on this same exported
    // constant, so the two cannot drift into an accidental 500.
    try {
      validateAssistantRequest(requestWith(draftOfSize(MAX_DRAFT_BYTES + 1)));
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).message).toBe(DRAFT_TOO_LARGE_MESSAGE);
    }
  });

  it("still rejects a missing draft with the original message", () => {
    expect(() => validateAssistantRequest({ message: "hi" })).toThrow(
      "Invoice draft context is required."
    );
  });
});

describe("validateAssistantRequest — conversation budget", () => {
  const draft = createDefaultInvoiceFormState();

  it("keeps a normal conversation intact", () => {
    const conversation = [
      { role: "user", content: "Bill Acme" },
      { role: "assistant", content: "What amount?" },
    ];
    const request = validateAssistantRequest({
      message: "5000",
      draft,
      conversation,
    });
    expect(request.conversation).toHaveLength(2);
  });

  it("drops the oldest turns when history exceeds the character budget", () => {
    const conversation = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}`.padEnd(4000, "x"),
    }));
    const request = validateAssistantRequest({
      message: "next",
      draft,
      conversation,
    });

    // 12 x 4000 chars would be ~48k of prompt per turn; the budget is 12k.
    expect(request.conversation.length).toBeLessThan(conversation.length);
    const chars = request.conversation.reduce(
      (total, entry) => total + entry.content.length,
      0
    );
    expect(chars).toBeLessThanOrEqual(12_000);
    // The most recent turn — the one the user is replying to — always survives.
    expect(request.conversation.at(-1)?.content.startsWith("11")).toBe(true);
  });
});
