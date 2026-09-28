using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Threading;
using System.Web.Http;
using WebApplication2.Controllers;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Implementations;

namespace Phase3Harness
{
    /// <summary>
    /// Phase 3 verification harness. Runs the full authorization + lifecycle test
    /// matrix against the REAL development database inside ONE transaction that is
    /// always rolled back, then re-checks from a FRESH context that nothing
    /// residue'd (MonitorSession/MonitorEvent/ChildGuardian counts and job
    /// statuses identical to baseline). Exit code 0 = all passed.
    /// </summary>
    internal static class Program
    {
        private static int _pass;
        private static int _fail;

        private static void Expect(string name, bool ok, string detail = "")
        {
            if (ok)
            {
                _pass++;
                Console.WriteLine("PASS  " + name);
            }
            else
            {
                _fail++;
                Console.WriteLine("FAIL  " + name + (string.IsNullOrEmpty(detail) ? "" : "  [" + detail + "]"));
            }
        }

        private static MonitoringDenial DenialOf(Action action, string name)
        {
            try
            {
                action();
            }
            catch (MonitoringAccessException ex)
            {
                return ex.Denial;
            }
            catch (Exception ex)
            {
                _fail++;
                Console.WriteLine("FAIL  " + name + " unexpected exception: " + ex.Message);
                return MonitoringDenial.Allowed;
            }
            _fail++;
            Console.WriteLine("FAIL  " + name + " (no exception thrown)");
            return MonitoringDenial.Allowed;
        }

        private static HttpResponseMessage Exec(IHttpActionResult result)
        {
            return result.ExecuteAsync(CancellationToken.None).GetAwaiter().GetResult();
        }

