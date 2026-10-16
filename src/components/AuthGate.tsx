import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PASSWORD_MIN, USERNAME_RE } from "../../shared/protocol";
import { BoardPreview } from "../games/tetris/Customizer";
import { authStore, loadMe, login, playAsGuest, register } from "../lib/auth";
import { Logo } from "./Layout";
import { Segmented } from "./ui";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = authStore.use();
  useEffect(() => {
    void loadMe();
  }, []);

  if (status === "signedIn") return <>{children}</>;
  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="app-bg" />
        <div className="flex flex-col items-center gap-4 text-zinc-400">
          <Logo />
          <div className="size-6 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
        </div>
      </div>
    );
  }
  if (status === "offline") {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div className="app-bg" />
        <div className="flex flex-col items-center gap-4">
          <Logo />
          <div className="text-lg font-semibold">Can't reach the 0xHub server</div>
          <p className="text-sm text-zinc-400">Check your connection and try again.</p>
          <button className="btn btn-primary" onClick={() => { authStore.set({ status: "loading", me: null }); void loadMe(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  return <Welcome />;
}

export function AuthForm({ initialMode = "login", upgrade = false }: { initialMode?: "login" | "register"; upgrade?: boolean }) {
  const [mode, setMode] = useState<"login" | "register">(upgrade ? "register" : initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register") {
      if (!USERNAME_RE.test(username)) return setError("Username must be 3–20 letters, numbers or underscores.");
      if (password.length < PASSWORD_MIN) return setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      if (password !== confirm) return setError("Passwords don't match.");
    }
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {!upgrade && (
        <div className="flex justify-center pb-1">
          <Segmented
            value={mode}
            onChange={(m) => { setMode(m); setError(""); }}
            options={[
              { value: "login", label: "Sign in" },
              { value: "register", label: "Create account" },
            ]}
          />
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-zinc-400">Username</span>
        <input className="input" autoComplete="username" value={username} maxLength={20} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-zinc-400">Password</span>
        <input
          className="input"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {mode === "register" && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-zinc-400">Confirm password</span>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
      )}
      {error && <div role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/30">{error}</div>}
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Sign in" : upgrade ? "Save my progress" : "Create account"}
      </button>
    </form>
  );
}

function Welcome() {
  const [guestBusy, setGuestBusy] = useState(false);
  const [guestError, setGuestError] = useState("");
  const guest = async () => {
    setGuestBusy(true);
    setGuestError("");
    try {
      await playAsGuest();
    } catch (e) {
      setGuestError(e instanceof Error ? e.message : "Couldn't start a guest session.");
      setGuestBusy(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="app-bg" />
      <div className="mx-auto flex max-w-5xl flex-col gap-10 lg:min-h-[calc(100vh-4rem)] lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-lg animate-in">
          <Logo />
          <h1 className="mt-8 text-4xl font-bold tracking-tight sm:text-6xl">
            Play. Compete. <span className="text-gradient">Climb.</span>
          </h1>
          <p className="mt-4 text-lg text-zinc-400">
            Real-time block-stacking duels, endless high-score runs and global leaderboards, all in your browser.
          </p>
          <div className="mt-8 hidden -rotate-2 sm:block">
            <BoardPreview skinId="neon" themeId="synthwave" cell={12} />
          </div>
        </div>

        <div className="glass w-full max-w-md rounded-3xl p-6 sm:p-8 animate-in">
          <AuthForm />
          <div className="my-5 flex items-center gap-3 text-xs text-zinc-500">
            <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
          </div>
          <button className="btn btn-ghost w-full" onClick={guest} disabled={guestBusy}>
            {guestBusy ? "Starting…" : "Play as guest"}
          </button>
          {guestError && <div className="mt-2 text-center text-sm text-rose-300">{guestError}</div>}
          <p className="mt-3 text-center text-xs text-zinc-500">
            Guest progress is saved too. Create an account any time from your profile to keep it.
          </p>
        </div>
      </div>
    </div>
  );
}
