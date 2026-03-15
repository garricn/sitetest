import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveEnvVars, validateEnvVars } from "../lib/env.js";

describe("resolveEnvVars", () => {
  const env = { USER: "alice", PASSWORD: "secret123", BASE_URL: "https://example.com" };

  it("resolves $VAR in a string", () => {
    assert.equal(resolveEnvVars("$USER", env), "alice");
  });

  it("resolves multiple vars in one string", () => {
    assert.equal(resolveEnvVars("$USER:$PASSWORD", env), "alice:secret123");
  });

  it("leaves strings without $VAR unchanged", () => {
    assert.equal(resolveEnvVars("hello world", env), "hello world");
  });

  it("throws on missing var", () => {
    assert.throws(() => resolveEnvVars("$MISSING", env), /Missing env var: \$MISSING/);
  });

  it("returns non-strings unchanged", () => {
    assert.equal(resolveEnvVars(42, env), 42);
    assert.equal(resolveEnvVars(null, env), null);
  });
});

describe("validateEnvVars", () => {
  const env = { EMAIL: "a@b.com", PASSWORD: "secret" };

  it("passes when all vars present", () => {
    const steps = [
      { fill: { selector: "#email", value: "$EMAIL" } },
      { fill: { selector: "#pass", value: "$PASSWORD" } },
    ];
    assert.doesNotThrow(() => validateEnvVars(steps, env));
  });

  it("throws with all missing vars listed", () => {
    const steps = [
      { fill: { selector: "#a", value: "$MISSING_A" } },
      { fill: { selector: "#b", value: "$MISSING_B" } },
    ];
    assert.throws(() => validateEnvVars(steps, env), /\$MISSING_A.*\$MISSING_B|\$MISSING_B.*\$MISSING_A/);
  });
});
