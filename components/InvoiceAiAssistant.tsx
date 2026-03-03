"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type {
  AssistantConversationEntry,
  InvoiceAssistantPatch,
  InvoiceAssistantResponse,
} from "@/lib/ai/invoice-assistant/contracts";
import type { InvoiceFormState } from "@/lib/invoices";
import {
  ChatBubbleIcon,
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

const MAX_CONVERSATION_ENTRIES = 12;
const MAX_PROMPT_LENGTH = 4000;

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
  const [prompt, setPrompt] = useState("");
  const [conversation, setConversation] = useState<AssistantConversationEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [assistantError, setAssistantError] = useState("");
  const [clarifyingQuestions, setClarifyingQuestions] = useState<string[]>([]);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [appliedFields, setAppliedFields] = useState<string[]>([]);

  const promptLength = useMemo(() => prompt.trim().length, [prompt]);

  const submitPrompt = async (value?: string) => {
    const message = (value || prompt).trim();
    if (!message || isGenerating) {
      return;
    }

    setAssistantError("");
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
          conversation: updatedConversation,
          draft: invoice,
        }),
      });

      const data = (await response.json()) as
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
    } catch {
      setAssistantError("Unable to process your invoice request right now.");
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
          Describe your invoice in natural language and I&apos;ll fill the form below.
        </p>
      </CardHeader>

      <CardContent className="relative space-y-4 p-5">
        <div className="grid gap-2">
          <label
            htmlFor="invoice-ai-prompt"
            className="text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300"
          >
            Prompt
          </label>
          <Textarea
            id="invoice-ai-prompt"
            placeholder="Example: Web development for TechCorp, 40 hours at $120/hr, plus $500 for cloud hosting, due in 30 days, USD."
            value={prompt}
            maxLength={MAX_PROMPT_LENGTH}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-[112px] border-sky-200/80 bg-white/85 text-slate-800 shadow-sm focus-visible:ring-sky-500 dark:border-sky-700/60 dark:bg-slate-900/70 dark:text-slate-100"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {promptLength}/{MAX_PROMPT_LENGTH}
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
                  Generating
                </>
              ) : (
                <>
                  <PaperPlaneIcon className="h-4 w-4" />
                  Fill Invoice
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((quickPrompt, index) => (
            <button
              key={`quick-prompt-${index}`}
              type="button"
              disabled={isGenerating}
              onClick={() => submitPrompt(quickPrompt)}
              className="rounded-full border border-sky-200 bg-white/85 px-3 py-1.5 text-left text-xs text-slate-700 transition hover:border-sky-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-sky-500"
            >
              {quickPrompt}
            </button>
          ))}
        </div>

        {assistantError ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            {assistantError}
          </div>
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
