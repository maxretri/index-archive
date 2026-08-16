import { describe, expect, it } from "vitest";
import { fileTypesForFilter } from "./files.js";

describe("library type filters", () => {
  it("keeps documents and audio in separate sections", () => {
    expect(fileTypesForFilter("photos")).toEqual(["photo"]);
    expect(fileTypesForFilter("videos")).toEqual(["video"]);
    expect(fileTypesForFilter("files")).toEqual(["document"]);
    expect(fileTypesForFilter("audio")).toEqual(["audio"]);
  });

  it("does not apply a media type to all or favorites", () => {
    expect(fileTypesForFilter("all")).toBeNull();
    expect(fileTypesForFilter("favorites")).toBeNull();
  });
});
