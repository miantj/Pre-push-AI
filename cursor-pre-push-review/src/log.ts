/** 立即 flush 的状态行，便于扩展侧流式读取进度 */
export function logReviewStatus(message: string): void {
  process.stdout.write(`[ai-code-review] ${message}\n`);
}
