import { useEffect, useState } from "react";
import { Card, PageHeader, Segmented } from "../components/ui";
import { Customizer } from "../games/tetris/Customizer";
import { sfx } from "../lib/sfx";
import { ACTION_LABELS, DEFAULT_KEYS, settingsStore, type Action } from "../lib/store";

type Tab = "appearance" | "controls" | "handling" | "audio";

function keyLabel(code: string): string {
  const map: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Space: "Space",
    ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ControlLeft: "L-Ctrl", ControlRight: "R-Ctrl",
    Escape: "Esc", Enter: "Enter", AltLeft: "L-Alt", AltRight: "R-Alt",
  };
  return map[code] ?? code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ");
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>("appearance");
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Make 0xHub feel like yours. Changes save automatically."
        action={
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "appearance", label: "Look" },
              { value: "controls", label: "Keys" },
              { value: "handling", label: "Handling" },
              { value: "audio", label: "Audio" },
            ]}
          />
        }
      />
      <Card className="animate-in">
        {tab === "appearance" && <Customizer cell={18} />}
        {tab === "controls" && <Controls />}
        {tab === "handling" && <Handling />}
        {tab === "audio" && <Audio />}
      </Card>
    </>
  );
}

function Controls() {
  const settings = settingsStore.use();
  const [listening, setListening] = useState<{ action: Action; slot: number } | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.code === "Escape" && listening.action !== "pause") {
        setListening(null);
        return;
      }
      const keys = structuredClone(settings.keys);
      // A key can only be bound to one action.
      for (const a of Object.keys(keys) as Action[]) keys[a] = keys[a].filter((k) => k !== e.code);
      const list = [...keys[listening.action]];
      list[listening.slot] = e.code;
      keys[listening.action] = list.filter(Boolean);
      settingsStore.set({ keys });
      setListening(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [listening, settings.keys]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-400">Click a slot, then press a key. Each action can have two keys.</p>
        <button className="btn btn-ghost text-xs" onClick={() => settingsStore.set({ keys: DEFAULT_KEYS })}>Reset to defaults</button>
      </div>
      <div className="divide-y divide-white/5">
        {(Object.keys(ACTION_LABELS) as Action[]).map((a) => (
          <div key={a} className="flex items-center justify-between gap-4 py-3">
            <span className="text-sm font-medium">{ACTION_LABELS[a]}</span>
            <div className="flex gap-2">
              {[0, 1].map((slot) => {
                const code = settings.keys[a][slot];
                const active = listening?.action === a && listening.slot === slot;
                return (
                  <button
                    key={slot}
                    onClick={() => setListening({ action: a, slot })}
                    className={`min-w-24 rounded-lg border px-3 py-1.5 font-mono text-xs transition ${
                      active ? "border-violet-400 bg-violet-500/20 text-violet-100" : "border-white/10 bg-black/30 hover:border-white/25"
                    }`}
                  >
                    {active ? "Press a key…" : code ? keyLabel(code) : "—"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit,
  display,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  display?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-zinc-500">{hint}</div>
        </div>
        <div className="font-mono text-sm font-bold">{display ?? `${value}${unit ?? ""}`}</div>
      </div>
      <input type="range" className="w-full accent-violet-500" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Handling() {
  const s = settingsStore.use();
  return (
    <div className="divide-y divide-white/5">
      <Slider label="DAS — Delayed Auto Shift" hint="How long to hold left/right before the piece starts sliding." value={s.das} min={50} max={300} unit="ms" onChange={(das) => settingsStore.set({ das })} />
      <Slider label="ARR — Auto Repeat Rate" hint="Time between each step while sliding. 0 = instant to wall." value={s.arr} min={0} max={80} unit="ms" onChange={(arr) => settingsStore.set({ arr })} />
      <Slider label="Soft drop speed" hint="Multiplier of normal gravity while holding soft drop." value={s.sdf} min={5} max={41} display={s.sdf >= 41 ? "Instant" : `${s.sdf}×`} onChange={(sdf) => settingsStore.set({ sdf: sdf >= 41 ? 2000 : sdf })} />
      <div className="py-4">
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-4 accent-violet-500" checked={s.reducedMotion} onChange={(e) => settingsStore.set({ reducedMotion: e.target.checked })} />
          Reduce motion (disables line-clear flash)
        </label>
      </div>
      <div className="pt-4">
        <button className="btn btn-ghost text-xs" onClick={() => settingsStore.set({ das: 133, arr: 10, sdf: 20 })}>Reset handling</button>
      </div>
    </div>
  );
}

function Audio() {
  const s = settingsStore.use();
  return (
    <div>
      <Slider label="Sound effects volume" hint="Synthesized SFX for moves, clears, garbage and KOs." value={Math.round(s.volume * 100)} min={0} max={100} unit="%" onChange={(v) => settingsStore.set({ volume: v / 100 })} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost text-xs" onClick={() => sfx.tetris()}>Test: Quad</button>
        <button className="btn btn-ghost text-xs" onClick={() => sfx.tspin()}>Test: T-Spin</button>
        <button className="btn btn-ghost text-xs" onClick={() => sfx.ko()}>Test: KO</button>
      </div>
    </div>
  );
}
