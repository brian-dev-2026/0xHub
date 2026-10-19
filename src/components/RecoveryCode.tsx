import { useEffect, useRef, useState } from "react";
import { recoveryCodeStore } from "../lib/auth";
import { Check } from "./marks";

/**
 * Shows a freshly issued recovery code once. The server only keeps a hash,
 * so this is the player's only chance to save it.
 */
export function RecoveryCodeDialog() {
  const { code } = recoveryCodeStore.use();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (code && !d.open) {
      setSaved(false);
      setCopied(false);
      d.showModal();
    } else if (!code && d.open) d.close();
  }, [code]);

  const close = () => recoveryCodeStore.set({ code: null });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code ?? "");
      setCopied(true);
    } catch {
      /* clipboard blocked: the code is still selectable */
    }
  };

  const download = () => {
    const text = `0xHub recovery code\n\n${code}\n\nUse it with your username on the sign-in screen ("Forgot password?") to set a new password.\nEach code works once; you'll get a new one after using it.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "0xhub-recovery-code.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <dialog
      ref={ref}
      // Escape would dismiss it before the player confirmed saving the code.
      onCancel={(e) => e.preventDefault()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-3xl border border-white/10 bg-ink-900 p-0 text-zinc-100 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      aria-labelledby="recovery-title"
    >
      {code && (
        <div className="space-y-4 p-6">
          <div>
            <h2 id="recovery-title" className="text-xl font-bold">Save your recovery code</h2>
            <p className="mt-1 text-sm text-zinc-400">
              If you forget your password, this code is the only way back into your account. It's shown once: we only keep a scrambled copy.
            </p>
          </div>
          <div className="rounded-xl bg-white/5 px-4 py-4 text-center font-mono text-lg font-bold tracking-wider break-all select-all ring-1 ring-white/10" data-testid="recovery-code">
            {code}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost flex-1" onClick={copy}>
              {copied ? <><Check className="text-emerald-300" />Copied</> : "Copy"}
            </button>
            <button type="button" className="btn btn-ghost flex-1" onClick={download}>Download .txt</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" className="size-4 accent-violet-500" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I've saved it somewhere safe
          </label>
          <button type="button" className="btn btn-primary w-full" disabled={!saved} onClick={close}>Done</button>
        </div>
      )}
    </dialog>
  );
}
