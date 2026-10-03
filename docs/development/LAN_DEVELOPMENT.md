# Little Care — LAN Development (babysitter monitoring) 

**Audience:** anyone running the Little Care development stack on a machine whose
LAN IP address can change (DHCP).

**Goal:** *Start the environment → the current LAN address is handled
automatically → Parent Monitoring works → Babysitter Monitoring works.* No daily
hunting/editing of an IP address.

---

## 1. The one answer: where does Little Care get the development LAN/media address?

```
Development machine
        |
        v
start-littlecare-dev.ps1   (repo root)          <-- THE SINGLE SOURCE OF TRUTH
        |   detects the ACTIVE LAN IPv4
        |
        +--> E:\MiroTalkPOC\.env                 SFU_ANNOUNCED_IP        (WebRTC ICE)
        |
        +--> WebApplication2\Web.MonitoringMedia.config
        |                                        MonitoringMediaServerUrl (media endpoint)
        |                                                 |
        |                                                 v
        |                                        ASP.NET backend (MediaSessionService)
        |                                                 |
        |                                                 v
        |                                        MonitoringMediaPanel (iframe src)
        |                                                 |
        |                                                 v
        |                                          MiroTalk SFU  (https://<LAN-IP>:3010)
        |
        +--> E:\MiroTalkPOC\app\ssl\cert.pem     TLS SAN (used by Vite AND MiroTalk)
```

The **authoritative media endpoint** is
`WebApplication2\Web.MonitoringMedia.config → MonitoringMediaServerUrl`.
Everything the browser uses for media comes from the backend DTO
(`ServerUrl`), so the React app never stores an address.

---

## 2. Start the environment

From the repository root, in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

Useful switches:

| Switch | Effect |
|---|---|
| *(none)* | Detect the LAN IP, configure everything, restart services, print the banner |
| `-ConfigureOnly` | Refresh the certificate + config files only (no start/stop) |
| `-LanIp 192.168.1.42` | Apply a controlled address (used to prove the IP-change logic) |
| `-SkipFirewall` | Do not touch Windows Firewall rules |
| `-NoRestart` | Reuse already-running services where possible |
| `-MiroTalkRoot <path>` | Non-default MiroTalk deployment root |

Example output:

```
Little Care Development Environment
-----------------------------------
LAN IP:              192.168.1.18
Backend:             https://localhost:44368  (PC-local; Vite proxies /api to it)
MiroTalk (SFU):      https://192.168.1.18:3010
Frontend:            https://192.168.1.18:5173
MiroTalk listening:  YES
Frontend listening:  YES
Certificate SAN IP:  192.168.1.18, 127.0.0.1

Babysitter Monitoring: READY
```

---

## 3. How LAN address discovery works

The script calls `Get-NetRoute -DestinationPrefix 0.0.0.0/0` to find the interface
that owns the IPv4 default route (the real LAN adapter, not a virtual/Docker/
link-local one), reads its `Preferred` IPv4 address, and validates it is an
RFC1918 private address (`10/8`, `172.16/12`, `192.168/16`). If no default route
is found it falls back to any preferred IPv4 on a physical adapter that is `Up`.
If nothing usable is found it fails loudly instead of guessing.

The detected address is then fed into the three consumers below. **Nothing is
read back from a previously stored value**, and there is no hard-coded IP in the
script.

### What is PC-local vs phone-facing

| Consumer | Address used | Why |
|---|---|---|
| Vite dev server (bind) | `0.0.0.0:5173` | phones connect to the LAN IP |
| Vite `/api` proxy target | `https://localhost:44368` | backend is PC-local only |
| ASP.NET backend (IIS Express) | `*:44368:localhost` | reached only through the proxy |
| MiroTalk server (bind) | `0.0.0.0:3010` | phones connect to the LAN IP |
| MiroTalk `SFU_ANNOUNCED_IP` | **LAN IP** | WebRTC ICE candidate the phone must reach |
| Backend `MonitoringMediaServerUrl` | **`https://<LAN IP>:3010`** | the iframe host the phone opens |
| TLS SAN | **LAN IP** + `127.0.0.1` + `localhost` | covers both phone and PC-local access |

