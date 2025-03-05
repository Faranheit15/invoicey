import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function PricingPage() {
  return (
    <section className="container flex flex-col min-h-screen px-4 py-16 mx-auto text-center">
      <h1 className="text-4xl font-extrabold">Pricing</h1>
      <p className="mt-4 text-lg text-gray-600">Invoicey is completely free to use!</p>
      <div className="flex justify-center mt-8">
        <Card className="shadow-lg w-96">
          <CardHeader>
            <CardTitle>Support Invoicey</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Invoicey is free, but if you find it useful, consider supporting the developer. Your support helps
              maintain and improve the platform.
            </p>
            <Button disabled className="w-full mt-4" asChild>
              <Link href="https://buymeacoffee.com/faaaaraaaan">Donate</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
