import { describe, expect, it } from "vitest";
import { TKView } from "../src/view";
import { INHERITED_VIEW_FIELDS } from "./stubs/obsidian";

describe("TKView", () => {
  it("does not overwrite any field its base class set", () => {
    const leaf = {};
    const view = new TKView(
      leaf as never,
      {} as never,
      () => {},
    ) as unknown as Record<string, unknown>;

    for (const name of INHERITED_VIEW_FIELDS) {
      if (name === "leaf") continue;
      expect(view[name], name).toBe(`inherited:${name}`);
    }
    expect(view.leaf).toBe(leaf);
  });
});
