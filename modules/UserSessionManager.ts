"use client";

import Cookies from "js-cookie";

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerId: string;
}

export default class UserSessionManager {
  private keys = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    sessionToken: "session-token",
    sessionId: "session-id",
    username: "username",
    userId: "user-id",
    user: "user",
  };

  get accessToken(): string | null {
    return Cookies.get(this.keys.accessToken) || null;
  }
  set accessToken(value: string | null) {
    if (value) {
      Cookies.set(this.keys.accessToken, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.accessToken);
    }
  }

  get refreshToken(): string | null {
    return Cookies.get(this.keys.refreshToken) || null;
  }
  set refreshToken(value: string | null) {
    if (value) {
      Cookies.set(this.keys.refreshToken, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.refreshToken);
    }
  }

  get sessionToken(): string | null {
    return Cookies.get(this.keys.sessionToken) || null;
  }
  set sessionToken(value: string | null) {
    if (value) {
      Cookies.set(this.keys.sessionToken, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.sessionToken);
    }
  }

  // Access token using Cookies
  get sessionId(): string | null {
    return Cookies.get(this.keys.sessionId) || null;
  }
  set sessionId(value: string | null) {
    if (value) {
      Cookies.set(this.keys.sessionId, value, { secure: true, sameSite: "Strict" });
    } else {
      Cookies.remove(this.keys.sessionId);
    }
  }

  // Other fields remain in localStorage
  get username(): string | null {
    return this.getItem<string>(this.keys.username);
  }
  set username(value: string | null) {
    this.setItem(this.keys.username, value);
  }

  get userId(): number | null {
    return this.getItem<number>(this.keys.userId);
  }
  set userId(value: number | null) {
    this.setItem(this.keys.userId, value);
  }

  get user(): UserData | null {
    return this.getItem<UserData>(this.keys.user) || null;
  }
  set user(value: UserData | null) {
    if (value) {
      value.photoURL = value.photoURL || "https://via.placeholder.com/40";
      this.setItem(this.keys.user, value);
    } else {
      this.clearLocal();
    }
  }

  // Internal methods for localStorage
  private setItem<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.log("An error occurred while setting localStorage item:", e);
    }
  }

  private getItem<T>(key: string): T | null {
    try {
      const value = localStorage.getItem(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (e) {
      console.log("An error occurred while getting localStorage item:", e);
      return null;
    }
  }

  // Clear all localStorage and cookies
  clearLocal = () => {
    localStorage.clear();
    Cookies.remove(this.keys.sessionId);
    Cookies.remove(this.keys.sessionToken);
    Cookies.remove(this.keys.accessToken);
    Cookies.remove(this.keys.refreshToken);
  };
}