`localhost`/`127.0.0.1` is never replaced by the LAN IP where it is technically
correct to use the loopback, and the LAN IP is never used for the PC-local
backend hop.

---

## 4. How MiroTalk obtains its announced address

`E:\MiroTalkPOC\.env` → `SFU_ANNOUNCED_IP`. MiroTalk's `app/src/config.js`
resolves it into `getIPv4()`, which becomes the `announcedAddress` of the
mediasoup `listenInfos` (UDP + TCP). If it is stale, signalling and the HTTPS
page can load while **no media path can be established**. The script rewrites
only this one key and preserves any trailing comment. MiroTalk reads `.env` at
process start, so the script restarts MiroTalk after a change.

The HTTPS certificate is read from `ssl/cert.pem` relative to `app/src`
(`app/src/ssl` is a **junction** to `app/ssl`, so there is one physical copy —
regenerating `app/ssl/cert.pem` updates both MiroTalk and Vite).

---

## 5. HTTPS certificate handling (why an IP change no longer breaks trust)

* A **stable local CA** (`E:\MiroTalkPOC\app\ssl\ca.crt` / `ca.key`,
  `CN=Little Care FYP Dev CA`, valid to 2036) is reused and **never regenerated**
  by the script.
* The script regenerates only the **leaf** (`cert.pem`/`key.pem`) with the
  current LAN IP in its SAN, signed by that same CA.
* Therefore a phone that trusts `ca.crt` **once** keeps trusting every newly
  issued leaf after an IP change — there is no re-trust step on the phone.
* The previous leaf is preserved as `cert.pem.old-<ip>` / `key.pem.old-<ip>`
  (the existing convention), so a rollback is always possible.
* The script is idempotent: if the current leaf already carries the address, is
  signed by our CA and is not near expiry, nothing is written and no service is
  restarted.

**Install the CA on each demo device** (one-time per device): import
`E:\MiroTalkPOC\app\ssl\ca.crt` into the device's *trusted root* store. Do **not**
install the leaf as a root and do **not** bypass a browser warning — certificate
verification is not weakened anywhere.

---

## 6. How phones connect

On the babysitter phone (same Wi-Fi/LAN as the PC), with `ca.crt` trusted:

```
Frontend / app:  https://<LAN-IP>:5173
MiroTalk SFU:    https://<LAN-IP>:3010
```

Open both once and confirm **no certificate warning**. Camera/microphone only
work on a secure origin, which is why both must be HTTPS and trusted.

The babysitter's own camera and microphone stay off because the **server** issues
a viewer session (`Role=viewer`, `CanPublish=false`, join path `audio=0&video=0`)
and the UI renders no publisher controls — this did not change in this work.


---

## 7. Firewall / ports

| Port | Purpose | Exposed to LAN? |
|---|---|---|
| 3010 TCP | MiroTalk HTTPS + signalling | yes (phones) |
| 5173 TCP | Vite HTTPS (frontend) | yes (phones) |
| 40000–40100 TCP+UDP | WebRTC RTP media | yes (phones) |
| 44368 TCP | ASP.NET backend HTTPS | **no** — PC-local, via the Vite proxy |

The script adds these four inbound rules **only if missing**, scoped to
`-RemoteAddress LocalSubnet` (never the whole internet) across the
Public/Private/Domain profiles. It **never disables the firewall**.

Adding rules needs an **elevated** PowerShell. Without elevation the script prints
the exact commands to run:

