import { AppError } from "../errors";

export interface NormalizeHostnameOptions {
  readonly allowUnderscore?: boolean;
  readonly allowWildcard?: boolean;
}

const asciiLabelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
const underscoreLabelPattern = /^_[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u;

function normalizeIdnaLabel(label: string): string {
  try {
    const hostname = new URL(`http://${label}.invalid`).hostname;
    const labels = hostname.split(".");
    if (labels.length !== 2 || labels[1] !== "invalid") throw new Error("Unexpected IDNA output");
    return labels[0] ?? "";
  } catch (error) {
    throw new AppError("VALIDATION_ERROR", `DNS label「${label}」不是合法的 IDNA label`, {
      cause: error,
    });
  }
}

export function normalizeHostname(
  input: string,
  options: NormalizeHostnameOptions = {},
): string {
  if (input !== input.trim() || input.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Hostname 不可為空或包含前後空白");
  }
  if (/%|\/|:|@|#|\?|\s/u.test(input)) {
    throw new AppError("VALIDATION_ERROR", "Hostname 包含不允許的字元或 encoding");
  }

  const withoutTrailingDot = input.endsWith(".") ? input.slice(0, -1) : input;
  if (!withoutTrailingDot || withoutTrailingDot.endsWith(".")) {
    throw new AppError("VALIDATION_ERROR", "Hostname 包含空的 DNS label");
  }

  const rawLabels = withoutTrailingDot.split(".");
  if (rawLabels.some((label) => label.length === 0)) {
    throw new AppError("VALIDATION_ERROR", "Hostname 包含空的 DNS label");
  }

  const canonicalLabels = rawLabels.map((rawLabel, index) => {
    if (rawLabel === "*") {
      if (!options.allowWildcard || index !== 0) {
        throw new AppError("VALIDATION_ERROR", "Wildcard 只能是最左側的完整 label");
      }
      return "*";
    }
    if (rawLabel.includes("*")) {
      throw new AppError("VALIDATION_ERROR", "不允許 partial wildcard，例如 foo*");
    }

    const lower = rawLabel.toLowerCase();
    const canonical = /[^\u0000-\u007f]/u.test(lower)
      ? normalizeIdnaLabel(lower)
      : lower;
    const valid = canonical.startsWith("_")
      ? options.allowUnderscore === true && underscoreLabelPattern.test(canonical)
      : asciiLabelPattern.test(canonical);
    if (!valid) {
      throw new AppError("VALIDATION_ERROR", `DNS label「${rawLabel}」格式不正確`);
    }
    if (canonical.length > 63) {
      throw new AppError("VALIDATION_ERROR", "每個 DNS label 不可超過 63 characters");
    }
    return canonical;
  });

  const canonical = canonicalLabels.join(".");
  if (canonical.length > 253) {
    throw new AppError("VALIDATION_ERROR", "完整 FQDN 不可超過 253 characters");
  }
  return canonical;
}

export function isHostnameWithinNamespace(hostname: string, namespace: string): boolean {
  try {
    const normalizedHostname = normalizeHostname(hostname, {
      allowUnderscore: true,
      allowWildcard: true,
    });
    const normalizedNamespace = normalizeHostname(namespace, {
      allowUnderscore: true,
      allowWildcard: false,
    });
    return (
      normalizedHostname === normalizedNamespace ||
      normalizedHostname.endsWith(`.${normalizedNamespace}`)
    );
  } catch {
    return false;
  }
}

export function resolveRelativeOwner(relativeName: string, namespace: string): string {
  const canonicalNamespace = normalizeHostname(namespace, {
    allowUnderscore: true,
    allowWildcard: false,
  });
  if (relativeName === "@") return canonicalNamespace;
  if (relativeName.endsWith(".")) {
    throw new AppError("VALIDATION_ERROR", "Name 必須使用相對名稱，不可包含 trailing dot");
  }
  const hostname = normalizeHostname(`${relativeName}.${canonicalNamespace}`, {
    allowUnderscore: true,
    allowWildcard: true,
  });
  if (!isHostnameWithinNamespace(hostname, canonicalNamespace)) {
    throw new AppError("FORBIDDEN", "Name 超出所選 namespace");
  }
  return hostname;
}

export function normalizeNamespaceGrant(
  input: string,
  zoneName: string,
  protectedHostnames: ReadonlySet<string>,
): string {
  const namespace = normalizeHostname(input, {
    allowUnderscore: false,
    allowWildcard: false,
  });
  const zone = normalizeHostname(zoneName);
  if (namespace === zone || !namespace.endsWith(`.${zone}`)) {
    throw new AppError("VALIDATION_ERROR", `Namespace 必須是 ${zone} 的真正子網域`);
  }
  if (protectedHostnames.has(namespace)) {
    throw new AppError("PROTECTED_RESOURCE", "此 hostname 受平台保護，不能作為 grant");
  }
  return namespace;
}

export function normalizeGrantSet(grants: readonly string[]): string[] {
  const sorted = [...new Set(grants)].sort((left, right) => {
    const depthDifference = left.split(".").length - right.split(".").length;
    return depthDifference || left.localeCompare(right);
  });
  const result: string[] = [];
  for (const grant of sorted) {
    if (!result.some((existing) => isHostnameWithinNamespace(grant, existing))) {
      result.push(grant);
    }
  }
  return result;
}

export function isDeepSubdomain(hostname: string, zoneName: string): boolean {
  const host = normalizeHostname(hostname, {
    allowUnderscore: true,
    allowWildcard: true,
  });
  const zone = normalizeHostname(zoneName);
  if (!host.endsWith(`.${zone}`)) return false;
  const relative = host.slice(0, -1 * (`.${zone}`.length));
  return relative.split(".").length > 1;
}
