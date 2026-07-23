import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <PageShell tone="marketing">
      <section className="relative mx-auto max-w-6xl space-y-10">
        <div className="max-w-3xl">
          <EyebrowBadge icon={<RocketIcon className="h-3.5 w-3.5" />}>
            About Invoicey
          </EyebrowBadge>
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
    </PageShell>
  );
}
