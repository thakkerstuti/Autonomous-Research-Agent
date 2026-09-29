import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

// Demo SSE producer. Replace the step payloads below with real events
// forwarded from the Python agent service (search hits, evidence, critique).
function buildSteps(mode: string, query: string) {
  if (mode === "paper") {
    return [
      { type: "step", label: "Reading the paper", detail: `Parsed "${query}" across its sections, figures, and equations.` },
      { type: "step", label: "Extracting key concepts", detail: "Identified the ideas worth explaining first." },
      {
        type: "done",
        answer: `"${query}" is ready. Ask about any section, or say "simpler" for a plainer explanation.`,
      },
    ];
  }
  return [
    { type: "step", label: "Searching the web", detail: `Collected the latest sources related to "${query}".` },
    {
      type: "sources",
      label: "Reviewing sources",
      sources: [
        { name: "Primary research report", domain: "NBER", confidence: 82, color: "#4C6EF5" },
        { name: "Industry analysis", domain: "HBR", confidence: 74, color: "#E8590C" },
        { name: "Field survey data", domain: "Gallup", confidence: 68, color: "#2F9E44" },
        { name: "Market outlook", domain: "McKinsey", confidence: 71, color: "#9C36B5" },
      ],
    },
    { type: "step", label: "Checking for contradictions", detail: "Flagged a disagreement between two sources and resolved it by comparing methodology." },
    { type: "step", label: "Self-critique complete", detail: "One overly broad claim was rewritten with the correct qualification." },
    {
      type: "done",
      answer: `Here's what the evidence supports on "${query}": the effect is real but smaller and more conditional than headlines suggest.`,
    },
  ];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") ?? "research";
  const q = searchParams.get("q") ?? "your question";
  const steps = buildSteps(mode, q);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, 700));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
