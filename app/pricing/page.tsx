import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function PricingPage() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-screen px-4 py-16 text-center bg-gradient-to-r from-blue-50 via-white to-blue-50">
      <div className="relative z-10 max-w-3xl">
        <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">
          Pricing
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Invoicey is completely free to use!
        </p>
        <div className="flex justify-center mt-8">
          <Card className="shadow-lg w-96">
            <CardHeader>
              <CardTitle>Support Invoicey</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">
                Invoicey is free, but if you find it useful, consider supporting
                the developer. Your support helps maintain and improve the
                platform.
              </p>
              <Button disabled className="w-full mt-4" asChild>
                <Link href="https://buymeacoffee.com/faaaaraaaan">Donate</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Decorative Background SVG */}
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
