import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRightIcon } from "@radix-ui/react-icons";

export default function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center w-full min-h-screen px-4 py-20 text-center bg-gradient-to-r from-blue-50 via-white to-blue-50">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
          Generate Invoices Effortlessly
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Create and share invoices in just a few clicks. Simple. Fast. Free.
        </p>
        <div className="mt-8">
          <Button asChild className="px-6 py-3">
            <Link href="/auth" className="flex items-center gap-2">
              Get Started
              <ArrowRightIcon className="w-5 h-5" />
            </Link>
          </Button>
        </div>
      </div>
      {/* Decorative background element */}
      <div className="absolute inset-0 overflow-hidden -z-10">
        <svg
          className="absolute top-0 -translate-x-1/2 left-1/2 opacity-20"
          width="800"
          height="600"
          fill="none"
          viewBox="0 0 800 600"
        >
          <circle cx="400" cy="300" r="300" fill="url(#grad)" />
          <defs>
            <radialGradient id="grad" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="100%" stopColor="#93C5FD" />
            </radialGradient>
          </defs>
        </svg>
      </div>
    </section>
  );
}
