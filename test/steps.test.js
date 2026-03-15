import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseStep } from "../lib/steps.js";

describe("parseStep", () => {
  it("parses a simple goto step", () => {
    const { type, def } = parseStep({ goto: "/login" });
    assert.equal(type, "goto");
    assert.equal(def, "/login");
  });

  it("parses a fill step with object def", () => {
    const { type, def } = parseStep({ fill: { selector: "#email", value: "test" } });
    assert.equal(type, "fill");
    assert.equal(def.selector, "#email");
    assert.equal(def.value, "test");
  });

  it("parses step with custom timeout", () => {
    const { type, timeout } = parseStep({ goto: "/slow", timeout: 60000 });
    assert.equal(type, "goto");
    assert.equal(timeout, 60000);
  });

  it("throws on step with multiple types", () => {
    assert.throws(() => parseStep({ goto: "/a", click: "#b" }), /expected exactly one step type/);
  });
});
