"use client";

import { useReportQuery } from "@/lib/queries";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EvidenceChart } from "@/components/chat/evidence-chart";

export default function ReportPage() {
  const { data: report, isLoading } = useReportQuery();

  if (isLoading || !report) {
    return <p className="p-10 text-sm text-ink-faint">Loading report…</p>;
  }

  const citationIndex = (id: string) => report.citations.findIndex((c) => c.id === id) + 1;

  return (
    <div className="animate-view-in h-full overflow-y-auto px-10 py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs text-ink-faint">Research Report · updated {report.updated}</p>
        <h1 className="mt-1 font-serif text-2xl font-semibold">{report.question}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">{report.summary}</p>

        <section className="mt-8">
          <h2 className="mb-3 font-serif text-base font-semibold">Findings</h2>
          <div className="flex flex-col gap-3">
            {report.findings.map((f) => (
              <Card key={f.id} className="flex items-start gap-4">
                <div className="flex-1">
                  <p className="text-sm text-ink">{f.text}</p>
                  <div className="mt-2 flex gap-1.5">
                    {f.citationIds.map((cid) => (
                      <a
                        key={cid}
                        href={`#${cid}`}
                        className="rounded-md border border-line px-1.5 text-xs text-ink-soft hover:border-grad2 hover:text-ink"
                      >
                        [{citationIndex(cid)}]
                      </a>
                    ))}
                  </div>
                </div>
                <Badge variant={f.confidence >= 75 ? "ready" : f.confidence >= 60 ? "default" : "review"}>
                  {f.confidence}% confidence
                </Badge>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>Evidence strength by source</CardTitle>
            </CardHeader>
            <EvidenceChart sources={report.sources} />
          </Card>
        </section>

        <section className="mt-8 pb-6">
          <h2 className="mb-3 font-serif text-base font-semibold">Citations</h2>
          <div className="divide-y divide-line border-t border-line">
            {report.citations.map((c, i) => (
              <div key={c.id} id={c.id} className="flex gap-3 py-3.5">
                <span className="w-6 text-sm text-ink-faint">[{i + 1}]</span>
                <div>
                  <div className="text-sm font-medium">{c.title}</div>
                  <CardContent className="text-xs">
                    {c.domain} · {c.note}
                  </CardContent>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
