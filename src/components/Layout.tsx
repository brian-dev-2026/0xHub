import { NavLink, Outlet, Link } from "react-router";
import { useMe } from "../lib/auth";
import { Avatar } from "./marks";
import { IconGrid, IconHome, IconSettings, IconTrophy, IconUser } from "./icons";

const NAV = [
  { to: "/", label: "Dashboard", icon: IconHome, end: true },
  { to: "/games", label: "Games", icon: IconGrid },
  { to: "/leaderboard", label: "Ranks", icon: IconTrophy },
  { to: "/profile", label: "Profile", icon: IconUser },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid size-9 grid-cols-2 gap-[3px] rounded-xl bg-ink-800 p-[6px] ring-1 ring-white/10">
        <span className="rounded-[3px] bg-violet-500" />
        <span className="rounded-[3px] bg-cyan-400" />
        <span className="rounded-[3px] bg-lime-400/85" />
        <span className="rounded-[3px] bg-pink-400" />
      </span>
      <span className="text-lg font-bold tracking-tight">
        0x<span className="text-gradient">Hub</span>
      </span>
    </Link>
  );
}

export { Avatar };

export function Layout() {
  const profile = useMe().user;
  return (
    <div className="min-h-dvh">
      <div className="app-bg" />
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/5 bg-ink-900/60 px-4 py-6 backdrop-blur-xl lg:flex">
        <Logo className="px-2" />
        <nav className="mt-10 flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-white/8 text-white ring-1 ring-white/10" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
                }`
              }
            >
              <Icon />
              {label === "Ranks" ? "Leaderboard" : label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <Link to="/profile" className="glass flex items-center gap-3 rounded-2xl p-3 transition hover:border-violet-500/40">
            <Avatar avatar={profile.avatar} color={profile.color} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{profile.displayName}</div>
              <div className="truncate text-xs text-zinc-500">{profile.isGuest ? "Guest player" : `@${profile.username}`}</div>
            </div>
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/5 bg-ink-950/70 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Logo />
        <Link to="/profile" aria-label="Profile">
          <Avatar avatar={profile.avatar} color={profile.color} size={34} />
        </Link>
      </header>

      <main className="px-4 pt-6 pb-21 sm:px-6 lg:ml-64 lg:px-10 lg:pt-10 lg:pb-12">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-white/5 bg-ink-900/85 px-2 pt-2 pb-3 backdrop-blur-xl lg:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 text-[10px] font-medium ${isActive ? "text-violet-300" : "text-zinc-500"}`
            }
          >
            <Icon width={22} height={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
