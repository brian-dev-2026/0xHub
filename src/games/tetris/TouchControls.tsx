import type { Action } from "../../lib/store";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconDropDown, IconRotateCCW, IconRotateCW } from "../../components/icons";
import type { InputController } from "./input";

const BTN =
  "grid place-items-center rounded-2xl bg-white/8 text-sm font-bold ring-1 ring-white/15 active:bg-violet-500/40 select-none touch-none";

/** On-screen controls, only shown on touch devices. */
export function TouchControls({ input }: { input: InputController }) {
  const bind = (a: Action, label: string) => ({
    "aria-label": label,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      input.press(a);
    },
    onPointerUp: () => input.release(a),
    onPointerLeave: () => input.release(a),
    onPointerCancel: () => input.release(a),
  });
  const icon = { width: 26, height: 26 };
  return (
    <div className="mt-3 hidden w-full max-w-md grid-cols-4 gap-2 px-2 pointer-coarse:grid">
      <button className={`${BTN} h-14`} {...bind("hold", "Hold")}>HOLD</button>
      <button className={`${BTN} h-14`} {...bind("ccw", "Rotate left")}><IconRotateCCW {...icon} /></button>
      <button className={`${BTN} h-14`} {...bind("cw", "Rotate right")}><IconRotateCW {...icon} /></button>
      <button className={`${BTN} h-14`} {...bind("hard", "Hard drop")}><IconDropDown {...icon} /></button>
      <button className={`${BTN} h-16`} {...bind("left", "Move left")}><IconChevronLeft {...icon} /></button>
      <button className={`${BTN} col-span-2 h-16`} {...bind("soft", "Soft drop")}><IconChevronDown {...icon} /></button>
      <button className={`${BTN} h-16`} {...bind("right", "Move right")}><IconChevronRight {...icon} /></button>
    </div>
  );
}
