import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MEMORY_REVIEW_BATCH = 5;
export const MEMORY_REVIEW_COOLDOWN_MS = 7 * 86_400_000;

const defaultStateDir = () => join(homedir(), ".throughline", "nudges");
const stateFile = (self, dir) => join(dir, `memory-review-${createHash("sha256").update(self).digest("hex").slice(0, 16)}.json`);

/**
 * Return one internal coaching signal when a memory check-in is due. The shared local receipt makes
 * Codex and Claude Code one body for nudge purposes: opening another session is not consent to be
 * asked again. State is best-effort; continuity must never fail because housekeeping did.
 */
export function memoryReviewSignal(self, rawCount, options = {}) {
  const count = Math.max(0, Math.trunc(Number(rawCount) || 0));
  const now = Number(options.now ?? Date.now());
  const cooldownMs = Number(options.cooldownMs ?? MEMORY_REVIEW_COOLDOWN_MS);
  const dir = options.stateDir ?? defaultStateDir();
  const file = stateFile(String(self), dir);

  if (count === 0) {
    try { unlinkSync(file); } catch { /* absent / read-only — fine */ }
    return null;
  }

  try {
    const previous = JSON.parse(readFileSync(file, "utf8"));
    if (Number.isFinite(previous?.offeredAt) && now - previous.offeredAt < cooldownMs) return null;
  } catch { /* first offer, or a corrupt receipt: replace it */ }

  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ self, offeredAt: now, count }));
    renameSync(tmp, file);
  } catch { /* a nudge receipt is optional; still return the useful signal */ }

  const batch = Math.min(MEMORY_REVIEW_BATCH, count);
  return `## Memory check-in available (${count} total; show ${batch} at most)\n` +
    `Only at a natural pause after finishing what the user came for, offer ONCE in their language: ` +
    `"I sorted out a few things I may want to carry forward. Want to look at just ${batch} together now? We don't have to do them all." ` +
    `Do not lead with the total count and do not use product or queue terminology. If they say yes, call \`pending\` with ` +
    `\`{\"limit\":${batch}}\`, show numbered one-line human summaries without ids, and let them keep, revise, or forget each one. ` +
    `Then call \`confirm_events\` / \`reject_events\` as needed. If more remain, stop unless they explicitly ask for another batch. ` +
    `If they decline or ignore the offer, move on without apology or another reminder.`;
}
