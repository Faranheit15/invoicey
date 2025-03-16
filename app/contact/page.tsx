import {
  TwitterLogoIcon,
  GitHubLogoIcon,
  LinkedInLogoIcon,
} from "@radix-ui/react-icons";
import Link from "next/link";

export default function ContactPage() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-screen px-4 py-16 text-center bg-gradient-to-r from-blue-50 via-white to-blue-50">
      <div className="relative z-10 max-w-3xl">
        <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">
          Contact
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Follow and reach out to me on these platforms:
        </p>
        <div className="flex justify-center mt-8 space-x-6">
          <Link
            href="https://twitter.com/faaaaraaaan"
            className="text-3xl text-blue-500 transition-colors hover:text-blue-600"
          >
            <TwitterLogoIcon />
          </Link>
          <Link
            href="https://github.com/faranheit15"
            className="text-3xl text-gray-800 transition-colors hover:text-gray-900"
          >
            <GitHubLogoIcon />
          </Link>
          <Link
            href="https://linkedin.com/in/faran-mohammad"
            className="text-3xl text-blue-700 transition-colors hover:text-blue-800"
          >
            <LinkedInLogoIcon />
          </Link>
        </div>
      </div>
      {/* Decorative Background Element */}
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
