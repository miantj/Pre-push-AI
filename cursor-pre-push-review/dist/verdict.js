"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReviewVerdict = parseReviewVerdict;
exports.looksLikeReviewInfraFailure = looksLikeReviewInfraFailure;
function parseReviewVerdict(text) {
    if (!text || typeof text !== "string")
        return null;
    const re = /PRE_PUSH_REVIEW_VERDICT:\s*(PASS|FAIL)\b/gi;
    const matches = [...text.matchAll(re)];
    if (!matches.length)
        return null;
    return matches[matches.length - 1][1].toUpperCase();
}
function looksLikeReviewInfraFailure(text) {
    if (!text || typeof text !== "string")
        return false;
    const t = text.toLowerCase();
    if (t.length > 8000)
        return false;
    const patterns = [
        /\bout of usage\b/,
        /\b(you're|you are) out of\b/,
        /\bincrease your limit\b/,
        /\brate limit\b/,
        /\bquota exceeded\b/,
        /\b402\b.*\b(payment|billing)\b/,
        /\binvalid api key\b/,
        /\bauthentication failed\b/,
        /\bunauthorized\b.*\b(api|token|key)\b/,
        /用量.*(耗尽|不足)/,
    ];
    return patterns.some((re) => re.test(t));
}
