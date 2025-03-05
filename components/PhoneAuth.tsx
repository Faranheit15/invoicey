import { useState } from "react";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";

export default function PhoneAuth() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmation, setConfirmation] = useState<any>(null);

  const auth = getAuth();
  auth.settings.appVerificationDisabledForTesting = true; // Remove for production

  const sendOtp = async () => {
    const verifier = new RecaptchaVerifier("recaptcha", { size: "invisible" }, auth);
    const confirmation = await signInWithPhoneNumber(auth, phone, verifier);
    setConfirmation(confirmation);
  };

  const verifyOtp = async () => {
    await confirmation.confirm(otp);
    alert("User signed in!");
  };

  return (
    <div>
      <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
      <button onClick={sendOtp}>Send OTP</button>
      <input type="text" value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter OTP" />
      <button onClick={verifyOtp}>Verify OTP</button>
      <div id="recaptcha"></div>
    </div>
  );
}
