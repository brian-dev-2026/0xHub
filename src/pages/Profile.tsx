import { useState } from "react";
import { useNavigate } from "react-router";
import { ACCENTS, AVATARS } from "../../shared/protocol";
import { AuthForm } from "../components/AuthGate";
import { Avatar } from "../components/Layout";
import { Card, PageHeader, SectionTitle, StatTile } from "../components/ui";
import { logout, updateProfile, useMe } from "../lib/auth";
import { fmtDuration, fmtNum } from "../lib/format";

export default function Profile() {
  const { user, stats } = useMe();
  const navigate = useNavigate();
  const [name, setName] = useState(user.displayName);
  const [status, setStatus] = useState<"" | "saving" | "saved" | string>("");

  const save = async (patch: Parameters<typeof updateProfile>[0]) => {
    setStatus("saving");
    try {
      await updateProfile(patch);
      setStatus("saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't save");
    }
  };

  const signOut = async () => {
    if (user.isGuest && !confirm("You're a guest — signing out means you can't get back into this profile. Sign out anyway?")) return;
    await logout();
    navigate("/");
  };

  return (
    <>
      <PageHeader
        title="Profile"
        subtitle="How other players see you."
        action={<button className="btn btn-ghost" onClick={signOut}>Sign out</button>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <Avatar emoji={user.avatar} color={user.color} size={88} />
              <div>
                <div className="text-xl font-bold">{user.displayName}</div>
                <div className="text-sm text-zinc-500">{user.isGuest ? "Guest player" : `@${user.username}`}</div>
              </div>
              <div className="chip">Battle rating {user.rating}</div>
            </div>
            <div className="mt-4 space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-400">Display name</label>
                <div className="flex gap-2">
                  <input
                    className="input"
                    value={name}
                    maxLength={20}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save({ displayName: name })}
                  />
                  <button className="btn btn-primary" onClick={() => save({ displayName: name })} disabled={name.trim() === user.displayName}>
                    Save
                  </button>
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-zinc-400">Avatar</div>
                <div className="grid grid-cols-8 gap-1.5">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      onClick={() => save({ avatar: a })}
                      className={`grid aspect-square place-items-center rounded-lg text-lg transition ${user.avatar === a ? "bg-violet-500/25 ring-2 ring-violet-400" : "bg-white/5 hover:bg-white/10"}`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-zinc-400">Accent color</div>
                <div className="flex flex-wrap gap-2">
                  {ACCENTS.map((c) => (
                    <button
                      key={c}
                      aria-label={c}
                      onClick={() => save({ color: c })}
                      className={`size-8 rounded-full transition ${user.color === c ? "ring-2 ring-white ring-offset-2 ring-offset-ink-900" : ""}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="h-5 text-xs">
                {status === "saving" && <span className="text-zinc-400">Saving…</span>}
                {status === "saved" && <span className="text-emerald-300">Saved</span>}
                {status && status !== "saving" && status !== "saved" && <span className="text-rose-300">{status}</span>}
              </div>
            </div>
          </Card>

          {user.isGuest && (
            <Card>
              <div className="mb-1 font-semibold">Keep your progress</div>
              <p className="mb-4 text-sm text-zinc-400">
                Guest progress only lives on this device's session. Create an account to keep your stats and play from anywhere.
              </p>
              <AuthForm upgrade />
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section>
            <SectionTitle>Endless</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile label="Best score" value={fmtNum(stats.bestScore)} accent="#8b5cf6" />
              <StatTile label="Runs" value={stats.endlessGames} accent="#6366f1" />
              <StatTile label="Lines" value={fmtNum(stats.totalLines)} accent="#a3e635" />
            </div>
          </section>
          <section>
            <SectionTitle>Battle</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Played" value={stats.battles} accent="#22d3ee" />
              <StatTile label="Wins" value={stats.wins} accent="#34d399" />
              <StatTile label="Losses" value={stats.losses} accent="#f43f5e" />
              <StatTile label="KOs" value={stats.kos} accent="#f472b6" />
            </div>
          </section>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Time played" value={fmtDuration(stats.playTimeMs)} accent="#fb923c" />
            <StatTile label="Member since" value={new Date(user.createdAt).toLocaleDateString()} accent="#60a5fa" />
          </div>
        </div>
      </div>
    </>
  );
}
