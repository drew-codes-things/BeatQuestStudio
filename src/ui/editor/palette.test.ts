import { describe, expect, it } from "vitest";
import { COLORS, paletteFor } from "./timelineDraw";

describe("note palette", () => {
  it("uses the editor's red and blue when the map has no saber colours", () => {
    expect(paletteFor(undefined)).toEqual({ red: COLORS.red, blue: COLORS.blue });
    expect(paletteFor(null)).toEqual({ red: COLORS.red, blue: COLORS.blue });
  });

  it("paints left notes in the left saber colour and right notes in the right", () => {
    expect(paletteFor({ left: "#ff8000", right: "#00ff80" })).toEqual({ red: "#ff8000", blue: "#00ff80" });
  });

  it("falls back to the editor colours for anything that is not #rrggbb", () => {
    expect(paletteFor({ left: "javascript:x", right: "#00ff80" })).toEqual({ red: COLORS.red, blue: "#00ff80" });
  });
});
