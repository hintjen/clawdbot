import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  normalizeMatrixAccessToken,
  normalizeMatrixCredential,
  normalizeMatrixPassword,
  resolveMatrixCredentials,
} from "./token.js";

describe("normalizeMatrixCredential", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeMatrixCredential(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeMatrixCredential("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeMatrixCredential("   ")).toBeUndefined();
  });

  it("returns undefined for tab-only string", () => {
    expect(normalizeMatrixCredential("\t\t")).toBeUndefined();
  });

  it("returns undefined for newline-only string", () => {
    expect(normalizeMatrixCredential("\n\n")).toBeUndefined();
  });

  it("trims leading whitespace", () => {
    expect(normalizeMatrixCredential("  token123")).toBe("token123");
  });

  it("trims trailing whitespace", () => {
    expect(normalizeMatrixCredential("token123  ")).toBe("token123");
  });

  it("trims both leading and trailing whitespace", () => {
    expect(normalizeMatrixCredential("  token123  ")).toBe("token123");
  });

  it("preserves internal whitespace", () => {
    expect(normalizeMatrixCredential("token with spaces")).toBe("token with spaces");
  });

  it("handles complex whitespace", () => {
    expect(normalizeMatrixCredential(" \t token \n ")).toBe("token");
  });
});

describe("normalizeMatrixAccessToken", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeMatrixAccessToken(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeMatrixAccessToken("")).toBeUndefined();
  });

  it("trims whitespace from token", () => {
    expect(normalizeMatrixAccessToken("  syt_abc123  ")).toBe("syt_abc123");
  });

  it("returns token unchanged if no whitespace", () => {
    expect(normalizeMatrixAccessToken("syt_abc123")).toBe("syt_abc123");
  });
});

describe("normalizeMatrixPassword", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeMatrixPassword(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeMatrixPassword("")).toBeUndefined();
  });

  it("trims whitespace from password", () => {
    expect(normalizeMatrixPassword("  secretpass  ")).toBe("secretpass");
  });

  it("returns password unchanged if no whitespace", () => {
    expect(normalizeMatrixPassword("secretpass")).toBe("secretpass");
  });
});

