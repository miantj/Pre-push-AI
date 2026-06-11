export type Verdict = "PASS" | "FAIL" | null;

export function parseReviewVerdict(text: string): Verdict {
  if (!text || typeof text !== "string") return null;
  const re = /AI_CODE_REVIEW_VERDICT:\s*(PASS|FAIL)\b/gi;
  const matches = [...text.matchAll(re)];
  if (!matches.length) return null;
  return matches[matches.length - 1][1].toUpperCase() as Verdict;
}

/** 仅用于 CLI/Provider 短错误信息，不扫描审查正文 */
export function looksLikeReviewInfraFailure(detail: string): boolean {
  if (!detail || typeof detail !== "string") return false;
  const t = detail.trim().slice(0, 4000).toLowerCase();
  if (!t) return false;
  const patterns = [
    /\bout of usage\b/,
    /\b(you're|you are) out of\b/,
    /\bincrease your limit\b/,
    /\bquota exceeded\b/,
    /\b402\b.*\b(payment|billing)\b/,
    /用量.*(耗尽|不足)/,
    /\bgetaddrinfo\b/,
    /\benotfound\b/,
    /\beconnrefused\b/,
    /\betimedout\b/,
    /\bnetwork (error|unreachable)\b/,
    /\b\[unavailable\]/,
    /\bapi\d*\.cursor\.sh\b/,
    /\bconnect timeout\b/,
    /\bprovider http 429\b/,
    /\bprovider http 502\b/,
    /\bprovider http 503\b/,
    /\bprovider http 504\b/,
  ];
  return patterns.some((re) => re.test(t));
}

/** 配置/鉴权错误：hook 模式应 fail-closed */
export function looksLikeReviewConfigError(detail: string): boolean {
  if (!detail || typeof detail !== "string") return false;
  const t = detail.trim().slice(0, 2000).toLowerCase();
  const patterns = [
    /\binvalid api key\b/,
    /\bmissing api key\b/,
    /\bauthentication failed\b/,
    /\bunauthorized\b/,
    /\bprovider http 401\b/,
    /\bprovider http 403\b/,
  ];
  return patterns.some((re) => re.test(t));
}
