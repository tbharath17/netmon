// connections.js — connection list from `ss` (full IPv6 addresses, process names, no root).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";
import { norm } from "./capture.js";

const run = promisify(execFile);
const PROC_RE = /\(\("([^"]+)"/; // users:(("brave",pid=2053,fd=...))

export async function readConnections() {
  // execFile + args array: no shell is ever involved
  const { stdout } = await run("ss", ["-tunapH"], {
    timeout: 2000,
    maxBuffer: 5 * 1024 * 1024,
  });

  const out = [];
  for (const line of stdout.split("\n")) {
    // fields: netid, state, recv-q, send-q, local, peer, users...
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || f[1] !== "ESTAB") continue;

    const peer = f[5];
    const i = peer.lastIndexOf(":"); // port is after the LAST colon
    if (i < 1) continue;

    const port = peer.slice(i + 1);
    const ip = norm(peer.slice(0, i).replace(/^\[|\]$/g, "")); // strip [ ]
    if (!net.isIP(ip)) continue;

    const m = f.slice(6).join(" ").match(PROC_RE);
    out.push({ ip, port, proc: m ? m[1] : "" });
  }
  return out;
}

// Same grouping your getPeers() did: one row per IP.
export async function getGroupedPeers(skip = new Set()) {
  const peers = new Map();
  for (const c of await readConnections()) {
    if (skip.has(c.ip)) continue;
    let p = peers.get(c.ip);
    if (!p) {
      p = { ip: c.ip, count: 0, ports: new Set(), procs: new Set() };
      peers.set(c.ip, p);
    }
    p.count++;
    p.ports.add(c.port);
    if (c.proc) p.procs.add(c.proc);
  }
  return [...peers.values()]
    .map((p) => ({
      ip: p.ip,
      count: p.count,
      ports: [...p.ports].slice(0, 5),
      procs: [...p.procs],
    }))
    .sort((a, b) => b.count - a.count);
}