describe("resolveMatrixCredentials", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.MATRIX_ACCESS_TOKEN = process.env.MATRIX_ACCESS_TOKEN;
    savedEnv.MATRIX_PASSWORD = process.env.MATRIX_PASSWORD;
    delete process.env.MATRIX_ACCESS_TOKEN;
    delete process.env.MATRIX_PASSWORD;
  });

  afterEach(() => {
    if (savedEnv.MATRIX_ACCESS_TOKEN !== undefined) {
      process.env.MATRIX_ACCESS_TOKEN = savedEnv.MATRIX_ACCESS_TOKEN;
    } else {
      delete process.env.MATRIX_ACCESS_TOKEN;
    }
    if (savedEnv.MATRIX_PASSWORD !== undefined) {
      process.env.MATRIX_PASSWORD = savedEnv.MATRIX_PASSWORD;
    } else {
      delete process.env.MATRIX_PASSWORD;
    }
  });

  describe("with no credentials", () => {
    it("returns none sources when no credentials provided", () => {
      const result = resolveMatrixCredentials({});
      expect(result.accessToken).toBeUndefined();
      expect(result.password).toBeUndefined();
      expect(result.accessTokenSource).toBe("none");
      expect(result.passwordSource).toBe("none");
    });

    it("returns none sources when allowEnv is false and no config", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      const result = resolveMatrixCredentials({ allowEnv: false });
      expect(result.accessToken).toBeUndefined();
      expect(result.accessTokenSource).toBe("none");
    });
  });

  describe("with config credentials", () => {
    it("resolves accessToken from config", () => {
      const result = resolveMatrixCredentials({ accessToken: "config-token" });
      expect(result.accessToken).toBe("config-token");
      expect(result.accessTokenSource).toBe("config");
    });

    it("resolves password from config", () => {
      const result = resolveMatrixCredentials({ password: "config-password" });
      expect(result.password).toBe("config-password");
      expect(result.passwordSource).toBe("config");
    });

    it("resolves both accessToken and password from config", () => {
      const result = resolveMatrixCredentials({
        accessToken: "config-token",
        password: "config-password",
      });
      expect(result.accessToken).toBe("config-token");
      expect(result.password).toBe("config-password");
      expect(result.accessTokenSource).toBe("config");
      expect(result.passwordSource).toBe("config");
    });

    it("trims whitespace from config accessToken", () => {
      const result = resolveMatrixCredentials({ accessToken: "  config-token  " });
      expect(result.accessToken).toBe("config-token");
      expect(result.accessTokenSource).toBe("config");
    });

    it("trims whitespace from config password", () => {
      const result = resolveMatrixCredentials({ password: "  config-password  " });
      expect(result.password).toBe("config-password");
      expect(result.passwordSource).toBe("config");
    });

    it("treats empty config accessToken as none", () => {
      const result = resolveMatrixCredentials({ accessToken: "   " });
      expect(result.accessToken).toBeUndefined();
      expect(result.accessTokenSource).toBe("none");
    });

    it("treats empty config password as none", () => {
      const result = resolveMatrixCredentials({ password: "" });
      expect(result.password).toBeUndefined();
      expect(result.passwordSource).toBe("none");
    });
  });

  describe("with environment variables", () => {
    it("ignores env vars when allowEnv is false (default)", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({});
      expect(result.accessToken).toBeUndefined();
      expect(result.password).toBeUndefined();
      expect(result.accessTokenSource).toBe("none");
      expect(result.passwordSource).toBe("none");
    });

    it("resolves accessToken from env when allowEnv is true", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.accessToken).toBe("env-token");
      expect(result.accessTokenSource).toBe("env");
    });

    it("resolves password from env when allowEnv is true", () => {
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.password).toBe("env-password");
      expect(result.passwordSource).toBe("env");
    });

    it("resolves both accessToken and password from env", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.accessToken).toBe("env-token");
      expect(result.password).toBe("env-password");
      expect(result.accessTokenSource).toBe("env");
      expect(result.passwordSource).toBe("env");
    });

    it("trims whitespace from env accessToken", () => {
      process.env.MATRIX_ACCESS_TOKEN = "  env-token  ";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.accessToken).toBe("env-token");
      expect(result.accessTokenSource).toBe("env");
    });

    it("trims whitespace from env password", () => {
      process.env.MATRIX_PASSWORD = "  env-password  ";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.password).toBe("env-password");
      expect(result.passwordSource).toBe("env");
    });

    it("treats empty env accessToken as none", () => {
      process.env.MATRIX_ACCESS_TOKEN = "   ";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.accessToken).toBeUndefined();
      expect(result.accessTokenSource).toBe("none");
    });

    it("treats empty env password as none", () => {
      process.env.MATRIX_PASSWORD = "";
      const result = resolveMatrixCredentials({ allowEnv: true });
      expect(result.password).toBeUndefined();
      expect(result.passwordSource).toBe("none");
    });
  });

  describe("config takes precedence over env", () => {
    it("prefers config accessToken over env", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      const result = resolveMatrixCredentials({
        accessToken: "config-token",
        allowEnv: true,
      });
      expect(result.accessToken).toBe("config-token");
      expect(result.accessTokenSource).toBe("config");
    });

    it("prefers config password over env", () => {
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({
        password: "config-password",
        allowEnv: true,
      });
      expect(result.password).toBe("config-password");
      expect(result.passwordSource).toBe("config");
    });

    it("falls back to env when config accessToken is empty", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      const result = resolveMatrixCredentials({
        accessToken: "   ",
        allowEnv: true,
      });
      expect(result.accessToken).toBe("env-token");
      expect(result.accessTokenSource).toBe("env");
    });

    it("falls back to env when config password is empty", () => {
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({
        password: "",
        allowEnv: true,
      });
      expect(result.password).toBe("env-password");
      expect(result.passwordSource).toBe("env");
    });

    it("mixed sources: config accessToken, env password", () => {
      process.env.MATRIX_PASSWORD = "env-password";
      const result = resolveMatrixCredentials({
        accessToken: "config-token",
        allowEnv: true,
      });
      expect(result.accessToken).toBe("config-token");
      expect(result.password).toBe("env-password");
      expect(result.accessTokenSource).toBe("config");
      expect(result.passwordSource).toBe("env");
    });

    it("mixed sources: env accessToken, config password", () => {
      process.env.MATRIX_ACCESS_TOKEN = "env-token";
      const result = resolveMatrixCredentials({
        password: "config-password",
        allowEnv: true,
      });
      expect(result.accessToken).toBe("env-token");
      expect(result.password).toBe("config-password");
      expect(result.accessTokenSource).toBe("env");
      expect(result.passwordSource).toBe("config");
    });
  });
});
