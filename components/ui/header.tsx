"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import UserSessionManager from "@/modules/UserSessionManager";
import Link from "next/link";
import Image from "next/image";
import { HamburgerMenuIcon, Cross1Icon } from "@radix-ui/react-icons";

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerId: string;
}

export default function Header() {
  const [user, setUser] = useState<UserData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userSessionManager = new UserSessionManager();
  const router = useRouter();
  const placeholderAvatar = "https://via.placeholder.com/40"; // Default image if no profile picture

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const storedUser = userSessionManager.user;
        if (!storedUser) {
          const userData: UserData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || "",
            name: firebaseUser.displayName || "",
            photoURL: firebaseUser.photoURL || placeholderAvatar,
            providerId: firebaseUser.providerData[0]?.providerId || "unknown",
          };
          userSessionManager.user = userData;
          setUser(userData);
        } else {
          setUser(storedUser);
        }
      } else {
        userSessionManager.clearLocal();
        setUser(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      userSessionManager.clearLocal();
      setUser(null);
      router.push("/auth");
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-white shadow-md dark:bg-gray-900">
      <div className="container flex items-center justify-between p-4 mx-auto">
        <Link href="/">
          <h1 className="text-2xl font-bold dark:text-white">Invoicey</h1>
        </Link>
        {/* Desktop Navigation */}
        <nav className="items-center hidden space-x-4 md:flex">
          <Link href="/about" className="dark:text-white">
            About
          </Link>
          <Link href="/pricing" className="dark:text-white">
            Pricing
          </Link>
          <Link href="/contact" className="dark:text-white">
            Contact
          </Link>
          {user && (
            <Link href="/dashboard" className="dark:text-white">
              My Invoices
            </Link>
          )}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger>
                <Image
                  src={user.photoURL || placeholderAvatar}
                  alt={user.name}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-full cursor-pointer"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  ☀️
                  <Switch aria-label="Toggle Dark Mode" className="mx-2" />
                  🌒
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild>
              <Link href="/auth">Get Started</Link>
            </Button>
          )}
        </nav>
        {/* Mobile Menu Button */}
        <div className="md:hidden">
          <Button
            variant="ghost"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? (
              <Cross1Icon className="w-6 h-6" />
            ) : (
              <HamburgerMenuIcon className="w-6 h-6" />
            )}
          </Button>
        </div>
      </div>
      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="bg-white shadow-md md:hidden dark:bg-gray-900">
          <nav className="flex flex-col p-4 space-y-2">
            <Link
              href="/about"
              className="dark:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              About
            </Link>
            <Link
              href="/pricing"
              className="dark:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pricing
            </Link>
            <Link
              href="/contact"
              className="dark:text-white"
              onClick={() => setMobileMenuOpen(false)}
            >
              Contact
            </Link>
            {user && (
              <Link
                href="/dashboard"
                className="dark:text-white"
                onClick={() => setMobileMenuOpen(false)}
              >
                My Invoices
              </Link>
            )}
            {user ? (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleLogout();
                }}
                className="text-left dark:text-white"
              >
                Logout
              </button>
            ) : (
              <Button asChild onClick={() => setMobileMenuOpen(false)}>
                <Link href="/auth">Get Started</Link>
              </Button>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
