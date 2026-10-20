import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { mountPool } from "../../games/pool/engine";
import { reportCpuResult } from "../../lib/cpuResults";

/** Full-screen 3D pool. The engine owns everything inside the host element. */
export default function PoolPage() {
  const host = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    return mountPool(el, {
      onExit: () => navigate("/games"),
      onResult: (r) => reportCpuResult("pool", crypto.randomUUID(), r.level, r.result, r.durationMs),
    });
  }, [navigate]);

  return <div ref={host} className="fixed inset-0" />;
}
