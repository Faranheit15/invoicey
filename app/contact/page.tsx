import Link from "next/link";
import { EyebrowBadge } from "@/components/ui/eyebrow-badge";
import { PageShell } from "@/components/ui/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GitHubLogoIcon,
  LinkedInLogoIcon,
  RocketIcon,
  TwitterLogoIcon,
} from "@radix-ui/react-icons";

const contactLinks = [
  {
    label: "Twitter",
    href: "https://twitter.com/faaaaraaaan",
    icon: <TwitterLogoIcon className="h-5 w-5" />,
    description: "Product updates and launch notes",
  },
  {
    label: "GitHub",
    href: "https://github.com/faranheit15",
    icon: <GitHubLogoIcon className="h-5 w-5" />,
    description: "Code, issues, and contribution context",
  },
  {
    label: "LinkedIn",
    href: "https://linkedin.com/in/faran-mohammad",
    icon: <LinkedInLogoIcon className="h-5 w-5" />,
    description: "Professional profile and direct outreach",
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
            Reach out and follow the product journey.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            The fastest way to connect is through the channels below.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {contactLinks.map((link) => (
            <Card
              key={link.label}
              className="border-slate-200 bg-white/90 text-slate-900 backdrop-blur dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100"
            >
              <CardHeader className="space-y-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg text-slate-900 dark:text-white">
                  {link.icon}
                  {link.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {link.description}
                </p>
                <Link
                  href={link.href}
                  className="inline-flex rounded-md border border-slate-300 bg-white/70 px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100 dark:border-white/25 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  Open {link.label}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
