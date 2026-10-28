import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envQuote } from "../src/setup.ts";

describe("envQuote", () => {
  it("round-trips awkward passwords through Node's .env parser", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-env-"));
    for (const value of ["plain", "has spaces # and hash", "it's", `say "hi"`, `both ' and "`, "$HOME=\\n"]) {
      const file = join(dir, ".env");
      writeFileSync(file, `CC_TEST_VALUE=${envQuote(value)}\n`);
      delete process.env.CC_TEST_VALUE;
      process.loadEnvFile(file);
      expect(process.env.CC_TEST_VALUE).toBe(value);
    }
  });

  it("refuses values it can't store safely", () => {
    expect(() => envQuote("a\nb")).toThrow(/line breaks/);
    expect(() => envQuote(`' " \``)).toThrow(/quote/);
  });
});

describe("shadowingEnvFiles", () => {
  it("lists login files that would be read before the one setup writes", async () => {
    const { shadowingEnvFiles } = await import("../src/setup.ts");
    const dir = mkdtempSync(join(tmpdir(), "cc-shadow-"));
    const clone = join(dir, ".env");
    expect(shadowingEnvFiles(clone)).toEqual([]);
    writeFileSync(clone, "X=1\n");
    expect(shadowingEnvFiles(clone)).toEqual([clone]);
  });
});
