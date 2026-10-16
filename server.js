import http from "http";
import fs from "fs";
import { WebSocketServer } from "ws";
import si from "systeminformation";
import dns from "dns";

import { startCapture, domainsFor } from "./capture.js";
import { getGroupedPeers } from "./connections.js";

startCapture();

const server = http.createServer((req, res) => {
  if (req.url === "/chart.js") {
    res.setHeader("Content-Type", "text/javascript");
    return res.end(fs.readFileSync("node_modules/chart.js/dist/chart.umd.js"));
  }
  res.setHeader("Content-Type", "text/html");
  res.end(fs.readFileSync("index.html"));
});

const hostCache = new Map();

async function lookupHost(ip) {
  if (hostCache.has(ip)) return hostCache.get(ip);
  hostCache.set(ip, "");
  try {
    const names = await Promise.race([
      dns.promises.reverse(ip),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 2000),
      ),
    ]);
    hostCache.set(ip, names[0] || "");
  } catch (e) {
    hostCache.set(ip, "");
  }
  return hostCache.get(ip);
}

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const allowed = ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (!allowed.includes(req.headers.origin)) return ws.close(1008);
});

const broadcast = (obj) => {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((c) => c.readyState === 1 && c.send(msg));
};

const SKIP = new Set(["", "0.0.0.0", "::", "127.0.0.1", "::1"]);

async function getPeers() {
  const list = (await getGroupedPeers(SKIP)).map((p) => ({
    ...p,
    host: domainsFor(p.ip).join(", ") || hostCache.get(p.ip) || "",
  }));
  list.forEach((p) => {
    if (!hostCache.has(p.ip)) lookupHost(p.ip);
  });
  return list;
}

setInterval(async () => {
  const [s] = await si.networkStats();
  broadcast({ type: "stats", in: s.rx_sec ?? 0, out: s.tx_sec ?? 0 });
}, 1000);

setInterval(async () => {
  try {
    const peers = await getPeers();
    broadcast({ type: "peers", peers });
  } catch (e) {
    console.error("peers error:", e.message);
  }
}, 3000);

server.listen(3000, "127.0.0.1", () => {
  console.log("http://localhost:3000");
});
