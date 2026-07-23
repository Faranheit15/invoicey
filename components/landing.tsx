import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { BentoGrid, BentoGridItem } from "@/components/ui/aceternity/bento-grid";
import { Atmosphere } from "@/components/ui/atmosphere";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { MicroLabel } from "@/components/ui/micro-label";
import { PageShell } from "@/components/ui/page-shell";
import { STATUS_PILL_BASE, statusPillClass } from "@/lib/invoice-status";
import {
  ArrowRightIcon,
  CheckCircledIcon,
  LightningBoltIcon,
  RocketIcon,
  PersonIcon,
  StarIcon,
  DownloadIcon,
} from "@radix-ui/react-icons";

const featureCards = [
  {
    title: "Invoice Studio",
    description:
      "Create polished invoices with line items, discount, tax, payment notes, and complete business details.",
    eyebrow: "Builder",
    icon: <CheckCircledIcon className="w-5 h-5" />,
    className: "lg:col-span-2",
  },
  {
    title: "One-Click Export",
    description:
      "Export invoice documents as PDF-ready print, HTML, CSV, or JSON without extra tooling.",
    eyebrow: "Exports",
    icon: <DownloadIcon className="w-5 h-5" />,
    className: "lg:col-span-1",
  },
  {
    title: "Client-Ready Design",
    description:
      "Professional invoice templates inspired by production-grade billing flows.",
    eyebrow: "Presentation",
    icon: <StarIcon className="w-5 h-5" />,
    className: "lg:col-span-1",
  },
  {
    title: "Dashboard + Edit Flow",
    description:
      "Track statuses, reopen any invoice, update details, and re-export in seconds.",
    eyebrow: "Ops",
    icon: <RocketIcon className="w-5 h-5" />,
    className: "lg:col-span-2",
  },
];

const quips = [
  {
    id: "yc",
    className: "sm:col-span-2",
    content: (
      <span className="inline-flex items-center gap-2">
        <span className="whitespace-nowrap">!Backed by</span>
        <Image
          src="/y-c.png"
          alt="Y Combinator"
          width={132}
          height={38}
          className="h-6 w-auto object-contain"
        />
      </span>
    ),
  },
  {
    id: "coffee",
    content: "Backed by strong coffee and a lazy full-stack developer.",
  },
  {
    id: "enterprise",
    content: 'No hidden button for "contact enterprise".',
  },
];

export default function LandingPage() {
  return (
    <PageShell tone="bare">
      <Atmosphere extended />

      <section className="relative px-4 pt-16 pb-14 sm:px-6 sm:pt-20 lg:px-10 lg:pt-24">
        <div className="mx-auto grid w-full max-w-7xl items-start gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
          <div>
            <EyebrowBadge icon={<RocketIcon className="h-3.5 w-3.5" />}>
              Invoicey
            </EyebrowBadge>

            <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] text-slate-900 dark:text-white sm:text-5xl lg:text-6xl">
              Build serious invoices fast, free and hassle-free.
            </h1>

            <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
              Build invoices that look industry-grade, edit them anytime, and export in multiple formats your clients already trust.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="bg-white text-slate-900 hover:bg-slate-100"
              >
                <Link href="/auth" className="inline-flex items-center gap-2">
                  Start Free
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-slate-300 bg-white/80 text-slate-900 hover:bg-slate-100 dark:border-white/25 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                <Link href="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>

            <ul className="mt-8 grid auto-rows-fr gap-2 text-sm text-slate-600 dark:text-slate-300 sm:grid-cols-2">
              {quips.map((quip) => (
                <li
                  key={quip.id}
                  className={`flex min-h-11 items-center rounded-lg bg-slate-200/70 px-3 py-2 dark:bg-white/[0.03] ${quip.className || ""}`}
                >
                  {quip.content}
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-5 text-sm text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <PersonIcon className="h-4 w-4" />
                <span>Solo founders to small teams</span>
              </div>
              <div className="flex items-center gap-2">
                <LightningBoltIcon className="h-4 w-4" />
                <span>Fast setup, no enterprise maze</span>
              </div>
            </div>
          </div>

          <div className="relative lg:pt-4">
            <div className="absolute -inset-0.5 rounded-3xl bg-[conic-gradient(from_120deg,_rgba(56,189,248,0.75),rgba(249,115,22,0.4),rgba(59,130,246,0.75),rgba(56,189,248,0.75))] opacity-75 blur" />
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_30px_80px_rgba(2,6,23,0.18)] dark:border-white/15 dark:bg-slate-900/85 dark:shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:p-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-white/10">
                <div>
                  <MicroLabel variant="meta">
                    Preview
                  </MicroLabel>
                  <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                    INV-849231
                  </h2>
                </div>
                {/* Uses the app's own status pill, not a bespoke pair. The old
                    emerald-200-on-emerald-400/15 had no light variant and
                    measured 1.15:1 against the card's white background. */}
                <span
                  className={`${STATUS_PILL_BASE} px-3 tracking-wide ${statusPillClass.paid}`}
                >
                  Paid
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-sm text-slate-700 dark:text-slate-200">
                <div>
                  <MicroLabel variant="meta">
                    Client
                  </MicroLabel>
                  <p className="mt-1 font-medium text-slate-900 dark:text-white">
                    Acme Manufacturing
                  </p>
                </div>
                <div className="text-right">
                  <MicroLabel variant="meta">
                    Total
                  </MicroLabel>
                  <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
                    ₹2,48,400
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2 rounded-xl border border-slate-200 bg-slate-100/80 p-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex justify-between text-slate-700 dark:text-slate-200">
                  <span>Development Sprint</span>
                  <span>₹1,80,000</span>
                </div>
                <div className="flex justify-between text-slate-700 dark:text-slate-200">
                  <span>Support Retainer</span>
                  <span>₹45,000</span>
                </div>
                <div className="flex justify-between text-slate-700 dark:text-slate-200">
                  <span>Taxes + charges</span>
                  <span>₹23,400</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="rounded-lg border border-slate-200 bg-slate-100/80 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
                  Export: PDF / HTML / CSV / JSON
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-100/80 px-3 py-2 text-right dark:border-white/10 dark:bg-white/[0.03]">
                  Edit anytime from dashboard
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="relative px-4 pb-16 sm:px-6 lg:px-10 lg:pb-20">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-6 max-w-2xl">
            <MicroLabel variant="meta">
              Product Surface
            </MicroLabel>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl">
              Designed to feel like a real product, not a toy generator.
            </h2>
          </div>

          <BentoGrid>
            {featureCards.map((feature) => (
              <BentoGridItem
                key={feature.title}
                className={feature.className}
                title={feature.title}
                description={feature.description}
                eyebrow={feature.eyebrow}
                icon={feature.icon}
              />
            ))}
          </BentoGrid>
        </div>
      </section>
    </PageShell>
  );
}
