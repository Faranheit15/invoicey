import Link from "next/link";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EnvelopeClosedIcon,
  GitHubLogoIcon,
  HomeIcon,
  LinkedInLogoIcon,
  LockClosedIcon,
  RocketIcon,
  TwitterLogoIcon,
} from "@radix-ui/react-icons";
import {
  EmailLink,
  GrievanceBlock,
  LEGAL,
  Placeholder,
} from "@/components/legal";

/**
 * Contact. This page used to be three personal social profiles and nothing
 * else — no email, no postal address, no support channel — which is neither a
 * support channel nor the legal contact SPDI Rule 5(9) and DPDP Rule 14 both
 * require to be published (docs/design/phase-1-legal-and-ops.md §6.1).
 *
 * Restructured around channels rather than profiles. The socials stay, demoted
 * and honestly relabelled: they are good for following along and were only
 * wrong as *the* way to reach anyone. Deliberately NO contact form — the app
 * has no mail provider, and a form that silently fails is worse than a
 * `mailto:`, which at least leaves the sender a copy of what they sent.
 */
const supportChannels = [
  {
    label: "Support",
    address: LEGAL.supportEmail,
    icon: <EnvelopeClosedIcon className="h-5 w-5" />,
    description:
      "Bugs, questions, anything that is not working. One person reads this, usually within a couple of days. There is no ticket queue and no chatbot.",
  },
  {
    label: "Security",
    address: LEGAL.securityEmail,
    icon: <LockClosedIcon className="h-5 w-5" />,
    description:
      "Found a vulnerability? Send it here rather than posting it. We would much rather hear it from you first, and we will not be difficult about it.",
  },
];

const socialLinks = [
  {
    label: "Twitter",
    href: "https://twitter.com/faaaaraaaan",
    icon: <TwitterLogoIcon className="h-4 w-4" />,
  },
  {
    label: "GitHub",
    href: "https://github.com/faranheit15",
    icon: <GitHubLogoIcon className="h-4 w-4" />,
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/in/faran-mohammad",
    icon: <LinkedInLogoIcon className="h-4 w-4" />,
  },
];

export default function ContactPage() {
  return (
    <PageShell tone="marketing">
      <section className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <EyebrowBadge icon={<RocketIcon className="h-3.5 w-3.5" />}>
            Contact
          </EyebrowBadge>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-slate-900 dark:text-white sm:text-5xl">
            One person runs this. Here is how to reach them.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            Email is the real channel. Privacy complaints have their own address
            and a deadline we hold ourselves to.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {supportChannels.map((channel) => (
            <Card
              key={channel.label}
              className="border-slate-200 bg-white/90 text-slate-900 backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100"
            >
              <CardHeader className="space-y-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-white">
                  {channel.icon}
                  {channel.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {channel.description}
                </p>
                <p className="text-sm">
                  <EmailLink address={channel.address} />
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mx-auto mt-4 max-w-3xl">
          <GrievanceBlock />
        </div>

        <div className="mx-auto mt-4 grid max-w-3xl gap-4 sm:grid-cols-2">
          <Card className="border-slate-200 bg-white/90 text-slate-900 backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-white">
                <HomeIcon className="h-5 w-5" />
                Postal address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              <p>
                <Placeholder>{LEGAL.entityName}</Placeholder>
              </p>
              <p>
                <Placeholder>{LEGAL.postalAddress}</Placeholder>, India
              </p>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/90 text-slate-900 backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100">
            <CardHeader className="space-y-2 pb-3">
              <CardTitle className="text-lg text-slate-900 dark:text-white">
                Follow along
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Product updates and build notes. Not a support channel — please
                do not send account or billing details to a public profile.
              </p>
              <div className="flex flex-wrap gap-2">
                {socialLinks.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white/70 px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100 dark:border-white/25 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                  >
                    {link.icon}
                    {link.label}
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <p className="mx-auto mt-6 max-w-3xl text-center text-sm text-slate-600 dark:text-slate-300">
          What we do with anything you send us is described in the{" "}
          <Link
            href="/privacy"
            className="font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
          >
            privacy policy
          </Link>
          .
        </p>
      </section>
    </PageShell>
  );
}
