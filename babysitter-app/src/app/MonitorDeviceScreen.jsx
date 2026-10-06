import { useReducer } from 'react';
import MonitorCameraScreen from '../features/parent/MonitorCameraScreen';
import PhonePairingConcept from '../features/parent/PhonePairingConcept';
import { deviceStore } from '../services/independentMonitoringApi';

/**
 * MonitorDeviceScreen - the /monitor-device route's single entry point.
 *
 * WHY A WRAPPER EXISTS
 *   This device has two genuine states and they are opposites:
 *     - UNPAIRED -> we have no principal, so there is nothing that could publish.
 *        The only honest thing to show is the pairing form.
 *     - PAIRED   -> the nursery camera, full-bleed.
 *
 *   Choosing between them by reading the credential at render keeps the
 *   decision out of the camera component. That matters because the camera
 *   component is deliberately cinematic: it has no header, no tabs and no
 *   navigation, so it has nowhere to put a "not paired yet" state. The branch
 *   belongs here, where the chrome still exists.
 *
 * WHY THE READ IS RE-EVALUABLE (PHASE B.1)
 *   `deviceStore` is a plain sessionStorage wrapper: React cannot observe it,
 *   and a child's own state update re-renders that child, never its parent.
 *   Pairing happens INSIDE `PhonePairingConcept`, so this component never
 *   re-rendered on a successful pair and the phone stayed parked on the
 *   pairing surface - a surface that heartbeats but does NOT run the feeding
 *   claim loop, which lives only on `MonitorCameraScreen`. `refreshCredential`
 *   is the missing signal: the pairing form calls it after it writes or clears
 *   the credential and this component re-reads the store with exactly the same
 *   rule it always had - same two states, same branches, now actually reactive.
 *
 *   Return to pairing is unchanged: the camera screen answers its own 401/403
 *   and "End Monitoring" by showing its unpaired notice, which links back here;
 *   the reload then finds the cleared store and renders the pairing form.
 *
 * SECURITY
 *   `deviceStore.getCredential()` returning a value proves only that THIS TAB was
 *   paired at some point. It is not an authorization decision - the server
 *   re-validates the credential on every `deviceMedia()` call, and the camera
 *   screen drops back to unpaired on a 401/403.
 */
export default function MonitorDeviceScreen() {
  // Dispatch identity is stable for this component's lifetime, so handing it to
  // the pairing form can never retrigger that form's own effects.
  const [, refreshCredential] = useReducer((tick) => tick + 1, 0);
  const paired = Boolean(deviceStore.getCredential());

  if (!paired) {
    // The original pairing surface, unchanged. This is a device form, not an
    // account form, so it is deliberately not behind ProtectedRoute.
    return (
      <PhonePairingConcept
        initialView="monitor"
        onCredentialChange={refreshCredential}
      />
    );
  }

  return <MonitorCameraScreen />;
}