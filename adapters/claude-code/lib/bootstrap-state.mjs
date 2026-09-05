/** New servers report identity presence explicitly. Old servers may use either rendering.
 * Unknown is not absent: never offer to recreate a self because a prose marker changed. */
export function personaPresence(bootstrap, context = "") {
  if (typeof bootstrap?.hasPersona === "boolean") return bootstrap.hasPersona;
  if (/Speak and act as this self|^## Founding (?:soul|identity) inheritance\b/m.test(context)) return true;
  return null;
}
