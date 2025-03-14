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

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerId: string;
}

export default function Header() {
  const [user, setUser] = useState<UserData | null>(null);
  const userSessionManager = new UserSessionManager();
  const router = useRouter();
  const placeholderAvatar = "https://via.placeholder.com/40"; // Default image if no profile picture

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const storedUser = userSessionManager.user;
        if (!storedUser) {
          const userData = {
            uid: user.uid,
            email: user.email || "",
            name: user.displayName || "",
            photoURL: user.photoURL || placeholderAvatar,
            providerId: user.providerData[0]?.providerId || "unknown",
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
        <nav className="flex items-center space-x-4">
          <Link href="/about" className="dark:text-white">
            About
          </Link>
          <Link href="/pricing" className="dark:text-white">
            Pricing
          </Link>
          <Link href="/contact" className="dark:text-white">
            Contact
          </Link>

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
                  <Switch aria-label="Toggle Dark Mode" />
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
      </div>
    </header>
  );
}
