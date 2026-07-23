import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircledIcon, RocketIcon } from "@radix-ui/react-icons";

const includedFeatures = [
  "Unlimited invoice creation",
  "Edit and manage invoice status",
  "PDF/HTML/CSV/JSON exports",
  "Simple dashboard workflow",
];

export default function PricingPage() {
  return (
    <PageShell tone="marketing" counterweight="right">
      <section className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <EyebrowBadge icon={<RocketIcon className="h-3.5 w-3.5" />}>
            Pricing
          </EyebrowBadge>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            Free plan. Full workflow.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            Invoicey is currently free to use while we polish the platform for
            public launch.
          </p>
        </div>

        <Card className="mx-auto mt-8 max-w-xl border-slate-200 bg-white/90 text-slate-900 shadow-[0_28px_70px_rgba(2,6,23,0.1)] backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:shadow-[0_28px_70px_rgba(2,6,23,0.5)]">
          <CardHeader className="space-y-2 border-b border-slate-200 pb-4 dark:border-white/10">
            <CardTitle className="text-2xl text-slate-900 dark:text-white">
              Starter
            </CardTitle>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Built for freelancers, founders, and small teams.
            </p>
            <p className="text-4xl font-semibold text-slate-900 dark:text-white">$0</p>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <ul className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
              {includedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckCircledIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button asChild className="w-full bg-slate-900 text-slate-100 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100">
              <Link href="/auth">Start Free</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="w-full border-slate-300 bg-white/70 hover:bg-slate-100 dark:border-white/30 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <Link href="https://buymeacoffee.com/faaaaraaaan">
                Support Invoicey
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
