import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Games from "./pages/Games";
import TetrisHome from "./pages/TetrisHome";
import TetrisEndless from "./pages/TetrisEndless";
import TetrisBattle from "./pages/TetrisBattle";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="games" element={<Games />} />
        <Route path="games/tetris" element={<TetrisHome />} />
        <Route path="leaderboard" element={<Leaderboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
      {/* Full-screen game views (no sidebar) */}
      <Route path="games/tetris/endless" element={<TetrisEndless />} />
      <Route path="games/tetris/battle" element={<TetrisBattle />} />
      <Route path="games/tetris/battle/:code" element={<TetrisBattle />} />
    </Routes>
  );
}
