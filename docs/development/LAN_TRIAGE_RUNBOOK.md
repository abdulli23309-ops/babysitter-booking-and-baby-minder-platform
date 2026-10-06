# Little Care — LAN Triage Runbook ("refused to connect")

**Audience:** anyone debugging the Little Care development stack when a phone or
browser reports that the LAN address will not connect.

**Goal:** *Find out WHICH server is failing, from evidence, in one pass.* This
runbook is deliberately diagnostic-first: it tells you which of the three servers
to look at, instead of re-editing the IP.

> Companion to [LAN_DEVELOPMENT.md](./LAN_DEVELOPMENT.md), which explains the
> design of the launcher. This document is about what to do when something breaks.

---

## 0. The one rule

> **The same symptom does not mean the same cause.**
> "192.168.1.x refused to connect" has been caused by *both* a stale DHCP address
> *and* a service simply not running. Do not assume. Measure.

Before changing any IP or config, run section 2. The last reported failure had
**nothing to do with the IP** — MiroTalk was simply not running.

---

## 1. The three servers

| Port    | Service             | Started by                 | Bind |
| ------- | ------------------- | -------------------------- | ---- |
| `3010`  | **MiroTalk SFU**    | `start-littlecare-dev.ps1` | `::` (dual-stack, serves IPv4) |
| `5173`  | **React / Vite**    | `start-littlecare-dev.ps1` | `0.0.0.0` |
| `44368` | **ASP.NET backend** | IIS Express                | `localhost` only (PC-local by design) |

**First question to ask: which URL failed?**

| URL you opened | Server | Where to look |
|---|---|---|
| `https://<LAN IP>:3010/...` | MiroTalk SFU | Section 3 |
| `https://<LAN IP>:5173/...` | React frontend | Section 4 |
| `https://localhost:5173/api/...` | Vite proxy → backend | Section 5 |
| `https://localhost:44368/...` | ASP.NET backend | Section 5 |

Do not skip this. The same error text points at three different services.

---

## 2. Always start here (the 3-command check)

Run from the **repo root** (the folder containing `start-littlecare-dev.ps1`).

```powershell
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

Wait for it to finish completely. Then:

```powershell
Test-NetConnection 192.168.1.4 -Port 3010
Test-NetConnection 192.168.1.4 -Port 5173

Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalPort -in 3010,5173,44368 } |
    Select-Object LocalAddress,LocalPort,OwningProcess
```

### Reading the output

| Result | Meaning | Go to |
|---|---|---|
| `TcpTestSucceeded : True` on both | Both fine — problem is **phone→PC**, not the app | Section 7 |
| 3010 **False**, 5173 **True** | **MiroTalk not listening** — most common failure | Section 3 |
| 5173 **False** | Frontend not listening | Section 4 |
| Both **False** | Nothing started — read the launcher output | Section 3 |
| Port row missing entirely | No process bound it | Section 3 |

### Healthy output looks like this

```
LocalAddress LocalPort OwningProcess
------------ --------- -------------
::               44368             4     (System / IIS Express HTTP.sys)
::                3010          6768     (node - MiroTalk)
0.0.0.0           5173         33416     (node - Vite)
## 3. "MiroTalk refused to connect" (port 3010)

**This was the real cause of the last failure** — `192.168.1.4` was correct the
whole time; MiroTalk simply was not running.

### 3a. Is it listening?

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3010
```

No rows = nothing is serving 3010.

### 3b. Just start it again

```powershell
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

The launcher waits for the port to actually bind (up to 120 s).

### 3c. IMPORTANT: MiroTalk is slow to start

mediasoup spin-up takes **~30–45 seconds**. During that window the port is
closed, so a browser hitting it gets **"refused to connect"**.

**If a phone/browser is opened too early, it looks exactly like an outage.**

> This is the most common false alarm. Wait for `MiroTalk listening: YES`
> in the launcher banner before opening anything.

### 3d. If it will not bind

```powershell
# Kill any stale MiroTalk node process
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'app[\\/]src[\\/]Server\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Start again and WATCH the console output
cd E:\MiroTalkPOC
npm start
```

Common causes: missing `.env`, port held by an old process, or `E:\MiroTalkPOC`
missing entirely.

---

## 4. "Frontend refused to connect" (port 5173)

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5173
```

Expect `LocalAddress = 0.0.0.0`. Restart with the launcher, or run in the
foreground to read the error:

```powershell
cd babysitter-app
npm run dev
```

Vite reads its TLS key/cert from `E:/MiroTalkPOC/app/ssl`. If the certificate
was regenerated, restarting Vite picks up the new pair.

---

## 5. Backend / API errors

The backend is **intentionally** bound to `localhost:44368` only — the Vite
proxy is the only thing that talks to it. **Do not put the LAN IP here.**

```powershell
# Backend alive? 401 is GOOD - it means auth is enforced.
Invoke-WebRequest https://localhost:44368/api/Auth/me -UseBasicParsing

# Through the proxy (what the browser actually uses):
Invoke-WebRequest https://localhost:5173/api/Auth/me -UseBasicParsing
```

| Result | Meaning |
|---|---|
| `401 Unauthorized` | Backend alive and enforcing auth. **Normal.** |
| `404` on `/api/monitoring/cry` | **Normal** — "no cry alert yet". Not a fault. |
| `404` on other endpoints | Route genuinely missing |
| Connection error | IIS Express not running — restart it |

> **`/api/monitoring/cry` returning 404 is expected, not a bug.**
> `useMonitoring.js` deliberately treats 404 as "no alert yet" and does **not**
> show an error. A quiet session will poll and 404 repeatedly. Leave it alone.

---

## 6. Confirm config matches the current IP

Only do this **after** sections 2–5. The launcher does it automatically; these
are read-only checks to confirm nothing drifted.

```powershell
# What IP does the PC actually have right now?
Get-NetIPAddress -AddressFamily IPv4 |
    Select-Object InterfaceAlias,IPAddress,AddressState

