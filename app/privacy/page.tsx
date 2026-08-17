import type { Metadata } from "next";
import Link from "next/link";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { LockClosedIcon } from "@radix-ui/react-icons";
import {
  DraftNotice,
  EmailLink,
  GrievanceBlock,
  LEGAL,
  LegalList,
  LegalSection,
  LegalTable,
  LOG_RETENTION_ROWS,
  Placeholder,
} from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | Invoicey",
  description:
    "What Invoicey collects, who else sees it, how long it is kept, and how to make us delete it.",
};

/**
 * The privacy policy. Published at /privacy on the app's own domain because
 * that is where it has to be: SPDI Rule 4 makes publication a duty, and Google
 * OAuth brand verification requires a privacy policy URL on the same domain as
 * the homepage (docs/design/phase-1-legal-and-ops.md §1.2, §1.5).
 *
 * Every factual claim here was checked against the code, and several of the
 * design doc's drafted sentences were CHANGED because the code contradicted
 * them: soft-deleted invoices are NOT purged after 30 days (there is no purge
 * cron and no `deletedAt`), and there are no backups — no Cloudflare R2, no
 * GitHub workflow, and an Atlas tier that takes none. Do not restore those
 * claims from the draft until the code that makes them true exists.
 *
 * The account export/deletion and Sentry paragraphs describe Phase 1 items 2
 * and 5, whose routes landed in this tree while this page was being written.
 * If either is reverted, this page is wrong and must be revised with it.
 */
