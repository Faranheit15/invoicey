import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridBackground } from "@/components/ui/aceternity/grid-background";
import { Spotlight } from "@/components/ui/aceternity/spotlight";
import { CheckCircledIcon, RocketIcon } from "@radix-ui/react-icons";

const includedFeatures = [
  "Unlimited invoice creation",
  "Edit and manage invoice status",
  "PDF/HTML/CSV/JSON exports",
  "Simple dashboard workflow",
];

export default function PricingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-14 text-slate-100 sm:px-6 lg:px-10">
      <Spotlight
        className="-top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-60"
        fill="#0EA5E9"
      />
      <Spotlight
        className="-right-24 bottom-2 h-[24rem] w-[24rem] opacity-35"
        fill="#F97316"
      />
      <GridBackground className="opacity-70" />

      <section className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
            <RocketIcon className="h-3.5 w-3.5" />
            Pricing
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Free plan. Full workflow.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            Invoicey is currently free to use while we polish the platform for
            public launch.
          </p>
        </div>

        <Card className="mx-auto mt-8 max-w-xl border-white/15 bg-slate-900/80 text-slate-100 shadow-[0_28px_70px_rgba(2,6,23,0.5)] backdrop-blur">
          <CardHeader className="space-y-2 border-b border-white/10 pb-4">
            <CardTitle className="text-2xl text-white">Starter</CardTitle>
            <p className="text-sm text-slate-300">
              Built for freelancers, founders, and small teams.
            </p>
            <p className="text-4xl font-semibold text-white">$0</p>
          </CardHeader>
          <CardContent className="space-y-5 pt-5">
            <ul className="space-y-3 text-sm text-slate-200">
              {includedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckCircledIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                  {feature}
                </li>
              ))}
            </ul>
            <Button asChild className="w-full bg-white text-slate-900 hover:bg-slate-100">
              <Link href="/auth">Start Free</Link>
            </Button>
            <Button asChild variant="outline" className="w-full border-white/30 bg-white/5 hover:bg-white/10">
              <Link href="https://buymeacoffee.com/faaaaraaaan">
                Support Invoicey
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
