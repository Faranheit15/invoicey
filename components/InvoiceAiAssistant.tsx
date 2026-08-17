"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner, LiveStatus } from "@/components/ui/alert-banner";
import type {
  AssistantConversationEntry,
  InvoiceAssistantPatch,
  InvoiceAssistantResponse,
} from "@/lib/ai/invoice-assistant/contracts";
import type { InvoiceFormState } from "@/lib/invoices";
import {
  ChatBubbleIcon,
  ClipboardIcon,
  LightningBoltIcon,
  MagicWandIcon,
  PaperPlaneIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";

const QUICK_PROMPTS = [
  "Web development for TechCorp, 40 hours at $120/hr, plus $500 for cloud hosting, due in 30 days, USD.",
  "Monthly social media management retainer for BrightLabs, $900, include 10% tax, payment due in 15 days.",
  "UI audit for Nova Health, 12 hours at 85 EUR/hour, invoice date today, due in 14 days.",
];

/**
 * Two ways in, and the second one is the smaller ask.
 *
 * "Describe" wants the user to COMPOSE a sentence about work they have already
 * done. "Paste" wants them to COPY the mail the client already sent. Copying is
 * a much smaller thing to ask of someone at the end of a billing cycle, and it
 * is the one AI capability this market asked for out loud.
 *
 * Both paths hit the same endpoint, the same normalizer and the same review
 * step — the assistant still writes nothing but in-memory form state.
 */
const SAMPLE_PASTES = [
  `Hi, please raise the invoice for the March work — 18 hours of backend consulting at Rs 2,500/hr plus the one-time setup of Rs 8,000. GST 18%. We're in Bengaluru. Payment in 15 days as usual.\n\nThanks,\nPriya`,
  "Bhai invoice bana do — Sharma Traders ke liye, logo design ka 25 hazaar, aur website ka 40 hazaar. 18% GST lagana. Payment 30 din me.",
];

const MAX_CONVERSATION_ENTRIES = 12;
const MAX_PROMPT_LENGTH = 4000;
/** Mirrors MAX_PASTED_TEXT_LENGTH in lib/ai/invoice-assistant/service.ts. */
const MAX_PASTE_LENGTH = 8000;

type AssistantInputMode = "describe" | "paste";

interface InvoiceAiAssistantProps {
  invoice: InvoiceFormState;
  getAuthToken: () => Promise<string | null>;
  onApplyPatch: (patch: InvoiceAssistantPatch) => string[];
}

export default function InvoiceAiAssistant({
  invoice,
  getAuthToken,
  onApplyPatch,
}: InvoiceAiAssistantProps) {
  const [inputMode, setInputMode] = useState<AssistantInputMode>("describe");
  const [prompt, setPrompt] = useState("");
  const [conversation, setConversation] = useState<AssistantConversationEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  // Kept so a failed request can be retried verbatim; the input is cleared on
  // submit, so without this the user would have to retype their description.
  const [lastPrompt, setLastPrompt] = useState("");
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [appliedFields, setAppliedFields] = useState<string[]>([]);

  const promptLength = useMemo(() => prompt.trim().length, [prompt]);
  const isPasteMode = inputMode === "paste";
  const maxLength = isPasteMode ? MAX_PASTE_LENGTH : MAX_PROMPT_LENGTH;

  const submitPrompt = async (value?: string) => {
    const message = (value || prompt).trim();
    if (!message || isGenerating) {
      return;
    }

    if (message.length > maxLength) {
      setAssistantError(
        `That is ${message.length.toLocaleString()} characters. Trim it to about ${maxLength.toLocaleString()} — the part describing the work is usually enough.`
      );
      return;
    }

    setAssistantError("");
    setLastPrompt(message);
    const userMessage: AssistantConversationEntry = {
      role: "user",
      content: message,
    };

    const updatedConversation = [...conversation, userMessage].slice(
      -MAX_CONVERSATION_ENTRIES
    );

    setConversation(updatedConversation);
    setPrompt("");

    try {
      setIsGenerating(true);

      const token = await getAuthToken();
      if (!token) {
        setConversation((prev) => prev.filter((entry) => entry !== userMessage));
        return;
      }

      const response = await fetch("/api/ai/invoice-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          // PRIOR turns only. The prompt renders history and the latest message
          // as separate sections, so sending `updatedConversation` here shipped
          // this turn's text twice — invisible at 40 characters of description,
          // an extra 4,000 characters of billed prompt when the turn is a
          // pasted email.
          conversation,
          draft: invoice,
          // The server fences a paste as data and gives it its own size cap;
          // it defaults to "prompt" if this is ever missing.
          source: isPasteMode ? "paste" : "prompt",
        }),
        // The model call is slower than a normal request but must not hang.
        signal: AbortSignal.timeout(60_000),
      });

      const data = (await response.json().catch(() => ({}))) as
        | InvoiceAssistantResponse
        | { error?: string; details?: string };

      if (!response.ok) {
        const errorMessage =
          "error" in data && data.error
            ? data.error
            : "Unable to process your invoice request right now.";
        setAssistantError(errorMessage);
        return;
      }

      const assistantData = data as InvoiceAssistantResponse;
      const patchedFields = onApplyPatch(assistantData.patch);

      setClarifyingQuestions(assistantData.clarifyingQuestions || []);
      setMissingFields(assistantData.missingFields || []);
      setAppliedFields(patchedFields);

      const assistantMessage: AssistantConversationEntry = {
        role: "assistant",
        content: assistantData.assistantMessage,
      };

      setConversation((prev) => [...prev, assistantMessage].slice(-MAX_CONVERSATION_ENTRIES));
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        setAssistantError(
          "The assistant took too long to answer. Your description is kept below — try again, or fill the form yourself."
        );
      } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setAssistantError(
          "You appear to be offline. The assistant needs a connection; the form below still works."
        );
      } else {
        setAssistantError("The assistant couldn't answer that one. Try rephrasing it.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="relative overflow-hidden border-sky-200/70 bg-gradient-to-br from-sky-50 via-cyan-50/70 to-white shadow-sm dark:border-sky-500/30 dark:from-sky-950/40 dark:via-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(14,165,233,0.18),transparent_45%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_45%)]" />
      <CardHeader className="relative border-b border-sky-200/60 pb-4 dark:border-sky-700/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-slate-100">
            <MagicWandIcon className="h-5 w-5 text-sky-600 dark:text-sky-300" />
            AI Invoice Assistant
          </CardTitle>
          <span className="inline-flex items-center rounded-full border border-sky-200/80 bg-white/80 px-2.5 py-1 text-xs font-semibold text-sky-700 backdrop-blur dark:border-sky-400/40 dark:bg-sky-500/10 dark:text-sky-200">
            Free Beta
          </span>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {isPasteMode
            ? "Paste the client's email, WhatsApp message or scope note — Hindi and Hinglish are fine — and I'll pull the invoice out of it."
            : "Describe your invoice in natural language and I'll fill the form below."}
        </p>
      </CardHeader>

      <CardContent className="relative space-y-4 p-5">
        {/* Two inputs, one endpoint. The tab only changes what the user is
            asked to supply — composed prose, or somebody else's text. */}
        <div
          role="tablist"
          aria-label="Assistant input"
          className="inline-flex rounded-lg border border-sky-200/80 bg-white/70 p-1 dark:border-sky-700/60 dark:bg-slate-900/60"
        >
          {(
            [
              { id: "describe", label: "Describe it", icon: MagicWandIcon },
              { id: "paste", label: "Paste an email", icon: ClipboardIcon },
            ] as const
          ).map((tab) => {
            const TabIcon = tab.icon;
            const isActive = inputMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setInputMode(tab.id);
                  setAssistantError("");
                }}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-2">
          <label
            htmlFor="invoice-ai-prompt"
            className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
          >
            {isPasteMode ? "Pasted text" : "Prompt"}
          </label>
          <Textarea
            id="invoice-ai-prompt"
            placeholder={
              isPasteMode
                ? "Paste the client's mail or message here. Example: “Please invoice 18 hours of backend consulting at Rs 2,500/hr plus Rs 8,000 setup, 18% GST, we're in Bengaluru, payment in 15 days.”"
                : "Example: Web development for TechCorp, 40 hours at $120/hr, plus $500 for cloud hosting, due in 30 days, USD."
            }
            value={prompt}
            maxLength={maxLength}
            onChange={(event) => setPrompt(event.target.value)}
            className={`border-sky-200/80 bg-white/85 text-slate-800 shadow-sm focus-visible:ring-sky-500 dark:border-sky-700/60 dark:bg-slate-900/70 dark:text-slate-100 ${
              isPasteMode ? "min-h-[184px]" : "min-h-[112px]"
            }`}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {promptLength}/{maxLength}
            </span>
            <Button
              type="button"
              disabled={isGenerating || !prompt.trim()}
              onClick={() => submitPrompt()}
              className="bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
            >
              {isGenerating ? (
                <>
                  <ReloadIcon className="h-4 w-4 animate-spin" />
                  {isPasteMode ? "Reading…" : "Generating…"}
                </>
              ) : (
                <>
                  <PaperPlaneIcon className="h-4 w-4" />
                  {isPasteMode ? "Extract Invoice" : "Fill Invoice"}
                </>
              )}
            </Button>
          </div>
          {isPasteMode ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Nothing is saved until you review the form and press Create
              Invoice.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {(isPasteMode ? SAMPLE_PASTES : QUICK_PROMPTS).map(
            (example, index) => (
              <button
                key={`example-${inputMode}-${index}`}
                type="button"
                disabled={isGenerating}
                onClick={() => submitPrompt(example)}
                className="max-w-full rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-left text-xs text-slate-700 transition hover:border-sky-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-sky-500"
              >
                <span className="line-clamp-2">
                  {isPasteMode ? `Try: ${example}` : example}
                </span>
              </button>
            )
          )}
        </div>

        <LiveStatus>
          {isGenerating
            ? isPasteMode
              ? "Reading the pasted text…"
              : "Reading your description…"
            : appliedFields.length
              ? `Filled ${appliedFields.length} field${appliedFields.length > 1 ? "s" : ""}.`
              : ""}
        </LiveStatus>

        {assistantError ? (
          <AlertBanner onRetry={lastPrompt ? () => submitPrompt(lastPrompt) : undefined}>
            {assistantError}
          </AlertBanner>
        ) : null}

        {conversation.length ? (
          <div className="space-y-2 rounded-md border border-sky-200/70 bg-white/80 p-3 dark:border-sky-700/50 dark:bg-slate-900/60">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-300">
              <ChatBubbleIcon className="h-4 w-4" />
              Conversation
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {conversation.slice(-8).map((entry, index) => {
                const isUser = entry.role === "user";
                return (
                  <div
                    key={`${entry.role}-${index}-${entry.content.slice(0, 12)}`}
                    className={`rounded-md px-3 py-2 text-sm ${
                      isUser
                        ? "ml-6 bg-slate-900 text-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "mr-6 border border-sky-200 bg-sky-50 text-slate-800 dark:border-sky-600/50 dark:bg-sky-500/10 dark:text-slate-100"
                    }`}
                  >
                    {entry.content}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {appliedFields.length ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <span className="inline-flex items-center gap-1 font-medium">
              <LightningBoltIcon className="h-4 w-4" />
              Applied {appliedFields.length} field{appliedFields.length > 1 ? "s" : ""}
            </span>
          </div>
        ) : null}

        {clarifyingQuestions.length ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300">
              Follow-up Questions
            </p>
            <div className="flex flex-wrap gap-2">
              {clarifyingQuestions.map((question, index) => (
                <button
                  key={`question-${index}`}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setPrompt(question)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {missingFields.length ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-300">
              Still Needed
            </p>
            <div className="flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <span
                  key={field}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  {field}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
