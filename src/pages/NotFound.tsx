import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <div className="font-mono text-6xl font-bold text-gradient">404</div>
      <p className="text-zinc-400">This block didn't land anywhere.</p>
      <Link to="/" className="btn btn-primary">Back to dashboard</Link>
    </div>
  );
}