        private static MonitoringController MakeController(BabySitterBooking_and_BabyMinderEntities db, int userId, string role, string url)
        {
            Thread.CurrentPrincipal = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, role)
            }, "Session"));
            var ctrl = new MonitoringController(new MonitoringService(db, ownsContext: false));
            var config = new HttpConfiguration();
            var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.SetConfiguration(config);
            ctrl.Request = req;
            return ctrl;
        }

        private class StatusRow
        {
            public int Job_ID { get; set; }
            public string Status { get; set; }
        }

        private static string[,] SnapshotJobStatuses()
        {
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                var rows = db.Database.SqlQuery<StatusRow>(
                    "SELECT Job_ID, Status FROM Job WHERE Job_ID IN (167,168,169,170,171,23) ORDER BY Job_ID").ToList();
                var map = new string[rows.Count, 2];
                for (int i = 0; i < rows.Count; i++)
                {
                    map[i, 0] = rows[i].Job_ID.ToString();
                    map[i, 1] = rows[i].Status;
                }
                return map;
            }
        }

        private static void RunFixtures(BabySitterBooking_and_BabyMinderEntities db)
        {
            // ChildGuardian is EMPTY in the live DB (verified) - in-transaction fixtures.
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) VALUES (27, 34, N'TestFixture', 1, 0, 0)");
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) VALUES (1, 34, N'TestFixture', 0, 0, 0)");
            // No live job is InProgress (verified: 19 Assigned / 53 Completed / 65 Cancelled...)
            // - flip statuses for positive tests. BOTH spellings are covered on purpose
            // (171/167 'In Progress' display-style, 170 legacy 'InProgress').
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'InProgress'  WHERE Job_ID = 170");
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 167");
            Console.WriteLine("[TX] fixtures: guardian(27,34), guardian(1,34); jobs 171/167='In Progress', 170='InProgress'");
        }

        private static void RunServiceMatrix(BabySitterBooking_and_BabyMinderEntities db)
        {
            var svc = new MonitoringService(db, ownsContext: false);

            // --- ALLOWED -----------------------------------------------------
            var s1 = svc.StartSession(171, 27, 19, "Sitter");
            Expect("T1 allowed sitter start (job171 'In Progress', child27) -> Active",
                s1 != null && s1.Status == "Active" && s1.Job_ID == 171 && s1.Child_ID == 27,
                s1 == null ? "null" : s1.Status);

            Expect("T13 StartedAtUtc stamped (UTC, within test window)",
                s1.StartedAtUtc <= DateTime.UtcNow.AddMinutes(1) &&
                s1.StartedAtUtc >= DateTime.UtcNow.AddMinutes(-5),
                s1.StartedAtUtc.ToString("o"));

            var s2 = svc.StartSession(170, 27, 34, "Parent");
            Expect("T2 allowed parent-guardian start (job170 legacy 'InProgress' spelling) -> Active",
                s2 != null && s2.Status == "Active" && s2.MonitorSession_ID != s1.MonitorSession_ID,
                s2 == null ? "null" : s2.Status);

            var s3 = svc.StartSession(171, 29, 19, "Sitter");
            Expect("T3 multi-child job: separate session per child (child29 distinct id)",
                s3 != null && s3.Child_ID == 29 && s3.MonitorSession_ID != s1.MonitorSession_ID,
                s3 == null ? "null" : s3.MonitorSession_ID.ToString());

            // --- DENIED ------------------------------------------------------
            Expect("T4 sitter NOT assigned (sitter1 on job171) -> NotAssignedSitter",
                DenialOf(() => svc.StartSession(171, 27, 1, "Sitter"), "T4") == MonitoringDenial.NotAssignedSitter);

            Expect("T5 parent NOT guardian (parent1 of child27) -> NotGuardian",
                DenialOf(() => svc.StartSession(171, 27, 1, "Parent"), "T5") == MonitoringDenial.NotGuardian);

            Expect("T6 child not in job (child1 of job167) -> ChildNotInJob",
                DenialOf(() => svc.StartSession(167, 1, 34, "Parent"), "T6") == MonitoringDenial.ChildNotInJob);

            Expect("T7 job status 'Assigned' (job168) -> JobNotInProgress",
                DenialOf(() => svc.StartSession(168, 27, 34, "Parent"), "T7") == MonitoringDenial.JobNotInProgress);

            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'SitterArrived' WHERE Job_ID = 171");
            Expect("T8 job status 'SitterArrived' -> JobNotInProgress",
                DenialOf(() => svc.StartSession(171, 27, 19, "Sitter"), "T8") == MonitoringDenial.JobNotInProgress);
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");

            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'Completed' WHERE Job_ID = 171");
            Expect("T9 job status 'Completed' -> JobNotInProgress",
                DenialOf(() => svc.StartSession(171, 27, 19, "Sitter"), "T9") == MonitoringDenial.JobNotInProgress);
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");

            Expect("T10 wrong JobId/ChildId combo (guardian child1 + job171) -> ChildNotInJob",
                DenialOf(() => svc.StartSession(171, 1, 34, "Parent"), "T10") == MonitoringDenial.ChildNotInJob);

            Expect("T11a another user's session: parent1 GET (171,27) -> NotGuardian",
                DenialOf(() => svc.GetSession(171, 27, 1, "Parent"), "T11a") == MonitoringDenial.NotGuardian);
            Expect("T11b another user's session: sitter1 GET (171,27) -> NotAssignedSitter",
                DenialOf(() => svc.GetSession(171, 27, 1, "Sitter"), "T11b") == MonitoringDenial.NotAssignedSitter);

            // --- LIFECYCLE ---------------------------------------------------
            var s1again = svc.StartSession(171, 27, 19, "Sitter");
            int activeCount = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorSession WHERE Job_ID = 171 AND Child_ID = 27 AND Status = 'Active' AND IsDeleted = 0").Single();
            Expect("T12 duplicate start is idempotent (same id, exactly 1 Active row)",
                s1again.MonitorSession_ID == s1.MonitorSession_ID && activeCount == 1,
                "id=" + s1again.MonitorSession_ID + " vs " + s1.MonitorSession_ID + ", active=" + activeCount);

            var g1 = svc.GetSession(171, 27, 19, "Sitter");
            var g2 = svc.GetSession(171, 29, 19, "Sitter");
            Expect("T14 get returns the matching session per child",
                g1 != null && g2 != null &&
                g1.MonitorSession_ID == s1.MonitorSession_ID &&
                g2.MonitorSession_ID == s3.MonitorSession_ID &&
                g1.MonitorSession_ID != g2.MonitorSession_ID);

            var e1 = svc.EndSession(171, 27, 19, "Sitter");
            int endedRows = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorSession WHERE MonitorSession_ID = @p0 AND Status = 'Ended' AND EndedAtUtc IS NOT NULL AND IsDeleted = 0",
                s1.MonitorSession_ID).Single();
            Expect("T15 end -> Status Ended + EndedAtUtc set, row kept (not deleted)",
                e1 != null && e1.Status == "Ended" && e1.EndedAtUtc.HasValue && endedRows == 1,
                e1 == null ? "null" : e1.Status + "/" + endedRows);

            Expect("T15b second end -> SessionNotFound",
                DenialOf(() => svc.EndSession(171, 27, 19, "Sitter"), "T15b") == MonitoringDenial.SessionNotFound);

            // --- DIRECT MonitoringAccess CHECKS (pure decision function) ------
            Expect("X1 NULL job status (job23) is NOT in progress -> JobNotInProgress",
                MonitoringAccess.Check(db, 1, "Parent", 23, 27) == MonitoringDenial.JobNotInProgress);
            Expect("X2 session of another job -> SessionMismatch",
                MonitoringAccess.Check(db, 19, "Sitter", 170, 27, s1.MonitorSession_ID) == MonitoringDenial.SessionMismatch);
            Expect("X3 unknown role -> InvalidRole",
                MonitoringAccess.Check(db, 34, "Admin", 171, 27) == MonitoringDenial.InvalidRole);
            Expect("X5 nonexistent job -> JobNotFound",
                MonitoringAccess.Check(db, 19, "Sitter", 999999, 27) == MonitoringDenial.JobNotFound);
            Expect("X6 nonexistent child (authorized sitter) -> ChildNotFound",
                MonitoringAccess.Check(db, 19, "Sitter", 171, 999999) == MonitoringDenial.ChildNotFound);
            Expect("X4 status normalization: both spellings + trim + junk/null",
                MonitoringAccess.IsInProgressStatus("InProgress") &&
                MonitoringAccess.IsInProgressStatus("In Progress") &&
                MonitoringAccess.IsInProgressStatus("  InProgress  ") &&
                !MonitoringAccess.IsInProgressStatus("Open") &&
                !MonitoringAccess.IsInProgressStatus(null) &&
                !MonitoringAccess.IsInProgressStatus(""));

            Console.WriteLine("[TX] service matrix done; s1=" + s1.MonitorSession_ID +
                " s2=" + s2.MonitorSession_ID + " s3=" + s3.MonitorSession_ID);
        }

        private static void RunControllerTests(BabySitterBooking_and_BabyMinderEntities db)
        {
            // job168 base status is 'Assigned' - flip inside the transaction so the
            // controller tests exercise the 404 (no active session) and the full
            // start/get/end round trip; the rollback restores it.
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'InProgress' WHERE Job_ID = 168");
            Console.WriteLine("[TX] fixture: job168='InProgress' for controller tests");

            var c1 = MakeController(db, 34, "Parent", "http://localhost/api/monitoring/session/start");
            var r1 = Exec(c1.StartSession(new StartMonitoringSessionRequest { JobId = 0, ChildId = 27 }));
            Expect("C1 invalid ids -> 400", r1.StatusCode == HttpStatusCode.BadRequest, r1.StatusCode.ToString());

            var c2 = MakeController(db, 1, "Parent", "http://localhost/api/monitoring/session/start");
            var r2 = Exec(c2.StartSession(new StartMonitoringSessionRequest { JobId = 171, ChildId = 27 }));
            string body2 = r2.Content == null ? "" : r2.Content.ReadAsStringAsync().Result;
            Expect("C2 non-guardian start -> 403 + safe message",
                r2.StatusCode == HttpStatusCode.Forbidden && body2.Contains("guardian"),
                r2.StatusCode + " " + body2);

            var c3 = MakeController(db, 34, "Parent", "http://localhost/api/monitoring/session/start");
            var r3 = Exec(c3.StartSession(new StartMonitoringSessionRequest { JobId = 999999, ChildId = 27 }));
            Expect("C3 nonexistent job -> 404", r3.StatusCode == HttpStatusCode.NotFound, r3.StatusCode.ToString());

            var c4 = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session/end");
            var r4 = Exec(c4.EndSession(new EndMonitoringSessionRequest { JobId = 168, ChildId = 27 }));
            Expect("C4 end with no Active session -> 404", r4.StatusCode == HttpStatusCode.NotFound, r4.StatusCode.ToString());

            // Full lifecycle through the controller (JSON round trip).
            var cs = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session/start");
            var rs = Exec(cs.StartSession(new StartMonitoringSessionRequest { JobId = 168, ChildId = 27 }));
            string bodyS = rs.Content == null ? "" : rs.Content.ReadAsStringAsync().Result;
            Expect("C5a controller start -> 200 Active JSON",
                rs.StatusCode == HttpStatusCode.OK && bodyS.Contains("Active"), rs.StatusCode + " " + bodyS);

            var cg = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session");
            var rg = Exec(cg.GetSession(168, 27));
            string bodyG = rg.Content == null ? "" : rg.Content.ReadAsStringAsync().Result;
            Expect("C5b controller get -> 200 Active JSON",
                rg.StatusCode == HttpStatusCode.OK && bodyG.Contains("Active"), rg.StatusCode + " " + bodyG);

            var ce = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session/end");
            var re = Exec(ce.EndSession(new EndMonitoringSessionRequest { JobId = 168, ChildId = 27 }));
            string bodyE = re.Content == null ? "" : re.Content.ReadAsStringAsync().Result;
            Expect("C5c controller end -> 200 Ended JSON (EndedAtUtc set)",
                re.StatusCode == HttpStatusCode.OK && bodyE.Contains("Ended") && bodyE.Contains("EndedAtUtc"),
                re.StatusCode + " " + bodyE);

            var rg2 = Exec(cg.GetSession(168, 27));
            string bodyG2 = rg2.Content == null ? "" : rg2.Content.ReadAsStringAsync().Result;
            Expect("C5d controller get after end -> 200 Ended JSON (state visible)",
                rg2.StatusCode == HttpStatusCode.OK && bodyG2.Contains("Ended"), rg2.StatusCode + " " + bodyG2);

            var re2 = Exec(ce.EndSession(new EndMonitoringSessionRequest { JobId = 168, ChildId = 27 }));
            Expect("C5e controller end again -> 404", re2.StatusCode == HttpStatusCode.NotFound, re2.StatusCode.ToString());

            var c6 = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session");
            var r6 = Exec(c6.GetSession(999999, 27));
            Expect("C6 controller get nonexistent job -> 404", r6.StatusCode == HttpStatusCode.NotFound, r6.StatusCode.ToString());

            // 401 (missing/expired token) is enforced by [SessionAuthorize] and is
            // verified via live HTTP against IIS Express - the filter pipeline does
            // not run when an action method is invoked directly.
        }

        private static void RunAuditChecks(BabySitterBooking_and_BabyMinderEntities db)
        {
            int started = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = 'SessionStarted'").Single();
            int ended = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = 'SessionEnded'").Single();
            int denied = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = 'SessionAccessDenied'").Single();

            // Starts: T1 + T2 + T3 + C5a (T12 was idempotent, no new row/audit).
            Expect("T16a audit SessionStarted == 4", started == 4, started.ToString());
            // Ends: T15 + C5c (double-ends do not audit).
            Expect("T16b audit SessionEnded == 2", ended == 2, ended.ToString());
            // Denied: T4 T5 T6 T7 T8 T9 T10 T11a T11b C2 C3 C6 = 12.
            Expect("T16c audit SessionAccessDenied == 12", denied == 12, denied.ToString());

            int badPayload = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE PayloadJson LIKE '%pending-%' " +
                "OR PayloadJson LIKE '%RoomName%' OR PayloadJson LIKE '%token%' " +
                "OR PayloadJson LIKE '%password%' OR PayloadJson LIKE '%secret%'").Single();
            Expect("T16d payloads contain no room names/tokens/secrets", badPayload == 0, badPayload.ToString());

            int wrongActor = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE ActorUserId IS NULL OR ActorRole IS NULL").Single();
            Expect("T16e every audit row carries actor", wrongActor == 0, wrongActor.ToString());
        }

        private static void RunResidueChecks(string[,] before)
        {
            // FRESH context after rollback - proves the transaction left nothing.
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                int sessions = db.Database.SqlQuery<int>("SELECT COUNT(*) FROM MonitorSession").Single();
                int events = db.Database.SqlQuery<int>("SELECT COUNT(*) FROM MonitorEvent").Single();
                int guardians = db.Database.SqlQuery<int>("SELECT COUNT(*) FROM ChildGuardian").Single();
                Expect("R1 residue: MonitorSession == 0", sessions == 0, sessions.ToString());
                Expect("R2 residue: MonitorEvent == 0", events == 0, events.ToString());
                Expect("R3 residue: ChildGuardian == 0", guardians == 0, guardians.ToString());

                var after = SnapshotJobStatuses();
                bool same = before.GetLength(0) == after.GetLength(0);
                string detail = "";
                if (same)
                {
                    for (int i = 0; i < before.GetLength(0); i++)
                    {
                        if (before[i, 0] != after[i, 0] || before[i, 1] != after[i, 1])
                        {
                            same = false;
                            detail += before[i, 0] + ":" + before[i, 1] + "->" + after[i, 1] + " ";
                        }
                    }
                }
                Expect("R4 residue: job statuses identical to baseline", same, detail);
            }
        }

        private static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            var baseline = SnapshotJobStatuses();
            Console.WriteLine("[BASE] job statuses captured for jobs 167-171,23");

            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            using (var tx = db.Database.BeginTransaction())
            {
                try
                {
                    RunFixtures(db);
                    RunServiceMatrix(db);
                    RunControllerTests(db);
                    RunAuditChecks(db);
                    tx.Rollback();
                    Console.WriteLine("[TX] ROLLBACK executed");
                }
                catch (Exception ex)
                {
                    try { tx.Rollback(); } catch { /* already rolled back */ }
                    Console.WriteLine("FATAL unhandled exception: " + ex);
                    return 2;
                }
            }

            RunResidueChecks(baseline);
            Console.WriteLine();
            Console.WriteLine(string.Format("RESULT: {0} passed, {1} failed", _pass, _fail));
            return _fail == 0 ? 0 : 1;
        }
    }
}





