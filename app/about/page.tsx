import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridBackground } from "@/components/ui/aceternity/grid-background";
import { Spotlight } from "@/components/ui/aceternity/spotlight";
import {
  LightningBoltIcon,
  RocketIcon,
  StarIcon,
} from "@radix-ui/react-icons";

const pillars = [
  {
    title: "Fast by default",
    description:
      "The core workflow focuses on creating polished invoices in minutes, not forcing setup-heavy onboarding.",
    icon: <LightningBoltIcon className="h-4 w-4" />,
  },
  {
    title: "Professional outputs",
    description:
      "Invoice layouts, totals, and exports are tuned for real client delivery so they feel production-ready.",
    icon: <StarIcon className="h-4 w-4" />,
  },
  {
    title: "Built for operators",
    description:
      "Freelancers and small teams can manage status updates, edits, and payment records without tool sprawl.",
    icon: <RocketIcon className="h-4 w-4" />,
  },
];

export default function AboutPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-100 px-4 py-14 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-10">
      <Spotlight
        className="-top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-60"
        fill="#0EA5E9"
      />
      <Spotlight
        className="-left-24 bottom-8 h-[22rem] w-[22rem] opacity-35"
        fill="#F97316"
      />
      <GridBackground className="opacity-70" />

      <section className="relative mx-auto max-w-6xl space-y-10">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700 dark:border-white/15 dark:bg-white/10 dark:text-sky-100">
            <RocketIcon className="h-3.5 w-3.5" />
            About Invoicey
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            A practical billing workspace for people shipping real work.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            Invoicey was created for founders, freelancers, and teams who need
            clean invoices without bloated accounting software. The product keeps
            the workflow focused: create, edit, track, and export.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {pillars.map((pillar) => (
            <Card
              key={pillar.title}
              className="border-slate-200 bg-white/85 text-slate-900 backdrop-blur dark:border-white/10 dark:bg-slate-900/75 dark:text-slate-100"
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-white">
                  {pillar.icon}
                  {pillar.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {pillar.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
