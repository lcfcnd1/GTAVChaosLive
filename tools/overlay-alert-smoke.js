// Deterministic browser-less smoke for the overlay's ACK-gated alerts.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

function element() {
  return {
    textContent: "",
    children: [],
    className: "",
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
  };
}

const gifts = element();
const connection = element();
const alert = element();
const chaosBar = element();
const document = {
  body: element(),
  getElementById(id) { return id === "gifts" ? gifts : id === "connection" ? connection : id === "alert" ? alert : element(); },
  querySelector(selector) { return selector === ".bar i" ? chaosBar : element(); },
  createElement() { return element(); },
};
let socket;
class FakeWebSocket {
  constructor() { socket = this; this.sent = []; }
  send(value) { this.sent.push(value); }
}
const context = {
  document,
  location: { pathname: "/overlay/alerts", search: "?token=smoke-token" },
  URLSearchParams,
  URL,
  WebSocket: FakeWebSocket,
  window: {},
  setTimeout(callback) { callback(); return 1; },
  setInterval() { return 1; },
  clearInterval() {},
  console,
};
vm.runInNewContext(fs.readFileSync("apps/overlay/overlay.js", "utf8"), context, { filename: "apps/overlay/overlay.js" });

socket.onopen();
const auth = JSON.parse(socket.sent[0]);
assert.deepEqual(auth, { protocolVersion: 1, type: "auth.hello", payload: { token: "smoke-token", client: "overlay" } }, "overlay must authenticate its WebSocket connection");

function deliver(payload) { socket.onmessage({ data: JSON.stringify({ type: "result", payload }) }); }
socket.onmessage({ data: JSON.stringify({ type: "effects.snapshot", payload: [{ id: "player.ragdoll", name: "Ragdoll", category: "PLAYER" }] }) });
socket.onmessage({ data: JSON.stringify({ type: "catalog.snapshot", payload: [{ id: "rose", name: "Rose", costVerified: true, coinCost: 1, active: true, requiredQuantity: 3, effectIds: ["player.ragdoll"] }] }) });
assert.equal(gifts.children.length, 1, "catalog snapshot must render active gifts");
assert.equal(gifts.children[0].children.some((child) => child.textContent === "REQUIRED ×3"), true, "catalog cards must show required quantity");
deliver({ id: "accepted", status: "accepted", username: "viewer", giftName: "Rose", quantity: 1, effectId: "player.ragdoll", createdAt: new Date().toISOString() });
assert.equal(alert.children.length, 0, "accepted results must not create a success alert");
deliver({ id: "rejected", status: "rejected", username: "viewer", giftName: "Rose", quantity: 1, effectId: "player.ragdoll", createdAt: new Date().toISOString() });
assert.equal(alert.children.length, 0, "rejected results must not create an alert");
deliver({ id: "succeeded", status: "succeeded", username: "viewer", giftName: "Rose", quantity: 2, effectId: "player.ragdoll", createdAt: new Date().toISOString() });
assert.equal(alert.children.length, 2, "succeeded results must render an alert icon and label");
assert.match(alert.children[1].textContent, /viewer activated Ragdoll with Rose × 2/);
deliver({ id: "failed", status: "failed", username: "viewer", giftName: "Rose", quantity: 1, effectId: "player.ragdoll", error: "gta_disconnected", createdAt: new Date().toISOString() });
assert.match(alert.children[1].textContent, /viewer failed Ragdoll with Rose × 1/);
assert.match(alert.className, /alert-failed/);
console.log(JSON.stringify({ accepted: "silent", succeeded: "alerted", failed: "alerted-as-failed" }));
