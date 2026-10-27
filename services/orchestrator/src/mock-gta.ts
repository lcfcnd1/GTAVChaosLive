import WebSocket from "ws";

const token = process.env.CHAOS_TOKEN;
if (!token) { console.error("CHAOS_TOKEN is required for the Mock GTA adapter"); process.exit(1); }
const socket = new WebSocket(`ws://127.0.0.1:${process.env.CHAOS_PORT ?? 39177}`);
socket.on("open", () => {
  socket.send(JSON.stringify({ protocolVersion: 1, type: "auth.hello", payload: { token, client: "gta", source: "mock-gta" } }));
  console.log("Mock GTA adapter connected; no game natives are executed.");
});
socket.on("message", (raw) => {
  let message: any;
  try { message = JSON.parse(raw.toString()); } catch { return; }
  if (message.type !== "effect.command") return;
  const payload = message.payload;
  socket.send(JSON.stringify({ protocolVersion: 1, type: "result", payload: { id: payload.id, effectId: payload.effectId, status: "succeeded", createdAt: new Date().toISOString() } }));
  console.log(`Mock executed ${payload.effectId}`);
});
socket.on("close", () => process.exit(0));
socket.on("error", (error) => { console.error(`Mock GTA connection failed: ${error.message}`); process.exitCode = 1; });
