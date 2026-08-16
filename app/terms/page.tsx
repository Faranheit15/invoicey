import type { Metadata } from "next";
import Link from "next/link";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { FileTextIcon } from "@radix-ui/react-icons";
import {
  DraftNotice,
  EmailLink,
  LEGAL,
  LegalList,
  LegalSection,
  Placeholder,
} from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Invoicey",
  description:
    "What Invoicey is, what it deliberately will not do for you, and the terms you accept by using it.",
};

/**
 * Terms of service. Kept consistent with PRODUCT.md: the price is 0 with no
 * paid tier to upgrade to, the product sends no email and takes no payments,
 * and it makes no warranty that the GST figures it prints are correct — that
 * is the user's filing, not ours (docs/design/phase-1-legal-and-ops.md §3.2).
 */
export default function TermsPage() {
  return (
    <PageShell tone="marketing" counterweight="right">
      <article className="relative mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <EyebrowBadge icon={<FileTextIcon className="h-3.5 w-3.5" />}>
            Terms
          </EyebrowBadge>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            Terms of Service
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Last updated: <Placeholder>{LEGAL.effectiveDate}</Placeholder>
          </p>
          <DraftNotice document="document" />
          <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
            These terms cover your use of Invoicey, a web app operated by{" "}
            <Placeholder>{LEGAL.entityName}</Placeholder>,{" "}
            <Placeholder>{LEGAL.postalAddress}</Placeholder>, India. Using it
            means you accept them.
          </p>
        </header>

        <LegalSection title="What Invoicey is">
          <p>
            A tool for creating, editing, tracking and exporting invoices. That
            is the whole scope. It is deliberately not accounting software.
          </p>
        </LegalSection>

        <LegalSection title="What Invoicey is not, and will not do for you">
          <LegalList>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                It does not send invoices.
              </strong>{" "}
              It produces files — PDF, HTML, CSV, JSON — which you send yourself,
              however you like. Invoicey sends no email at all.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                It does not take payments.
              </strong>{" "}
              It does not process or track them either. A &ldquo;paid&rdquo;
              status is a label you set; nothing behind it talks to a bank.
            </li>
            <li>It does not issue reminders.</li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                It is not tax advice.
              </strong>{" "}
              Invoicey prints whatever tax figures you enter. Whether an invoice
              is correct under GST — the right treatment, the right rate, a valid
              GSTIN, the right invoice-number series, whether you are entitled to
              charge tax at all —{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                is your responsibility, and we do not check any of it.
              </strong>{" "}
              We give no warranty that the output is correct for any tax or legal
              purpose. If in doubt, ask your accountant.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                It does not keep your statutory records for you.
              </strong>{" "}
              If you are registered under GST you are required to retain your
              books and records for 72 months. That duty is yours as the
              registered person; Invoicey is a tool you used to typeset a
              document, not your books of account. Export your invoices and keep
              them somewhere you control.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="The price">
          <p>
            Invoicey is free. There is no paid tier, no trial, no invoice limit,
            and no feature withheld from you — there is nothing to upgrade to. If
            the day comes when this cannot continue, we will say so plainly and
            give you time to export everything; we will not quietly switch off
            features you were relying on. There is a{" "}
            <Link
              href="https://buymeacoffee.com/faaaaraaaan"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              Buy Me a Coffee
            </Link>{" "}
            link if you want to support the work. It buys you nothing extra and
            it is not a subscription.
          </p>
        </LegalSection>

        <LegalSection title="Your account">
          <p>
            You need a verified email address to use it. One person, one account
            — there are no teams, roles or shared workspaces. Keep your sign-in
            secure; anything done through your account is treated as done by you.
          </p>
        </LegalSection>

        <LegalSection title="Your content">
          <p>
            Your invoices are yours. We claim no ownership of them. You grant us
            only the permission needed to store, display and export them for you,
            and to send a draft to Google&apos;s Gemini API when you choose to use
            the AI assistant — which is described in detail in our{" "}
            <Link
              href="/privacy#ai"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              privacy policy
            </Link>
            .
          </p>
          <p>
            You are responsible for what you put in. That includes making sure
            you are entitled to store your clients&apos; details, and that
            anything you link to — a logo URL, for instance — is yours to use.
          </p>
        </LegalSection>

        <LegalSection title="Things you must not do">
          <p>
            Use Invoicey to create fraudulent, misleading or unlawful documents.
            Invoice people who are not your customers. Attempt to reach other
            users&apos; data. Automate against the app to a degree that degrades
            it for others, or run scripted loops against the AI assistant.
            Attempt to break, probe or overload the service, other than a
            good-faith security report to the address in our privacy policy.
          </p>
          <p>
            We may suspend an account that does these things. If we do, you can
            still ask for an export of your data.
          </p>
        </LegalSection>

        <LegalSection title="The AI assistant">
          <p>
            It guesses. It will sometimes guess wrong — wrong amounts, wrong
            dates, invented detail. It never saves anything by itself: it
            proposes changes, you review them, you press Save.{" "}
            <strong className="font-semibold text-slate-900 dark:text-white">
              Check the numbers before you send an invoice to a client.
            </strong>{" "}
            We are not responsible for an invoice you sent without reading it.
          </p>
        </LegalSection>

        <LegalSection title="Availability">
          <p>
            This is a small, free service run by one person. There is no uptime
            guarantee, no support SLA beyond the grievance timeline in our
            privacy policy, and maintenance may happen without notice. We do not
            currently take automated backups of the database, so you should keep
            your own copies — the export button exists for exactly this reason.
          </p>
        </LegalSection>

        <LegalSection title="Ending it">
          <p>
            You can delete your account at any time from inside the app; our{" "}
            <Link
              href="/privacy"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              privacy policy
            </Link>{" "}
            explains how to ask and what it removes. We may close an account that
            breaches these terms, or discontinue the service entirely — in which
            case we will give reasonable notice and a window to export.
          </p>
        </LegalSection>

        <LegalSection title="No warranty">
          <p>
            Invoicey is provided &ldquo;as is&rdquo;. To the extent the law
            allows, we make no warranty that it will be uninterrupted,
            error-free, or fit for any particular purpose, including any tax or
            legal purpose.
          </p>
        </LegalSection>

        <LegalSection title="Limitation of liability">
          <p>
            To the extent the law allows, we are not liable for indirect or
            consequential loss, lost profit, lost business or lost data arising
            from your use of Invoicey. Where liability cannot be excluded, it is
            limited to <Placeholder>[LIABILITY CAP]</Placeholder>.
          </p>
          <p>Nothing here limits liability that cannot be limited by law.</p>
        </LegalSection>

        <LegalSection title="Governing law">
          <p>
            These terms are governed by the laws of India, and the courts at{" "}
            <Placeholder>[JURISDICTION CITY]</Placeholder>, India have exclusive
            jurisdiction.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>
            If we change these terms materially, we will tell you in the app
            before the change takes effect.
          </p>
        </LegalSection>

        <LegalSection title="Contact">
          <p>
            <EmailLink address={LEGAL.supportEmail} /> ·{" "}
            <Placeholder>{LEGAL.postalAddress}</Placeholder>, India
          </p>
          <p>
            For anything about your personal data, use the Grievance Officer on
            the{" "}
            <Link
              href="/privacy#grievance"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              privacy policy
            </Link>{" "}
            instead.
          </p>
        </LegalSection>
      </article>
    </PageShell>
  );
}
