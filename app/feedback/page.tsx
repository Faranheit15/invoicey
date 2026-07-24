"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { StarIcon, StarFilledIcon, PaperPlaneIcon } from "@radix-ui/react-icons";
import { PageShell } from "@/components/ui/page-shell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SelectField } from "@/components/ui/select-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Badge } from "@/components/ui/badge";
import { MicroLabel } from "@/components/ui/micro-label";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import {
  feedbackApi,
  describeRequestError,
  UnauthenticatedError,
} from "@/lib/api-client";
import { formatDateLong } from "@/lib/invoices";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABEL,
  FEEDBACK_STATUS_LABEL,
  MAX_FEEDBACK_LENGTH,
} from "@/lib/feedback";
import type { FeedbackRecord, FeedbackStatus } from "@/lib/feedback";

const AUTH_PATH = "/auth?next=%2Ffeedback";

const CATEGORY_OPTIONS = FEEDBACK_CATEGORIES.map((c) => ({
  value: c,
  label: FEEDBACK_CATEGORY_LABEL[c],
}));

const statusVariant = (
  status: FeedbackStatus
): "info" | "success" | "neutral" =>
  status === "new" ? "info" : status === "reviewed" ? "success" : "neutral";

function StarRating({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className="transition-transform hover:scale-110"
        >
          {n <= value ? (
            <StarFilledIcon className="h-6 w-6 text-amber-400" />
          ) : (
            <StarIcon className="h-6 w-6 text-slate-300 dark:text-slate-600" />
          )}
        </button>
      ))}
      {value > 0 ? (
        <button
          type="button"
          onClick={() => onChange(0)}
          className="ml-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

export default function FeedbackPage() {
  const router = useRouter();
  const [category, setCategory] = useState("idea");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [items, setItems] = useState<FeedbackRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadOwn = useCallback(async () => {
    try {
      const { feedback } = await feedbackApi.listOwn();
      setItems(feedback || []);
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        router.replace(AUTH_PATH);
        return;
      }
      // A failed history load shouldn't block the form.
    }
  }, [router]);

  useEffect(() => {
    loadOwn();
  }, [loadOwn]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError("Please write a little something before sending.");
      return;
    }
    try {
      setIsSubmitting(true);
      setError("");
      setNotice("");
      const { feedback } = await feedbackApi.submit({
        message: message.trim(),
        rating: rating || undefined,
        category: category as FeedbackRecord["category"],
        page: "/feedback",
      });
      setItems((prev) => [feedback, ...prev]);
      setMessage("");
      setRating(0);
      setNotice("Thanks — your feedback was sent. It really helps.");
    } catch (err) {
      if (err instanceof UnauthenticatedError) {
        router.replace(AUTH_PATH);
        return;
      }
      setError(describeRequestError(err, "Couldn't send that feedback.").message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageShell tone="app">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <EyebrowBadge>Beta feedback</EyebrowBadge>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">
            Help shape Invoicey
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            You&apos;re a beta tester. Tell us what&apos;s working, what&apos;s
            broken, or what you wish it did — it goes straight to the team.
          </p>
        </div>

        <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-xl text-slate-900 dark:text-slate-100">
              Send feedback
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notice ? (
              <div className="mb-4">
                <AlertBanner tone="success">{notice}</AlertBanner>
              </div>
            ) : null}
            {error ? (
              <div className="mb-4">
                <AlertBanner>{error}</AlertBanner>
              </div>
            ) : null}

            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <MicroLabel as="p" variant="section" className="mb-1.5">
                    Type
                  </MicroLabel>
                  <SelectField
                    value={category}
                    onValueChange={setCategory}
                    options={CATEGORY_OPTIONS}
                  />
                </div>
                <div>
                  <MicroLabel as="p" variant="section" className="mb-1.5">
                    Rating (optional)
                  </MicroLabel>
                  <StarRating value={rating} onChange={setRating} />
                </div>
              </div>

              <div>
                <MicroLabel as="p" variant="section" className="mb-1.5">
                  Your feedback
                </MicroLabel>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MAX_FEEDBACK_LENGTH}
                  rows={5}
                  placeholder="What did you like, what got in your way, what would make this a no-brainer to keep using?"
                />
                <p className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">
                  {message.length}/{MAX_FEEDBACK_LENGTH}
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting || !message.trim()}>
                  <PaperPlaneIcon className="h-4 w-4" />
                  {isSubmitting ? "Sending…" : "Send feedback"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {items.length ? (
          <Card className="border-slate-200 dark:border-slate-700 dark:bg-slate-900">
            <CardHeader className="border-b border-slate-200 pb-3 dark:border-slate-700">
              <CardTitle className="text-base text-slate-900 dark:text-slate-100">
                Your feedback
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((f) => (
                  <li key={f._id} className="px-5 py-4">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {FEEDBACK_CATEGORY_LABEL[f.category]}
                      </Badge>
                      {f.rating ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                          <StarFilledIcon className="h-3.5 w-3.5" />
                          {f.rating}
                        </span>
                      ) : null}
                      <Badge variant={statusVariant(f.status)}>
                        {FEEDBACK_STATUS_LABEL[f.status]}
                      </Badge>
                      <span className="tabular ml-auto text-xs text-slate-400 dark:text-slate-500">
                        {formatDateLong(f.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                      {f.message}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageShell>
  );
}
