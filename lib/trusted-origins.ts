function exactOrigin(value: string, source: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("*"))
    throw new Error(`${source} must contain explicit origins only.`);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${source} contains an invalid origin.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/" && parsed.pathname !== "") ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(`${source} must contain absolute HTTP(S) origins without paths or credentials.`);
  return parsed.origin;
}

export function buildTrustedOrigins(
  canonicalUrl: string,
  configuredOrigins?: string,
  vercelDeploymentUrl?: string,
) {
  const origins = [exactOrigin(canonicalUrl, "APP_URL")];
  if (configuredOrigins) {
    origins.push(
      ...configuredOrigins
        .split(",")
        .map((origin) => exactOrigin(origin, "BETTER_AUTH_TRUSTED_ORIGINS")),
    );
  }
  if (vercelDeploymentUrl?.trim()) {
    const deploymentOrigin = vercelDeploymentUrl.trim().startsWith("http")
      ? vercelDeploymentUrl
      : `https://${vercelDeploymentUrl}`;
    origins.push(exactOrigin(deploymentOrigin, "VERCEL_URL"));
  }
  return [...new Set(origins)];
}
