import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "CogNexa — Research you can check, line by line",
  description:
    "An autonomous research agent that tests hypotheses, verifies every quote against its source and writes cited reports. Study papers page by page.",
};

export default function Home() {
  return <LandingPage />;
}