# The three consumers:
Get-Content E:\MiroTalkPOC\.env | Select-String 'SFU_ANNOUNCED_IP'
Select-String -Path .\WebApplication2\Web.MonitoringMedia.config -Pattern 'MonitoringMediaServerUrl'

# Certificate SANs (must contain the CURRENT IP + 127.0.0.1)
Get-PfxCertificate E:\MiroTalkPOC\app\ssl\cert.pem |
    Format-List Subject,Issuer,NotBefore,NotAfter
```

All three must show the **same current IP**. If they disagree, re-run the
launcher — it synchronises all three plus the certificate.

---
```

> **Note on `3010` binding to `::`:** this is **not** a fault. On Windows `::`
> is dual-stack. If IPv4 works (`TcpTestSucceeded: True`) it is serving IPv4
> correctly. Do not "fix" this.

---
## 7. Both ports work on the PC, but the PHONE fails

**Stop changing application configuration.** The server is fine; the problem is
the phone→PC path. Do these checks:

1. **Which URL exactly?** Type `https://192.168.1.4:5173` manually — do **not**
   use a bookmark, QR code or PWA shortcut. A stale bookmark with an old IP is
   the most common cause of this exact error.
2. **Is the phone on the right Wi-Fi?** Mobile data or a guest network will
   refuse or time out. Confirm the phone shows the same `192.168.1.x` subnet.
3. **"Refused" vs "timeout" — this distinction is diagnostic:**
   - **Refused (instant)** → host is reachable but nothing is listening there.
     Almost always a **stale/incorrect address** on the phone.
   - **Timeout (slow, then fails)** → packets are being **dropped**. That is
     firewall, or being on the wrong network.
4. **PWA cache:** if the app was installed as a PWA, clear its cache or remove
   and re-add it — it caches its own start URL and icon.
5. **Certificate:** the phone must trust `E:\MiroTalkPOC\app\ssl\ca.crt`. A cert
   warning looks different from "refused", but check it if in doubt.

```powershell
# Firewall rules should be port-based (survive DHCP changes):
Get-NetFirewallRule -Direction Inbound -Enabled True |
    Where-Object { $_.DisplayName -like '*LittleCare*' } |
    Select-Object DisplayName,Enabled,Profile,Action
```

Expected: four rules (3010 TCP, 5173 TCP, 40000-40100 UDP, 40000-40100 TCP),
Enabled, scoped to `LocalSubnet`. The launcher creates them idempotently.
Creating them requires an **elevated** PowerShell.

---

## 8. Quick reference

```powershell
# START EVERYTHING (this alone fixes the most common failure)
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1

# VERIFY
Test-NetConnection 192.168.1.4 -Port 3010
Test-NetConnection 192.168.1.4 -Port 5173
Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalPort -in 3010,5173,44368 } |
    Select-Object LocalAddress,LocalPort,OwningProcess

# CONFIG ONLY, no service changes
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1 -ConfigureOnly

# TEST THE IP-CHANGE LOGIC (proves portability; reverts on next run)
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1 -ConfigureOnly -LanIp 192.168.1.77
```

### Decision tree

```
Browser/phone says "refused to connect"
        |
        +-- Which URL? -> 3010 = MiroTalk | 5173 = Frontend | /api = backend
        |
        v
Run the launcher, wait for it to FINISH
        |
        v
3010 OK? ---- no ---> MiroTalk not running. Wait ~45s after start. Section 3.
   |
  yes
   |
5173 OK? ---- no ---> Frontend not running. Section 4.
   |
  yes
   |
   v
Both OK from PC, phone still fails
   |
   v
STOP changing config -> phone->PC path. Section 7.
   |
   +-- instant "refused"  -> stale address / bookmark
   +-- slow "timeout"     -> firewall or wrong network
```

---

## 9. What NOT to do

- Do **not** hard-code an IP into source. The launcher handles DHCP changes.
- Do **not** edit the CA or make a phone re-trust it. Only the *leaf* changes.
- Do **not** disable Windows Firewall. Rules are port-based and idempotent.
- Do **not** "fix" `api/monitoring/cry` 404s — that is correct behaviour.
- Do **not** bind the backend to the LAN IP; it is PC-local by design.
- Do **not** treat `3010` listening on `::` as a bug.
- Do **not** open the phone/browser before `MiroTalk listening: YES` appears.

---

## 10. Verification checklist

- [ ] Launcher finished and printed `READY`
- [ ] `Test-NetConnection ... -Port 3010` → `True`
- [ ] `Test-NetConnection ... -Port 5173` → `True`
- [ ] Port rows present for 3010 / 5173 / 44368
- [ ] `SFU_ANNOUNCED_IP` == current IP
- [ ] `MonitoringMediaServerUrl` == `https://<current IP>:3010`
- [ ] Certificate SAN contains current IP + `127.0.0.1`
- [ ] Firewall rules present, Enabled, port-based
- [ ] Re-running the launcher changes nothing (idempotent)
- [ ] **Real phone test performed** (record honestly if not)