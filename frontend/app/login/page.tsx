import type { Metadata } from "next";
import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = {
  title: "Sign In — CogNexa AI",
  description: "Sign in to access your dual-mode research and paper intelligence workspace.",
};

export default function LoginPage() {
  return <AuthView mode="login" />;
}
