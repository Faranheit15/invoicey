import admin from "firebase-admin";

const parseServiceAccount = () => {
  const serviceAccountStr = process.env.FIREBASE_ADMIN_CREDENTIALS;
  if (!serviceAccountStr) {
    throw new Error("Missing FIREBASE_ADMIN_CREDENTIALS");
  }

  try {
    return JSON.parse(serviceAccountStr);
  } catch {
    try {
      const decoded = Buffer.from(serviceAccountStr, "base64").toString("utf8");
      return JSON.parse(decoded);
    } catch (error: unknown) {
      throw new Error("Invalid FIREBASE_ADMIN_CREDENTIALS", { cause: error });
    }
  }
};

export const ensureFirebaseAdmin = () => {
  if (admin.apps.length) {
    return;
  }

  const serviceAccount = parseServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
};

export default admin;
