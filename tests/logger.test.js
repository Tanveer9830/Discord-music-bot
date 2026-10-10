import test from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/utils/logger.js";

test("logger redacts structured secrets, free-form authorization values, and bot tokens", () => {
  let output = "";
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (line) => { output += line; };
  console.error = (line) => { output += line; };
  try {
    const logger = createLogger("debug");
    logger.warn("Authorization: secret value", {
      token: "structured-token-secret",
      password: "structured-password-secret",
      nested: { Authorization: "nested-authorization-secret" },
      error: new Error("request failed; authorization: exception-secret"),
    });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.match(output, /Authorization:\[REDACTED\]/);
  assert.match(output, /"token":"\[REDACTED\]"/);
  assert.match(output, /"password":"\[REDACTED\]"/);
  for (const secret of ["secret value", "structured-token-secret", "structured-password-secret", "nested-authorization-secret", "exception-secret"]) {
    assert.ok(!output.includes(secret), `logger leaked ${secret}`);
  }
});