```powershell
New-NetFirewallRule -DisplayName 'LittleCare Dev - MiroTalk HTTPS (3010)'      -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3010          -Profile Public,Private,Domain -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'LittleCare Dev - Frontend Vite HTTPS (5173)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173          -Profile Public,Private,Domain -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'LittleCare Dev - MiroTalk WebRTC RTP (UDP)'  -Direction Inbound -Action Allow -Protocol UDP -LocalPort 40000-40100    -Profile Public,Private,Domain -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'LittleCare Dev - MiroTalk WebRTC RTP (TCP)'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 40000-40100    -Profile Public,Private,Domain -RemoteAddress LocalSubnet
```

> Note: the current Wi-Fi network is classified **Public**. A pre-existing
> per-program rule for `node.exe` is why MiroTalk/Vite can be reached today even
> without the rules above. The explicit, subnet-scoped rules above make this
> deterministic instead of relying on an auto-created prompt rule.

---

## 8. What is automatic vs manual

**Automatic (every run):**
* LAN IPv4 discovery + private-range validation
* Leaf certificate regeneration for the current IP (same CA; no phone re-trust)
* `SFU_ANNOUNCED_IP` in MiroTalk `.env`
* `MonitoringMediaServerUrl` in `Web.MonitoringMedia.config`
* Minimal firewall rules (when elevated)
* Restart of MiroTalk, backend and Vite; the banner with the phone URLs

**Manual, once per device:**
* Import `E:\MiroTalkPOC\app\ssl\ca.crt` into the device's trusted root store
* Confirm no certificate warning on `https://<LAN-IP>:5173` and `https://<LAN-IP>:3010`

**Manual, occasionally:**
* If the machine moves to a **different network**, the LAN adapter may change
  (e.g. Ethernet instead of Wi-Fi). Just re-run the script; discovery follows the
  default route.
* Run one elevated PowerShell once to install the firewall rules (only needed if
  a phone cannot reach the PC).

---

## 9. If the network adapter changes

Nothing to edit. Re-run:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

It re-detects the address on the interface that owns the default route and
re-propagates it to the certificate and both config files. To confirm what it
will do **without changing anything**, run with `-ConfigureOnly`.

---

## 10. Verification commands

```powershell
# Full configuration in one shot
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1 -ConfigureOnly

# What the three consumers currently hold
Get-Content E:\MiroTalkPOC\.env | Select-String 'SFU_ANNOUNCED_IP'
Select-String -Path .\WebApplication2\Web.MonitoringMedia.config -Pattern 'MonitoringMediaServerUrl'

# Certificate SAN
$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('E:\MiroTalkPOC\app\ssl\cert.pem')
$c.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' } | ForEach-Object { $_.Format($false) }

# Chain must be OK against the CA
& 'C:\Program Files\Git\usr\bin\openssl.exe' verify -CAfile E:\MiroTalkPOC\app\ssl\ca.crt E:\MiroTalkPOC\app\ssl\cert.pem

# Ports actually listening
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3010,5173,44368 }
```

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Phone shows a certificate warning | Leaf SAN does not match the address the phone used | Re-run the script; confirm `Certificate SAN IP` in the banner |
| Phone opens the app but no video (black frame) | Backend handed a stale MiroTalk host | Confirm `MonitoringMediaServerUrl` equals the banner's MiroTalk URL; restart the backend |
| App and SFU load, media never connects | Stale `SFU_ANNOUNCED_IP` | Re-run the script (restarts MiroTalk) |
| MiroTalk port 3010 not listening for ~30 s after start | mediasoup worker spin-up | Wait; `MiroTalk listening: YES` appears once bound |
| Phone cannot reach the PC at all | Firewall rule missing | Run the four `New-NetFirewallRule` commands in an elevated shell |
| `OpenSSL was not found` | Git for Windows not installed | Install Git for Windows, or add `openssl` to PATH |

**Not done on purpose:** no TLS verification bypass, no firewall disable, no
wildcard CORS, no new media server, no hostname invented (a `.local` name is not
used because phone mDNS resolution cannot be guaranteed on all networks).

