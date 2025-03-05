import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Hero() {
  return (
    <section className="flex flex-col items-center justify-center py-20 text-center">
      <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">Generate Invoices Effortlessly</h1>
      <p className="mt-4 text-lg text-gray-600">Create and share invoices in just a few clicks. Simple. Fast. Free.</p>
      <Button asChild className="mt-6">
        <Link href="/auth">Get Started</Link>
      </Button>
    </section>
  );
}
