# netmon

A live network monitor for Linux. It shows real-time inbound/outbound bandwidth and a table of connected IPs with the **domain name** and the **process** behind each connection. It runs locally, unprivileged, and stores nothing on disk.

<!-- Replace with a screenshot. Redact IPs, hostnames and bookmarks before committing. -->

![netmon screenshot](docs/screenshot.png)

## Features

- Live in/out throughput chart (last 60 seconds, updated every second)
- Connected-peers table (refreshed every 3 seconds): IP, domain, connection count, ports, owning process
- Domain names taken from what your machine actually asked for (TLS SNI and DNS answers), with reverse DNS as a fallback
- IPv4 and IPv6, including QUIC (UDP 443) connections
- Runs as a normal user; only the capture helper holds extra rights

## How it works

```
tshark ---------> capture.js ------> IP -> {domain: lastSeen} map --+
ss -tunapH -----> connections.js --> peers grouped by IP -----------+--> server.js --WebSocket--> index.html (Chart.js)
systeminformation -> rx/tx bytes per second ------------------------+
```

| Data                      | Source                                        | Why                                                                          |
| ------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| Bandwidth in/out          | `systeminformation` `networkStats()`          | Simple and reliable for rates                                                |
| Connection list + process | `ss -tunapH`                                  | Full IPv6 addresses, process names, no root                                  |
| Domain names              | `tshark` (TLS ClientHello SNI, DNS responses) | Records the name the client requested, which a reverse lookup cannot recover |

**Why `ss` and not `systeminformation` for connections?** On my setup (`systeminformation` 5.33.15), `networkConnections()` returned IPv6 peer addresses cut off after four groups (for example `2404:6800:4013:802:`), so they could never match the addresses seen in packets. `ss` prints complete addresses, so the connection list comes from `ss` and `systeminformation` is used only for speed.

**Domain resolution order:**

1. Names observed in live traffic (SNI or DNS answer)
2. Reverse DNS (PTR) as a fallback
3. Blank if neither exists

One IP can serve many domains (CDNs), so the map is `ip -> { domain -> lastSeen }`. Entries expire after 10 minutes without traffic and the map is capped at 5000 IPs.

## Requirements

- Linux (developed on Parrot OS) with `ss` (iproute2) and `tshark`
- Node.js 24

## Setup

```bash
sudo apt install tshark
sudo dpkg-reconfigure wireshark-common    # answer Yes
sudo usermod -aG wireshark "$USER"        # then log out and back in

git clone https://github.com/<your-username>/netmon.git
cd netmon
npm install
node server.js or npm start
```

Open <http://localhost:3000>.

Check the capture setup before starting:

```bash
id            # should list: wireshark
tshark -D     # should list interfaces without permission errors
```

The project uses ES modules (`"type": "module"` in `package.json`) and depends on `ws`, `systeminformation` and `chart.js`.

## Security design

- **Local only:** the server binds to `127.0.0.1`.
- **No root:** capture rights go to `dumpcap` through the `wireshark` group, so Node and `tshark` run as a normal user.
- **No promiscuous mode:** `tshark` runs with `-p`, so it sees only this machine's traffic.
- **No shell:** `tshark` and `ss` are started with argument arrays, never shell strings, so nothing from the network can reach a shell.
- **Untrusted input:** domain names come from the network. They are checked against a strict character set and length before being stored, and every value is HTML-escaped before it goes into the table.
- **Minimal data:** only IPs, domain names and process names are kept, in memory. No packet payloads are stored or displayed.
- **Bounded memory:** the domain map has a size cap and a time-to-live.
- **Narrow capture:** the capture filter is limited to ports 443 and 53, and the display filter to TLS ClientHellos and DNS responses.

## Threat model

- **Protects:** metadata about your connections (which hosts you talk to and which programs do it).
- **Adversaries considered:** a malicious web page open in your browser, and other software running on the same machine.
- **Out of scope:** remote attackers (the app listens on loopback only) and malware with root.

## Known limitations

- DNS-over-HTTPS (for example in Brave) hides DNS answers. SNI still works for most traffic.
- Encrypted Client Hello would hide SNI, so some rows will have no domain.
- Reading SNI inside QUIC (HTTP/3) depends on your `tshark` version.
- Only connections that start after launch get captured domains. Older ones fall back to reverse DNS or stay blank.
- SNI is the name the client asked for. It is not proof of the server's identity.
- Linux only (`ss`, `tshark`).
- Membership of the `wireshark` group is a standing privilege: any program running as your user can capture packets.

## Troubleshooting

| Problem                                   | Fix                                                              |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `tshark` permission denied                | Log out and back in so the `wireshark` group applies; check `id` |
| "promiscuous mode not supported" on `any` | Make sure `-p` is in the `tshark` arguments                      |
| Domains stay blank                        | Open a new connection; `tshark` only sees new handshakes         |
| Table is empty                            | Run `ss -tunapH \| head` and check that lines appear             |

## Ethics

Use this only on machines and networks you own or have permission to monitor.

## License

MIT (add a `LICENSE` file).
