const textOf = (c) => typeof c === "string" ? c
  : Array.isArray(c) ? c.filter((x) => x?.type === "text" || x?.type === "input_text" || x?.type === "output_text").map((x) => x.text ?? x.content ?? "").join("\n")
    : "";
const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const subjectOf = (input = {}) => clip(
  input.description ?? input.file_path ?? input.path ?? input.query ?? input.pattern ?? input.url ?? input.name ?? input.topic ?? "",
  180,
);
const ORCHESTRATION_ONLY = new Set(["wait", "write_stdin", "update_plan", "get_goal", "yield_control"]);
const nestedNames = (input) => {
  const out = [...String(input ?? "").matchAll(/\btools\.([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
  return [...new Set(out)].filter((x) => !ORCHESTRATION_ONLY.has(x));
};
const codexOk = (output) => {
  const s = typeof output === "string" ? output : JSON.stringify(output ?? "");
  if (/"exit_code"\s*:\s*[1-9]\d*/.test(s) || /"error"\s*:\s*"[^"]+/.test(s)) return false;
  if (/"exit_code"\s*:\s*0/.test(s)) return true;
  return null;
};

export function parseVisibleTurns(lines, host) {
  const turns = [];
  for (const line of lines) {
    let o; try { o = typeof line === "string" ? JSON.parse(line) : line; } catch { continue; }
    const role = host === "claude" ? o.message?.role : o.type === "response_item" && o.payload?.type === "message" ? o.payload.role : null;
    if (role !== "user" && role !== "assistant") continue;
    const content = textOf(host === "claude" ? o.message?.content : o.payload?.content).trim();
    if (content) turns.push({ role, content });
  }
  return turns;
}

/** Parse host facts only: tool class, safe subject, outcome and final visible words. */
export function parseActionBundle(lines, host) {
  const calls = new Map(), actions = [];
  let summary = "", project = "", session = "", startedAt = "", endedAt = "";
  const noteTime = (o) => {
    const t = o.timestamp ?? o.message?.timestamp;
    if (t && Number.isFinite(Date.parse(t))) { if (!startedAt) startedAt = t; endedAt = t; }
  };
  for (const line of lines) {
    let o; try { o = typeof line === "string" ? JSON.parse(line) : line; } catch { continue; }
    noteTime(o);
    project ||= o.cwd ?? o.payload?.cwd ?? "";
    session ||= o.sessionId ?? o.payload?.sessionId ?? "";
    if (host === "claude") {
      if (o.message?.role === "assistant") {
        const visible = textOf(o.message.content).trim();
        if (visible) summary = visible;
        for (const x of Array.isArray(o.message.content) ? o.message.content : []) if (x?.type === "tool_use") {
          const a = { id: x.id, name: clip(x.name, 80) || "tool", subject: subjectOf(x.input), ok: null };
          calls.set(a.id, a); actions.push(a);
        }
      }
      if (o.message?.role === "user") for (const x of Array.isArray(o.message.content) ? o.message.content : []) if (x?.type === "tool_result") {
        const a = calls.get(x.tool_use_id);
        if (a) a.ok = typeof x.is_error === "boolean" ? !x.is_error : null;
      }
      continue;
    }
    const p = o.payload ?? {};
    if (o.type === "response_item" && p.type === "message" && p.role === "assistant") {
      const visible = textOf(p.content).trim();
      if (visible) summary = visible;
    }
    if (o.type === "response_item" && (p.type === "custom_tool_call" || p.type === "function_call")) {
      const names = nestedNames(p.input ?? p.arguments);
      const fallback = p.name && p.name !== "exec" && !ORCHESTRATION_ONLY.has(p.name) ? [p.name] : [];
      const expanded = names.length ? names : fallback;
      const rows = expanded.map((name, i) => ({ id: `${p.call_id ?? p.id ?? actions.length}:${i}`, parent: p.call_id ?? p.id, name: clip(name, 80), subject: "", ok: null }));
      calls.set(p.call_id ?? p.id, rows); actions.push(...rows);
    }
    if (o.type === "response_item" && /tool_call_output$/.test(p.type ?? "")) {
      const rows = calls.get(p.call_id);
      if (Array.isArray(rows)) for (const a of rows) a.ok = codexOk(p.output);
    }
  }
  return {
    project: clip(project.split("/").filter(Boolean).at(-1) ?? project, 160),
    session: clip(session, 100), started_at: startedAt || null, ended_at: endedAt || null,
    summary: clip(summary, 800),
    actions: actions.slice(-32).map(({ name, subject, ok }) => ({ name, ...(subject ? { subject } : {}), ok })),
  };
}
