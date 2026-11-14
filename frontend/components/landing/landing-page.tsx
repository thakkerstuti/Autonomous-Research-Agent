"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowDown, Github } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";
import { cn } from "@/lib/utils";
import { SceneCanvas } from "./scene-canvas";

const STEPS = [
  {
    key: "Ask",
    title: "Ask an open question",
    body: "Type it the way you would ask a colleague. Choose a quick answer, a detailed explanation or a full cited report.",
  },
  {
    key: "Plan",
    title: "It forms hypotheses",
    body: "The agent turns your question into testable claims, so the evidence has something specific to support or refute.",
  },
  {
    key: "Search",
    title: "It searches in rounds",
    body: "Up to three rounds of web searches. Where the evidence is thin, it rewrites the query and looks again.",
  },
  {
    key: "Verify",
    title: "It checks every quote",
    body: "Each quote is matched against the original page. Supporting, refuting and conflicting evidence stay separate instead of being averaged away.",
  },
  {
    key: "Report",
    title: "You get a report you can audit",
    body: "It critiques its own draft, then writes the answer with a citation on every claim. Each one opens the source at the quoted passage.",
  },
];

const MAX_STAGE = 5.25;

/* ───────────── 3D stage ───────────── */

function useSceneMode() {
  const [mode, setMode] = useState<"scroll" | "static">("scroll");
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 767px)");
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setReduced(rm.matches);
      setMode(narrow.matches || rm.matches ? "static" : "scroll");
    };
    apply();
    narrow.addEventListener("change", apply);
    rm.addEventListener("change", apply);
    return () => {
      narrow.removeEventListener("change", apply);
      rm.removeEventListener("change", apply);
    };
  }, []);
  return { mode, reduced };
}

/* ───────────── Page ───────────── */

