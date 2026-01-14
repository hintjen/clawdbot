/**
 * Matrix credential resolution.
 * Handles access token and password normalization for Matrix authentication.
 */

export type MatrixCredentialSource = "env" | "config" | "none";

export type MatrixCredentials = {
  accessToken?: string;
  password?: string;
  accessTokenSource: MatrixCredentialSource;
  passwordSource: MatrixCredentialSource;
};

/**
 * Normalize a raw token/password string by trimming whitespace.
 * Returns undefined if empty after trimming.
 */
export function normalizeMatrixCredential(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Normalize a Matrix access token.
 */
export function normalizeMatrixAccessToken(raw?: string): string | undefined {
  return normalizeMatrixCredential(raw);
}

/**
 * Normalize a Matrix password.
 */
export function normalizeMatrixPassword(raw?: string): string | undefined {
  return normalizeMatrixCredential(raw);
}

/**
 * Resolve Matrix credentials from config and environment variables.
 * Config values take precedence over environment variables.
 * Environment variables are only used for the default account.
 *
 * Environment variables:
 * - MATRIX_ACCESS_TOKEN: access token for authentication
 * - MATRIX_PASSWORD: password for authentication
 *
 * @param params.accessToken - access token from config
 * @param params.password - password from config
 * @param params.allowEnv - whether to check environment variables (true for default account)
 */
export function resolveMatrixCredentials(params: {
  accessToken?: string;
  password?: string;
  allowEnv?: boolean;
}): MatrixCredentials {
  const { accessToken: configAccessToken, password: configPassword, allowEnv = false } = params;

  // Normalize config values
  const normalizedConfigAccessToken = normalizeMatrixAccessToken(configAccessToken);
  const normalizedConfigPassword = normalizeMatrixPassword(configPassword);

  // Check environment variables if allowed
  const envAccessToken = allowEnv
    ? normalizeMatrixAccessToken(process.env.MATRIX_ACCESS_TOKEN)
    : undefined;
  const envPassword = allowEnv
    ? normalizeMatrixPassword(process.env.MATRIX_PASSWORD)
    : undefined;

  // Config takes precedence over env
  const accessToken = normalizedConfigAccessToken ?? envAccessToken;
  const password = normalizedConfigPassword ?? envPassword;

  // Determine sources
  const accessTokenSource: MatrixCredentialSource = normalizedConfigAccessToken
    ? "config"
    : envAccessToken
      ? "env"
      : "none";

  const passwordSource: MatrixCredentialSource = normalizedConfigPassword
    ? "config"
    : envPassword
      ? "env"
      : "none";

  return {
    accessToken,
    password,
    accessTokenSource,
    passwordSource,
  };
}
