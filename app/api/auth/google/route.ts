import { NextRequest, NextResponse } from "next/server";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";

// Initialize Firebase Admin SDK only once
if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS!)),
  });
}

export async function POST(req: NextRequest) {
  try {
    await connectDB();

    const { idToken } = await req.json();
    if (!idToken) {
      return NextResponse.json({ error: "ID token is required" }, { status: 400 });
    }

    const decodedToken = await getAuth().verifyIdToken(idToken);
    if (!decodedToken) {
      return NextResponse.json({ error: "Invalid ID token" }, { status: 401 });
    }

    const { uid, email, picture } = decodedToken;
    const name = decodedToken.name || decodedToken.displayName || "Unknown User";
    const photoURL = picture || "https://via.placeholder.com/40"; // Fallback avatar

    // Extract access and refresh tokens
    const accessToken =
      decodedToken.firebase?.sign_in_provider === "google.com"
        ? idToken // Use ID token as accessToken
        : "";
    const refreshToken = ""; // Firebase Admin SDK does not provide a refresh token

    // Store user in MongoDB
    const user = await User.findOneAndUpdate(
      { uid },
      { name, email, avatar: photoURL, providerId: "google.com", accessToken, refreshToken, lastLoginAt: new Date() },
      { new: true, upsert: true }
    );

    const sessionToken = jwt.sign({ uid, email }, process.env.JWT_SECRET!, { expiresIn: "7d" });

    return NextResponse.json({ sessionToken, user, accessToken, refreshToken });
  } catch (error) {
    console.error("❌ Google Auth API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
