import crypto from "crypto";

async function main(): Promise<void> {
  const apiBase = (process.env.WILDMIND_API_BASE_URL || "http://127.0.0.1:5000").replace(/\/+$/, "");
  const message = process.env.OPENCLAW_SMOKE_MESSAGE || "Show my recent generations";
  const sessionId = process.env.OPENCLAW_SMOKE_SESSION_ID || `openclaw-local-${crypto.randomUUID()}`;
  const bearer = process.env.WILDMIND_AUTH_BEARER?.trim();
  const cookie = process.env.WILDMIND_AUTH_COOKIE?.trim();

  if (!bearer && !cookie) {
    throw new Error("Set either WILDMIND_AUTH_BEARER or WILDMIND_AUTH_COOKIE before running smoke:openclaw-local");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (cookie) headers.cookie = cookie;

  const response = await fetch(`${apiBase}/api/assistant/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      sessionId,
    }),
  });

  const text = await response.text();

  console.log(`[openclaw-smoke] status=${response.status}`);
  console.log(`[openclaw-smoke] sessionId=${sessionId}`);
  console.log(text);

  if (!response.ok) {
    throw new Error(`Smoke request failed with status ${response.status}`);
  }

  // Optional: validate plugin/tool path with a prompt that may trigger a WildMind tool
  const toolTest = process.env.OPENCLAW_SMOKE_TOOL_TEST === "1" || process.env.OPENCLAW_SMOKE_TOOL_TEST === "true";
  if (toolTest) {
    const toolRes = await fetch(`${apiBase}/api/assistant/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "What is my credit balance?",
        sessionId,
      }),
    });
    const toolText = await toolRes.text();
    console.log(`[openclaw-smoke] tool-test status=${toolRes.status}`);
    console.log(toolText);
    if (!toolRes.ok) {
      throw new Error(`Tool smoke request failed with status ${toolRes.status}`);
    }
    let data: { ok?: boolean; content?: string };
    try {
      data = JSON.parse(toolText) as { ok?: boolean; content?: string };
    } catch {
      throw new Error("Tool smoke: response was not JSON");
    }
    if (!data.ok || typeof data.content !== "string" || data.content.length === 0) {
      throw new Error("Tool smoke: expected ok:true and non-empty content");
    }
    console.log("[openclaw-smoke] tool-test passed (got reply)");
  }
}

main().catch((error) => {
  console.error("[openclaw-smoke] failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
