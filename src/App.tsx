import { Route, Routes } from "react-router";
import { AuthGate } from "./components/AuthGate";
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
import Connect4Page from "./pages/games/Connect4";
import Game2048Page from "./pages/games/Game2048";
import MinesPage from "./pages/games/Mines";
import SnakePage from "./pages/games/Snake";

export default function App() {
  return (
    <AuthGate>
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
      <Route path="games/snake" element={<SnakePage />} />
      <Route path="games/snake/:code" element={<SnakePage />} />
      <Route path="games/2048" element={<Game2048Page />} />
      <Route path="games/2048/solo" element={<Game2048Page mode="solo" />} />
      <Route path="games/2048/duel/:code" element={<Game2048Page mode="duel" />} />
      <Route path="games/mines" element={<MinesPage />} />
      <Route path="games/mines/:difficulty" element={<MinesPage />} />
      <Route path="games/connect4" element={<Connect4Page />} />
      <Route path="games/connect4/:code" element={<Connect4Page />} />
    </Routes>
    </AuthGate>
  );
}