export function LandingPage() {
  const { mode, reduced } = useSceneMode();
  const storyRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState(-1); // -1 = hero, 0..4 = steps
  const [scrolled, setScrolled] = useState(false);

  const getStage = useCallback(() => {
    if (mode !== "scroll") return 0;
    const el = storyRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const total = r.height - window.innerHeight;
    const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
    return p * MAX_STAGE;
  }, [mode]);

  // Which step's words are showing (changes only at thresholds, so text isn't re-rendered per frame)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const st = getStage();
      const next = st < 0.55 ? -1 : Math.min(4, Math.max(0, Math.round(st) - 1));
      setActive((a) => (a === next ? a : next));
      setScrolled(window.scrollY > 12);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [getStage]);

  const goToStep = (i: number) => {
    const el = storyRef.current;
    if (!el || mode !== "scroll") {
      document.getElementById("how-it-works")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      return;
    }
    const total = el.offsetHeight - window.innerHeight;
    const y = el.offsetTop + ((i + 1) / MAX_STAGE) * total;
    window.scrollTo({ top: y, behavior: reduced ? "auto" : "smooth" });
  };

  const heroCopy = (
    <>
      <h1 className="font-display text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[64px] lg:text-[76px]">
        Research you can
        <br />
        check, line by line.
      </h1>
      <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-ink-soft sm:text-[18px]">
        CogNexa is an autonomous research agent. Ask an open question and it tests hypotheses against the literature,
        verifies every quote at its source and writes a report with citations you can open.
      </p>
      <div className="mt-9 flex flex-wrap items-center gap-3">
        <Link
          href="/login"
          className="pressable group inline-flex h-12 items-center gap-2 rounded-[13px] bg-primary px-5 text-[15px] font-semibold text-on-primary hover:bg-primary/90"
        >
          Open CogNexa
          <ArrowRight size={16} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
        </Link>
        <button
          onClick={() => goToStep(0)}
          className="pressable inline-flex h-12 items-center gap-2 rounded-[13px] border border-line-hover px-5 text-[15px] font-medium text-ink hover:bg-white/[0.04]"
        >
          See how it works <ArrowDown size={15} />
        </button>
      </div>
      <p className="mt-8 text-[13px] text-ink-faint">
        Up to three search rounds · Quotes checked against the original page · Self-critiqued before you read it
      </p>
    </>
  );

  return (
    <div className="landing min-h-[100dvh] bg-bg text-ink">
      {/* Navigation */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300",
          scrolled ? "border-b border-line bg-bg/75 backdrop-blur-xl" : "border-b border-transparent"
        )}
      >
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">
          Skip to content
        </a>
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between px-5 sm:px-10">
          <Link href="/" className="flex items-center gap-2.5 text-ink" aria-label="CogNexa home">
            <BrandMark size={22} />
            <span className="font-display text-[17px] font-semibold tracking-[-0.03em]">CogNexa</span>
          </Link>
          <nav className="flex items-center gap-2">
            <button onClick={() => goToStep(0)} className="hidden h-10 rounded-[11px] px-3.5 text-[14px] text-ink-soft transition-colors hover:text-ink sm:block">
              How it works
            </button>
            <Link
              href="/login"
              className="pressable group inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-primary px-4 text-[14px] font-semibold text-on-primary hover:bg-primary/90"
            >
              Open CogNexa
              <ArrowRight size={15} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        {mode === "scroll" ? (
          /* ── Hero + how it works: one sticky 3D stage driven by the scroll ── */
          <section ref={storyRef} id="how-it-works" aria-labelledby="hero-title" className="relative" style={{ height: "640vh" }}>
            <div className="sticky top-0 h-[100dvh] overflow-hidden">
              <SceneCanvas getStage={getStage} reduced={reduced} mobile={false} />
              {/* Keeps the copy readable where the network passes behind it */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-[62%] bg-gradient-to-r from-bg/85 via-bg/45 to-transparent" aria-hidden />

              {/* Hero words */}
              <div
                className={cn(
                  "absolute inset-0 flex items-center transition-[opacity,transform,filter] duration-500 ease-out",
                  active === -1 ? "opacity-100" : "pointer-events-none -translate-y-4 opacity-0 blur-[6px]"
                )}
              >
                <div className="stagger mx-auto w-full max-w-[1320px] px-5 sm:px-10" id="hero-title">
                  <div className="max-w-[640px]">{heroCopy}</div>
                </div>
              </div>

              {/* Step words — let clicks through to the hero while it is showing */}
              <div className={cn("absolute inset-0 flex items-center", active === -1 && "pointer-events-none")}>
                <div className="mx-auto grid w-full max-w-[1320px] grid-cols-[140px_minmax(0,460px)] gap-10 px-5 sm:px-10">
                  <ol aria-label="Steps" className={cn("relative flex flex-col gap-1 transition-opacity duration-500", active >= 0 ? "opacity-100" : "pointer-events-none opacity-0")}>
                    <span className="absolute bottom-2 left-[5px] top-2 w-px bg-line" aria-hidden />
                    <span
                      className="absolute left-[5px] top-2 w-px origin-top bg-accent transition-transform duration-500 ease-out"
                      style={{ height: "calc(100% - 16px)", transform: `scaleY(${Math.max(0, active) / 4})` }}
                      aria-hidden
                    />
                    {STEPS.map((s, i) => (
                      <li key={s.key}>
                        <button
                          onClick={() => goToStep(i)}
                          aria-current={active === i ? "step" : undefined}
                          className={cn("group flex h-9 items-center gap-3 text-[14px] transition-colors", active === i ? "text-ink" : "text-ink-faint hover:text-ink-soft")}
                        >
                          <span
                            className={cn(
                              "relative z-10 h-[11px] w-[11px] rounded-full border transition-[background-color,border-color,transform] duration-300",
                              active >= i ? "scale-100 border-accent bg-accent" : "scale-90 border-line-hover bg-bg"
                            )}
                          />
                          {s.key}
                        </button>
                      </li>
                    ))}
                  </ol>

                  <div className="relative min-h-[260px]">
                    {STEPS.map((s, i) => (
                      <div
                        key={s.key}
                        aria-hidden={active !== i}
                        className={cn(
                          "absolute inset-x-0 top-0 transition-[opacity,transform,filter] duration-500 ease-out",
                          active === i ? "opacity-100" : active > i ? "pointer-events-none -translate-y-5 opacity-0 blur-[5px]" : "pointer-events-none translate-y-5 opacity-0 blur-[5px]"
                        )}
                      >
                        <div className="mono text-[13px] text-accent">
                          {String(i + 1).padStart(2, "0")} / 05
                        </div>
                        <h2 className="mt-4 font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink">{s.title}</h2>
                        <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">{s.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : (
          /* ── Phones and reduced motion: still neuron, steps as a list ── */
          <>
            <section aria-labelledby="hero-title-static" className="relative flex min-h-[100dvh] items-end overflow-hidden pb-14 pt-24">
              <SceneCanvas getStage={getStage} reduced={reduced} mobile />
              <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg via-bg/80 to-transparent" aria-hidden />
              <div className="stagger relative mx-auto w-full max-w-[1320px] px-5 sm:px-10" id="hero-title-static">
                {heroCopy}
              </div>
            </section>
            <section id="how-it-works" aria-labelledby="steps-title" className="mx-auto max-w-[1320px] px-5 py-20 sm:px-10">
              <h2 id="steps-title" className="font-display text-[34px] font-semibold tracking-[-0.04em] text-ink">How the agent works</h2>
              <ol className="mt-10 grid gap-10">
                {STEPS.map((s, i) => (
                  <li key={s.key} className="grid grid-cols-[44px_1fr] gap-4 border-t border-line pt-6">
                    <span className="mono text-[13px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <h3 className="font-display text-[22px] font-semibold tracking-[-0.03em] text-ink">{s.title}</h3>
                      <p className="mt-2 text-[16px] leading-relaxed text-ink-soft">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}

        {/* ── The product ── */}
        <section aria-labelledby="modes-title" className="mx-auto max-w-[1320px] px-5 py-24 sm:px-10 sm:py-32">
          <h2 id="modes-title" className="max-w-[18ch] font-display text-[36px] font-semibold leading-[1.05] tracking-[-0.04em] text-ink sm:text-[52px]">
            One workspace for questions and papers.
          </h2>

          <div className="mt-16 grid gap-24">
            <Feature
              title="Research mode"
              body="A conversation with the agent. Answers arrive as cited reports, with the sources, the hypotheses and the agent's own self-critique one click away."
              src="/landing/research.png"
              alt="CogNexa research mode showing a cited answer"
            />
            <Feature
              flip
              title="Paper study"
              body="Upload a PDF and it is summarised page by page at the level you choose. Spread the pages on a canvas, side by side, and keep the whole argument in view."
              src="/landing/paper-study.png"
              alt="CogNexa paper study canvas with page summaries side by side"
            />
            <Feature
              title="Your overview"
              body="What you have investigated, which hypotheses held up, how much of each paper is read and what to do next. Built from your own work, never invented."
              src="/landing/overview.png"
              alt="CogNexa overview with investigations, progress and activity"
            />
          </div>
        </section>

        {/* ── Close ── */}
        <section aria-labelledby="close-title" className="border-t border-line">
          <div className="mx-auto flex max-w-[1320px] flex-col items-start gap-10 px-5 py-24 sm:px-10 sm:py-32 lg:flex-row lg:items-end lg:justify-between">
            <h2 id="close-title" className="max-w-[14ch] font-display text-[44px] font-semibold leading-[1] tracking-[-0.045em] text-ink sm:text-[72px]">
              Ask your first question.
            </h2>
            <Link
              href="/login"
              className="pressable group inline-flex h-12 items-center gap-2 rounded-[13px] bg-primary px-5 text-[15px] font-semibold text-on-primary hover:bg-primary/90"
            >
              Open CogNexa
              <ArrowRight size={16} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-col gap-4 px-5 py-8 text-[13px] text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <span className="flex items-center gap-2 text-ink-soft">
            <BrandMark size={16} /> CogNexa
          </span>
          <span>Built by Stuti Thakker and Vanshika Sultania</span>
          <a
            href="https://github.com/thakkerstuti/Autonomous-Research-Agent"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-ink"
          >
            <Github size={14} /> Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

function Feature({ title, body, src, alt, flip }: { title: string; body: string; src: string; alt: string; flip?: boolean }) {
  return (
    <div className={cn("grid items-center gap-10 lg:grid-cols-[minmax(0,380px)_1fr] lg:gap-16", flip && "lg:grid-cols-[1fr_minmax(0,380px)]")}>
      <div className={cn(flip && "lg:order-2")}>
        <h3 className="font-display text-[28px] font-semibold tracking-[-0.035em] text-ink">{title}</h3>
        <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">{body}</p>
      </div>
      <div className="group overflow-hidden rounded-[18px] border border-line bg-surface shadow-panel">
        <div className="flex h-9 items-center gap-1.5 border-b border-line px-4" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        </div>
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="block w-full transition-transform duration-500 ease-out group-hover:scale-[1.015]"
        />
      </div>
    </div>
  );
}
