// capture.js — builds an IP -> domains map from live traffic using tshark.
// Sources: TLS/QUIC ClientHello SNI (exact) and DNS responses (queried name).

import { spawn } from "node:child_process";
import readline from "node:readline";
import net from "node:net";

const TTL_MS = 10 * 60 * 1000; // forget a mapping after 10 minutes of silence
const MAX_IPS = 5000; // hard cap so the map can't grow forever
const DOMAIN_RE = /^[a-z0-9._-]{1,253}$/; // names come from the network: validate

// ip -> Map(domain -> lastSeen). One IP can serve many domains (CDNs).
const domainMap = new Map();

// Make IPv4/IPv6 strings comparable with what systeminformation reports.

export function norm(ip) {
  ip = String(ip)
    .trim()
    .replace(/^::ffff:/i, "");
  if (net.isIPv6(ip)) {
    try {
      return new URL(`http://[${ip}]`).hostname.slice(1, -1);
    } catch {
      return ip;
    }
  }
  return ip;
}

function remember(ip, domain) {
  if (!ip || !domain) return;
  ip = norm(ip);
  domain = domain.trim().toLowerCase();
  if (!net.isIP(ip) || !DOMAIN_RE.test(domain)) return;

  let m = domainMap.get(ip);
  if (!m) {
    if (domainMap.size >= MAX_IPS) {
      domainMap.delete(domainMap.keys().next().value); // evict oldest-inserted
    }
    m = new Map();
    domainMap.set(ip, m);
  }
  m.set(domain, Date.now());
}

export function domainsFor(ip, limit = 3) {
  const m = domainMap.get(norm(ip));
  if (!m) return [];
  const now = Date.now();
  for (const [d, t] of m) if (now - t > TTL_MS) m.delete(d);
  return [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([d]) => d);
}

const first = (s) => (s || "").split(",")[0].trim();

// Field order must match the -e flags below.

function handleLine(line) {
  const [ip4, ip6, sni, qname, a, aaaa] = line.split("\t");

  if (sni) {
    // ClientHello: destination IP + the server name the client asked for
    remember(first(ip4) || first(ip6), first(sni));
  } else if (qname) {
    // DNS response: every returned address maps back to the queried name
    const name = first(qname);
    for (const addr of `${a || ""},${aaaa || ""}`.split(",")) {
      if (addr.trim()) remember(addr, name);
    }
  }
}

export function startCapture(iface = "any") {
  const args = [
    "-i",
    iface,
    "-p",
    "-l", // line-buffered output (needed for live use)
    "-n", // no name resolution
    "-Q", // quiet: no packet counters on stderr
    "-f",
    "tcp port 443 or udp port 443 or udp port 53",
    "-Y",
    "tls.handshake.type == 1 || dns.flags.response == 1",
    "-T",
    "fields",
    "-E",
    "separator=/t",
    "-e",
    "ip.dst",
    "-e",
    "ipv6.dst",
    "-e",
    "tls.handshake.extensions_server_name",
    "-e",
    "dns.qry.name",
    "-e",
    "dns.a",
    "-e",
    "dns.aaaa",
  ];

  // Argument array, no shell: nothing from the network can reach a shell.
  const tshark = spawn("tshark", args, { stdio: ["ignore", "pipe", "pipe"] });

  readline.createInterface({ input: tshark.stdout }).on("line", handleLine);
  tshark.stderr.on("data", (d) =>
    console.error("tshark:", d.toString().trim()),
  );
  tshark.on("error", (e) =>
    console.error("tshark failed to start:", e.message),
  );
  tshark.on("exit", (code) => console.error("tshark exited with code", code));
  process.on("exit", () => tshark.kill());

  return tshark;
}
