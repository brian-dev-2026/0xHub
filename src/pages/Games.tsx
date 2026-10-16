import { PageHeader } from "../components/ui";
import { GAMES } from "../games/registry";
import { GameCard } from "./Dashboard";

export default function Games() {
  return (
    <>
      <PageHeader title="Games" subtitle="Everything playable on 0xHub. More titles are on the way." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
      </div>
    </>
  );
}
