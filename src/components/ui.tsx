import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 animate-in">
      <div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass rounded-2xl p-5 ${className}`}>{children}</div>;
}

export function StatTile({ label, value, hint, accent = "#8b5cf6" }: { label: string; value: ReactNode; hint?: ReactNode; accent?: string }) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-4">
      <div className="absolute -top-8 -right-8 size-24 rounded-full opacity-25 blur-2xl" style={{ background: accent }} />
      <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-500">{children}</div>;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-black/30 p-1 ring-1 ring-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
            value === o.value ? "bg-white/10 text-white shadow" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
