<!-- PROTECTED OPERATIONAL DOCUMENT -- DO NOT DELETE DURING CLEANUP -->
# Little Care - Portable LAN Cheat Sheet

## 1. Purpose
- The PC can receive a different IP on each network.
- This is expected behavior.
- The launcher detects and synchronizes the current IP automatically.
- Router configuration is not required.

## 2. Normal Startup
From a PowerShell terminal:
```powershell
cd "E:\Fyp Fazooliyaaat\Unified Backend Workspace"
powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1
```

## 3. Find Current IP
Detect active LAN IPv4 dynamically on any adapter (Wi-Fi or Ethernet):
```powershell
(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -ExpandProperty IPv4Address).IPAddress
```

## 4. Phone URL
Open in mobile browser (use the exact IP printed in the launcher output):
```text
https://<CURRENT_IP>:5173
```

## 5. When Changing Networks
- Connect the PC to the new network.
- Connect the phones to the same network.
- Run the launcher (`powershell -ExecutionPolicy Bypass -File .\start-littlecare-dev.ps1`).
- Open the new Frontend URL printed by the launcher.

## 6. If MiroTalk / WebRTC Fails
Verify that MiroTalk's announced address matches your current LAN IP:
```powershell
Get-Content 'E:\MiroTalkPOC\.env' | Select-String 'SFU_ANNOUNCED_IP'
```
The value must match the current LAN IP. If stale, rerun the launcher.

## 7. If There is a Certificate Warning
- Run the launcher again.
- It updates the leaf certificate for the current IP while keeping the existing trusted CA.

## 8. Important
- Do not hardcode the LAN IP into source code.
- Do not delete or regenerate the CA when the IP changes.
- Do not modify `Model1.edmx`.
- Do not delete this runbook during cleanup.

