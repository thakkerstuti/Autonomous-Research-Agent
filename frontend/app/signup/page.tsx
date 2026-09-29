import type { Metadata } from "next";
import { AuthView } from "@/components/auth/auth-view";

export const metadata: Metadata = {
  title: "Create Account — CogNexa AI",
  description: "Join CogNexa to investigate open questions and analyze research papers with verifiable AI.",
};

export default function SignUpPage() {
  return <AuthView mode="signup" />;
}
