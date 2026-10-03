/**
 * MonitorDeviceRoute - gate for the Phone 2 (monitor device) surfaces.
 *
 * WHY A SEPARATE GUARD INSTEAD OF ProtectedRoute
 * The cry detector belongs to the monitoring DEVICE, which is a different kind
 * of principal from an account: it authenticates with a device credential
 * (X-Monitor-Device) and has no account, password or bearer token. ProtectedRoute
 * answers "is there a signed-in user of an allowed role?", so it would send the
 * device to a login page it can never satisfy, while an ACCOUNT user would pass
 * it and be shown a detector the server will refuse.
 *
 * The authoritative check is server-side - POST /monitoring/cry validates the
 * device credential itself and rejects any request carrying an Authorization
 * header. This guard exists so the UI matches that rule instead of offering a
 * screen that cannot work. It is a usability boundary, NOT the security control.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { deviceStore } from '../services/independentMonitoringApi';
import { hasToken } from '../services/sessionStorage';
import CryDetector from '../features/cry/CryDetector';

export default function MonitorDeviceRoute() {
  const location = useLocation();

  // No paired device in this tab => there is no principal that could report a
  // cry. Send the user to the device pairing surface, preserving where they were
  // going so returning here after pairing is not a dead end.
  if (!deviceStore.getCredential()) {
    return <Navigate to="/monitor-device" replace state={{ from: location.pathname }} />;
  }

  // A paired device reports through the DEVICE credential. If an account session
  // is also present, this tab is a parent/sitter browser, not the nursery phone,
  // so the detector is withdrawn rather than shown in a state that cannot report.
  // (hasToken is the project's own session helper - reading sessionStorage
  // directly here would miss the localStorage->sessionStorage migration it
  // performs, and would reintroduce a hardcoded key.)
  if (hasToken()) {
    return <Navigate to="/independent-monitoring" replace />;
  }

  return <CryDetector independent embedded />;
}