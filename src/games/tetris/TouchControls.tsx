import type { Action } from "../../lib/store";
import type { InputController } from "./input";

const BTN =
  "grid place-items-center rounded-2xl bg-white/8 text-lg font-bold ring-1 ring-white/15 active:bg-violet-500/40 select-none touch-none";

/** On-screen controls, only shown on touch devices. */
export function TouchControls({ input }: { input: InputController }) {
  const bind = (a: Action) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      input.press(a);
    },
    onPointerUp: () => input.release(a),
    onPointerLeave: () => input.release(a),
    onPointerCancel: () => input.release(a),
  });
  return (
    <div className="mt-3 hidden w-full max-w-md grid-cols-4 gap-2 px-2 pointer-coarse:grid">
      <button className={`${BTN} h-14`} {...bind("hold")}>HOLD</button>
      <button className={`${BTN} h-14`} {...bind("ccw")}>↺</button>
      <button className={`${BTN} h-14`} {...bind("cw")}>↻</button>
      <button className={`${BTN} h-14`} {...bind("hard")}>⤓</button>
      <button className={`${BTN} h-16`} {...bind("left")}>◀</button>
      <button className={`${BTN} col-span-2 h-16`} {...bind("soft")}>▼</button>
      <button className={`${BTN} h-16`} {...bind("right")}>▶</button>
    </div>
  );
}
