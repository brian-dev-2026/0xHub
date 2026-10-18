// Avatars are block shapes drawn with CSS (no emoji, no images): the seven
// tetrominoes plus nine pentominoes, tinted with the player's accent color.
// Each shape is a list of [x, y] cells on a small grid.

export interface AvatarShape {
  id: string;
  name: string;
  cells: [number, number][];
}

export const AVATAR_SHAPES: AvatarShape[] = [
  { id: "t-T", name: "T", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: "t-I", name: "I", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: "t-O", name: "O", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: "t-S", name: "S", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { id: "t-Z", name: "Z", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { id: "t-J", name: "J", cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { id: "t-L", name: "L", cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: "p-X", name: "Plus", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: "p-U", name: "U", cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: "p-V", name: "V", cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
  { id: "p-W", name: "W", cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
  { id: "p-F", name: "F", cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]] },
  { id: "p-P", name: "P", cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]] },
  { id: "p-N", name: "N", cells: [[1, 0], [1, 1], [0, 2], [1, 2], [0, 3]] },
  { id: "p-Y", name: "Y", cells: [[1, 0], [0, 1], [1, 1], [1, 2], [1, 3]] },
  { id: "p-L", name: "Long L", cells: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]] },
];

/** Avatar ids a user may pick. "none" is reserved for deleted / unknown players. */
export const AVATARS = AVATAR_SHAPES.map((s) => s.id);
export const NO_AVATAR = "none";

export function avatarShape(id: string): AvatarShape | null {
  return AVATAR_SHAPES.find((s) => s.id === id) ?? null;
}
