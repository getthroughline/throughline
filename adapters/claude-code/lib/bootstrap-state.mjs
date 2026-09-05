/** New servers report identity presence explicitly. Old servers may use either rendering.
 * Unknown is not absent: never offer to recreate a self because a prose marker changed. */
export function personaPresence(bootstrap, context = "") {
  if (typeof bootstrap?.hasPersona === "boolean") return bootstrap.hasPersona;
  if (/Speak and act as this self|^## Founding (?:soul|identity) inheritance\b/m.test(context)) return true;
  return null;
}

/** A disk snapshot preserves identity, not a live conversation from another body.
 * Old packages cached these sections without a conversation key; don't revive them offline. */
export function snapshotStandingContext(context) {
  return String(context ?? "").replace(
    /^## (?:Current conversation commitment|Shared present uptake|Shared room now|Canonical turn)[^\n]*\n[\s\S]*?(?=^#{1,2} |$(?![\s\S]))/gm,
    "",
  ).trim();
}
