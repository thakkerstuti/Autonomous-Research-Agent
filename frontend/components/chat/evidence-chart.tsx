"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { EvidenceSource } from "@/lib/types";

export function EvidenceChart({ sources }: { sources: EvidenceSource[] }) {
  const data = sources.map((s) => ({ name: s.domain, confidence: s.confidence, color: s.color }));

  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={90}
            tick={{ fill: "var(--ink-soft)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
            formatter={(value: number) => [`${value}%`, "Confidence"]}
          />
          <Bar dataKey="confidence" radius={4} barSize={12}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
