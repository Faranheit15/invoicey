import { TwitterLogoIcon, GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";
import Link from "next/link";

export default function ContactPage() {
  return (
    <section className="container flex flex-col min-h-screen px-4 py-16 mx-auto text-center">
      <h1 className="text-4xl font-extrabold">Contact</h1>
      <p className="mt-4 text-lg text-gray-600">Follow and reach out to me on these platforms:</p>
      <div className="flex justify-center mt-6 space-x-6">
        <Link href="https://twitter.com/faaaaraaaan" className="text-3xl text-blue-500">
          <TwitterLogoIcon />
        </Link>
        <Link href="https://github.com/faranheit15" className="text-3xl text-gray-800">
          <GitHubLogoIcon />
        </Link>
        <Link href="https://linkedin.com/in/faran-mohammad" className="text-3xl text-blue-700">
          <LinkedInLogoIcon />
        </Link>
      </div>
    </section>
  );
}