export default function PrivacyPage() {
  return (
    <PageShell tone="marketing">
      <article className="relative mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <EyebrowBadge icon={<LockClosedIcon className="h-3.5 w-3.5" />}>
            Privacy
          </EyebrowBadge>
          <h1 className="text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Last updated: <Placeholder>{LEGAL.effectiveDate}</Placeholder>
          </p>
          <DraftNotice document="policy" />
          <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300">
            Invoicey is run by <Placeholder>{LEGAL.entityName}</Placeholder>{" "}
            (&ldquo;we&rdquo;, &ldquo;us&rdquo;), based at{" "}
            <Placeholder>{LEGAL.postalAddress}</Placeholder>, India. This page
            explains what we collect, why, who else sees it, how long we keep it,
            and how to make us delete it. It is written to be read, not to be
            survived.
          </p>
        </header>

        <LegalSection title="The short version">
          <p>
            You sign in, you type invoices, we store them so you can come back to
            them. If you use the AI assistant, the draft you are working on is
            sent to Google to be turned into fields. We do not sell anything, we
            do not advertise, and we do not share your invoices with anyone
            except the service providers listed below that we need in order to
            run the product. You can export everything and delete everything, from
            inside the app, whenever you want (a few times a day — there is a
            fair-use cap so one account cannot exhaust the free tier for
            everyone).
          </p>
        </LegalSection>

        <LegalSection title="Who is responsible for what">
          <p>
            Your invoices contain your clients&apos; names, addresses and email
            addresses. Those people are not our users and have never heard of us.{" "}
            <strong className="font-semibold text-slate-900 dark:text-white">
              You decide what goes into an invoice; we just store and process it
              for you.
            </strong>{" "}
            In data-protection terms you are the one responsible for that
            information, and we handle it on your instructions. Our job is to keep
            it secure, not use it for anything else, and delete it when you tell
            us to.
          </p>
        </LegalSection>

        <LegalSection title="What we collect">
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Your account.
            </strong>{" "}
            Email address, display name, profile picture URL, and which sign-in
            method you used (Google, or email and password). This is held by
            Firebase Authentication, which is operated by Google. If you use a
            password, Google holds it — we never see it. We keep a copy of your
            email, name, picture URL, sign-in methods, account creation date and
            last sign-in date in our own database.
          </p>
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Your invoices.
            </strong>{" "}
            Everything you type into one: your business name, address, email,
            phone and logo URL; your client&apos;s name, address and email; line
            items, descriptions and amounts; dates, currency, discount, CGST,
            SGST, service charge, notes, terms, and the payment details you
            choose to print on the invoice.{" "}
            <strong className="font-semibold text-slate-900 dark:text-white">
              The payment-details field is free text — if you type a bank account
              number, IFSC code or UPI ID there, we store it exactly as typed.
            </strong>{" "}
            We do not verify it, use it, or send anything to it. Invoicey never
            takes payments and never sends your invoices anywhere; it produces
            files that you send yourself.
          </p>
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Feedback.
            </strong>{" "}
            If you send feedback, we store your message, an optional rating, the
            category and which page you were on.
          </p>
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Technical logs.
            </strong>{" "}
            We record events like sign-ins, invoice creation, exports, errors and
            AI requests. Each entry can include your user id,{" "}
            <strong className="font-semibold text-slate-900 dark:text-white">
              your IP address
            </strong>
            , your browser&apos;s user-agent string, and context such as an
            invoice id, an amount, a currency, or — for errors — a stack trace.
            Anything that looks like a token, password, key or cookie is stripped
            out automatically before an entry is written, and each entry is
            size-capped.
          </p>
          <p>
            One of those entries is much more detailed than the rest and we would
            rather say so than let you find out:{" "}
            <strong className="font-semibold text-slate-900 dark:text-white">
              when you use the AI assistant, we keep our own copy of what was
              sent
            </strong>{" "}
            — the message you typed and the full draft it was working on, which
            means your business details, your client&apos;s name, email and
            address, the line items, and the payment/bank note if you have filled
            one in. It is kept for 30 days and then deleted automatically. It
            exists so the maintainer can debug a bad AI response. If that is not
            a trade you want to make, do not use the assistant — the rest of the
            product does not write these entries.
          </p>
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Cookies and browser storage.
            </strong>{" "}
            We set two cookies (<code>session-token</code>,{" "}
            <code>session-id</code>) and store your display name, user id and
            basic profile in your browser&apos;s local storage, so you stay
            signed in. Firebase stores its own sign-in session in your browser.
            Your theme preference is stored locally under{" "}
            <code>invoicey-theme</code>. We do not use advertising or tracking
            cookies. We also run Vercel Analytics and Vercel Speed Insights on
            our pages to count page views and measure loading speed; these are
            cookieless and do not build a profile of you.
          </p>
        </LegalSection>

        <section
          id="ai"
          className="scroll-mt-24 space-y-3 rounded-lg border border-sky-200 bg-sky-50/80 p-5 dark:border-sky-400/30 dark:bg-sky-500/10"
        >
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
            The AI assistant sends your draft to Google
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
            <p>
              This is the part people are most likely to be surprised by, so it
              gets its own section.
            </p>
            <p>
              When you use the AI assistant to draft an invoice,{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                the entire draft you are currently working on is sent to
                Google&apos;s Gemini API
              </strong>{" "}
              , along with your message and up to the last ten turns of your
              conversation with the assistant. The draft is serialised whole, so
              that includes your business details, your client&apos;s name, email
              address and postal address, every line-item description, and every
              amount. It has to be — that is what lets the assistant fill in the
              right fields.
            </p>
            <p>
              The assistant never writes to your saved invoices. It hands a
              suggested set of changes back to your browser, you review them, and
              nothing is stored until you press Save. It is only available while
              you are creating a new invoice.{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                If you never open the AI panel, nothing is ever sent to
                Google&apos;s AI service.
              </strong>
            </p>
            <p>
              We currently call Gemini on Google&apos;s{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                free tier
              </strong>
              . Under its terms, the content sent and the responses produced{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                may be used by Google to improve its products and may be read by
                human reviewers
              </strong>
              — and that content includes your clients&apos; details as they
              appear in the draft you send to the assistant. We would rather this
              were not the case, and moving to a paid key (where prompts are{" "}
              <em>not</em> used for training and are retained only briefly for
              security and legal compliance) is on the list. Until this paragraph
              says otherwise, assume the free-tier terms apply.
            </p>
            <p>
              The assistant can also work from text you paste into it — a
              client&apos;s email, a WhatsApp message, a scope note — and extract
              the invoice from that.{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                Whatever you paste is sent to Google too
              </strong>
              , including anything personal about the sender that happens to be
              in it, such as a signature block, a phone number or an unrelated
              paragraph further down the thread. Paste the part you need rather
              than the whole message.
            </p>
            <p>
              This is the single most important thing on this page, which is why
              it is not buried: if you do not want your clients&apos; names and
              addresses reaching Google, do not use the AI assistant. Everything
              else in Invoicey works without it.
            </p>
          </div>
        </section>

        <LegalSection title="Who else sees your data">
          <p>
            These are the service providers we use to run Invoicey. They are the
            complete list.
          </p>
          <LegalTable
            headers={["Who", "What they get", "Where"]}
            rows={[
              [
                "Google LLC (Firebase Authentication)",
                "Your email, name, profile picture URL, sign-in method and sign-in activity",
                "Google's global infrastructure, mainly the United States",
              ],
              [
                "Google LLC (Gemini API)",
                "The invoice draft you send to the AI assistant, and only when you use it",
                "Google's global infrastructure",
              ],
              [
                "MongoDB, Inc. (Atlas)",
                "Your account record, your invoices, your feedback and the technical logs",
                <Placeholder key="atlas">[ATLAS REGION]</Placeholder>,
              ],
              [
                "Vercel Inc.",
                "Hosting, every HTTP request, server-side execution, runtime logs, and the cookieless analytics described above",
                <Placeholder key="vercel">[VERCEL REGION]</Placeholder>,
              ],
              [
                "Functional Software, Inc. (Sentry)",
                "Error reports: what broke and where. Request bodies, invoice contents and client details are stripped out before an event leaves our servers, and session replay — which would record an invoice on screen — is switched off",
                <Placeholder key="sentry">[SENTRY REGION]</Placeholder>,
              ],
            ]}
          />
          <p>
            We do not sell personal data, we do not share it for advertising, and
            we do not give it to anyone else except where the law requires it.
          </p>
          <p>
            Some of these providers process data outside India, mainly in the
            United States. Indian law currently permits transfers except to
            countries the Central Government specifically restricts, and no such
            restriction has been issued.
          </p>
        </LegalSection>

        <LegalSection title="Who at Invoicey can see your data">
          <p>
            Invoicey is run by one person. That person holds an administrator
            account which can list users, open any invoice — including ones you
            have deleted — read feedback, read the technical logs, and export
            invoice data in bulk. It exists for support, abuse handling and
            keeping the service running, and it is not used for anything else.
            Administrator actions are themselves logged, and those audit records
            are kept for 365 days.
          </p>
          <p>
            We are telling you this because it is true and you would otherwise
            have no way of knowing. There is no technical measure that would stop
            the operator of a database from reading it, and we are not going to
            imply otherwise.
          </p>
        </LegalSection>

        <LegalSection title="How long we keep things">
          <LegalList>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Your account and invoices:
              </strong>{" "}
              until you ask us to delete them.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                An invoice you delete:
              </strong>{" "}
              deleting an invoice hides it from your dashboard and exports. It is{" "}
              <strong className="font-semibold text-slate-900 dark:text-white">
                not removed from the database today
              </strong>{" "}
              — it is marked deleted and kept, and the administrator described
              above can still see it. We are building an automatic purge that
              removes deleted invoices for good after 30 days; until this page
              says it has landed, treat a deleted invoice as hidden rather than
              erased. If you want one actually gone now, ask the Grievance
              Officer.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Feedback:
              </strong>{" "}
              kept while the product exists, because it is how we decide what to
              build. Tell us if you want yours removed.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Technical logs:
              </strong>{" "}
              on the schedule below. These are enforced automatically by the
              database expiring each record, not by anyone remembering to do it.
            </li>
          </LegalList>
          <LegalTable
            headers={["Kind of log", "Deleted after"]}
            rows={LOG_RETENTION_ROWS.map((row) => [row.kind, row.window])}
          />
          <p>
            <strong className="font-semibold text-slate-900 dark:text-white">
              Backups:
            </strong>{" "}
            we do not currently take automated off-site backups of the database.
            That is a gap we intend to close, and this page will say so when it
            is closed. In the meantime: export the invoices you cannot afford to
            lose, and keep the files somewhere you control.
          </p>
        </LegalSection>

        <LegalSection title="Your rights, and how to actually use them">
          <p>
            Indian data-protection law gives you the right to see what we hold
            about you, correct it, have it erased, complain about how we handled
            it, and nominate someone to exercise those rights on your behalf.
            Here is how each one works today.
          </p>
          <LegalList>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                See what we hold.
              </strong>{" "}
              Export your account from your account page in the app. You get one
              file containing your profile, every invoice — including the ones
              you have deleted — your feedback, and your recent activity records.
              You can also export any individual invoice as PDF, HTML, CSV or
              JSON from the editor. If you cannot reach the app, email the
              Grievance Officer and we will send it to you within{" "}
              {LEGAL.grievanceSlaDays} days.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Correct it.
              </strong>{" "}
              Edit any invoice in the app. To change your name or email, change
              it with whichever sign-in provider you used; it updates here the
              next time you sign in.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Delete it.
              </strong>{" "}
              Delete your account from your account page. We ask you to sign in
              again and type your email address first, because this one is not
              reversible. It destroys your invoices — including the ones you had
              already deleted — and your feedback and your account record, and
              removes your sign-in account from Firebase. Your technical log
              entries are not destroyed; instead everything identifying is
              emptied out of them — your user id, your IP address, your
              user-agent, and the message and context fields, which is what
              removes the stored AI drafts described above. What is left is a
              bare record that some event happened at some time, and it expires
              on the schedule above. If you cannot reach the app, email
              the Grievance Officer from the address on your account and we will
              do it within {LEGAL.grievanceSlaDays} days.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Export before you delete.
              </strong>{" "}
              If you are registered under GST, you are required to keep your
              records for 72 months. That duty is yours, not ours — Invoicey is
              not your books of account. Deleting your account here does not
              excuse it, so take your files first.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Complain.
              </strong>{" "}
              Contact the Grievance Officer below. If you are not satisfied with
              how we handle it, you can complain to the Data Protection Board of
              India.
            </li>
            <li>
              <strong className="font-semibold text-slate-900 dark:text-white">
                Nominate someone.
              </strong>{" "}
              You can nominate a person to exercise these rights for you if you
              die or become unable to exercise them yourself. We do not have a
              form for this — email the Grievance Officer and we will record it
              by hand.
            </li>
          </LegalList>
        </LegalSection>

        <LegalSection title="Grievance Officer" id="grievance">
          <p>
            If you have a question or a complaint about how we handle your data,
            this is the person to contact.
          </p>
          <GrievanceBlock />
        </LegalSection>

        <LegalSection title="Security">
          <p>
            Reaching any of your data requires a signed-in session, and password
            accounts have to verify their email address first. Every request is
            checked against the identity of the signed-in user and scoped to that
            user&apos;s own records. Traffic is served over HTTPS with HSTS, and
            data is encrypted in transit and at rest by our hosting providers.
            Secrets are stripped out of log entries before they are written.
          </p>
          <p>
            We are a small operation and we will not claim more than that. There
            is no SOC 2 report, no external audit, and no security team. If you
            find a vulnerability, please email{" "}
            <EmailLink address={LEGAL.securityEmail} /> — we would much rather
            hear it from you.
          </p>
        </LegalSection>

        <LegalSection title="If something goes wrong">
          <p>
            If personal data is breached, we will tell affected users without
            delay — what happened, what was exposed, and what to do about it —
            and report it to the Data Protection Board of India as required.
          </p>
        </LegalSection>

        <LegalSection title="Children">
          <p>
            Invoicey is for people running a business and is not intended for
            anyone under 18. We do not knowingly collect data from children.
          </p>
        </LegalSection>

        <LegalSection title="Changes">
          <p>
            If we change this policy in a way that affects you, we will say so in
            the app before it takes effect, not quietly edit this page. The date
            at the top always reflects the current version.
          </p>
        </LegalSection>

        <footer className="border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
          <p>
            See also our{" "}
            <Link
              href="/terms"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              Terms of Service
            </Link>{" "}
            and the{" "}
            <Link
              href="/contact"
              className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            >
              contact page
            </Link>
            .
          </p>
        </footer>
      </article>
    </PageShell>
  );
}
