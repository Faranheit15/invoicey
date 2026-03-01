import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GridBackground } from "@/components/ui/aceternity/grid-background";
import { Spotlight } from "@/components/ui/aceternity/spotlight";
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
    <main className="relative min-h-screen overflow-hidden bg-slate-950 px-4 py-14 text-slate-100 sm:px-6 lg:px-10">
      <Spotlight
        className="-top-40 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-58"
        fill="#0EA5E9"
      />
      <Spotlight
        className="-left-24 bottom-6 h-[22rem] w-[22rem] opacity-35"
        fill="#F97316"
      />
      <GridBackground className="opacity-70" />

      <section className="relative mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100">
            <RocketIcon className="h-3.5 w-3.5" />
            Contact
          </span>
          <h1 className="mt-4 text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Reach out and follow the product journey.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
            The fastest way to connect is through the channels below.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {contactLinks.map((link) => (
            <Card
              key={link.label}
              className="border-white/15 bg-slate-900/80 text-slate-100 backdrop-blur"
            >
              <CardHeader className="space-y-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-lg text-white">
                  {link.icon}
                  {link.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-slate-300">
                  {link.description}
                </p>
                <Link
                  href={link.href}
                  className="inline-flex rounded-md border border-white/25 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Open {link.label}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
