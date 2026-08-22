"use client"

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

export function RevenueChart({ data }: { data: { date: string; amount: number }[] }) {
  const chartData = data.map((d) => ({ date: d.date.slice(5), pesos: d.amount / 100 }))

  if (chartData.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No revenue in this range yet.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
        <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={48} tickFormatter={(v) => `₱${v}`} />
        <Tooltip
          formatter={(value) => [`₱${Number(value).toFixed(2)}`, "Revenue"]}
          labelClassName="text-foreground"
          contentStyle={{ fontSize: 12, background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
        />
        <Bar dataKey="pesos" fill="var(--brand)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
