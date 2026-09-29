using System;
using System.Collections.Concurrent;
using System.Threading;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Serializes short monitoring state transitions for one (job, child) scope
    /// inside this IIS worker process. Cry creation, pause approval, escalation
    /// delivery, and session start share this gate so a pause cannot race a new
    /// cry or a notification already claimed for delivery. This is deliberately
    /// process-local: a web farm needs database-level coordination and is not
    /// covered by this gate. The key space is bounded by authorized job/child
    /// scopes; entries are retained for the worker lifetime to avoid unsafe
    /// semaphore removal while waiters may still exist.
    /// </summary>
    public static class MonitoringScopeGate
    {
        private static readonly ConcurrentDictionary<string, SemaphoreSlim> Gates =
            new ConcurrentDictionary<string, SemaphoreSlim>(StringComparer.Ordinal);

        public static IDisposable Enter(int jobId, int childId)
        {
            var gate = Gates.GetOrAdd(
                jobId + ":" + childId,
                _ => new SemaphoreSlim(1, 1));
            gate.Wait();
            return new Lease(gate);
        }

        private sealed class Lease : IDisposable
        {
            private SemaphoreSlim _gate;

            public Lease(SemaphoreSlim gate) { _gate = gate; }

            public void Dispose()
            {
                var gate = Interlocked.Exchange(ref _gate, null);
                if (gate != null) gate.Release();
            }
        }
    }
}
