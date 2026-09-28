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

namespace Phase4Harness
{
    /// <summary>
    /// Phase 4 verification harness: heartbeat + connection-loss detection against
    /// the REAL development database inside ONE transaction that is always rolled
    /// back, then residue re-checked from a FRESH context. Covers the full 26-case
    /// matrix (happy paths, authz denials, column security, staleness derivation,
    /// sweep dedupe, transition-only audits, ended-session immutability). The
    /// .exe.config sets MonitoringHeartbeatTimeoutSeconds=999 so the tests can
    /// PROVE the config key is honored (a 60s-old beat stays Connected, which the
    /// 15s default would not). Exit code 0 = all passed. Phase 3 regression runs
    /// separately via the phase3 harness with the freshly built DLL.
    /// </summary>
    internal static class Program
    {
        private static int _pass;
        private static int _fail;

        private static void Expect(string name, bool ok, string detail = "")
        {
            if (ok) { _pass++; Console.WriteLine("PASS  " + name); }
            else { _fail++; Console.WriteLine("FAIL  " + name + (string.IsNullOrEmpty(detail) ? "" : "  [" + detail + "]")); }
        }

        private static MonitoringDenial DenialOf(Action action, string name)
        {
            try { action(); }
            catch (MonitoringAccessException ex) { return ex.Denial; }
            catch (Exception ex)
            {
                _fail++; Console.WriteLine("FAIL  " + name + " unexpected exception: " + ex.Message);
                return MonitoringDenial.Allowed;
            }
            _fail++; Console.WriteLine("FAIL  " + name + " (no exception thrown)");
            return MonitoringDenial.Allowed;
        }

        private static HttpResponseMessage Exec(IHttpActionResult result)
        {
            return result.ExecuteAsync(CancellationToken.None).GetAwaiter().GetResult();
        }

        private static string BodyOf(HttpResponseMessage resp)
        {
            return resp.Content == null ? "" : resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
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

        private class SessionRow
        {
            public int MonitorSession_ID { get; set; }
            public string Status { get; set; }
            public DateTime? ParentHeartbeatUtc { get; set; }
            public DateTime? SitterHeartbeatUtc { get; set; }
            public DateTime? EndedAtUtc { get; set; }
        }

        private static SessionRow Row(BabySitterBooking_and_BabyMinderEntities db, int job, int child)
        {
            return db.Database.SqlQuery<SessionRow>(
                "SELECT MonitorSession_ID, Status, ParentHeartbeatUtc, SitterHeartbeatUtc, EndedAtUtc " +
                "FROM MonitorSession WHERE Job_ID = @p0 AND Child_ID = @p1 AND IsDeleted = 0",
                job, child).Single();
        }

        private static int CountEvents(BabySitterBooking_and_BabyMinderEntities db, int job, int child, string type, string role = null)
        {
            if (role == null)
                return db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = @p0 AND Child_ID = @p1 AND EventType = @p2",
                    job, child, type).Single();
            return db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = @p0 AND Child_ID = @p1 AND EventType = @p2 AND ActorRole = @p3",
                job, child, type, role).Single();
        }

        private static int CountSessions(BabySitterBooking_and_BabyMinderEntities db, int job, int child)
        {
            return db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorSession WHERE Job_ID = @p0 AND Child_ID = @p1 AND IsDeleted = 0",
                job, child).Single();
        }

        private static void SetBeat(BabySitterBooking_and_BabyMinderEntities db, int job, int child, string column, DateTime utc)
        {
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitorSession SET " + column + " = @p0 WHERE Job_ID = @p1 AND Child_ID = @p2 AND IsDeleted = 0",
                utc, job, child);
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
                for (int i = 0; i < rows.Count; i++) { map[i, 0] = rows[i].Job_ID.ToString(); map[i, 1] = rows[i].Status; }
                return map;
            }
        }

        private static int[] SnapshotCounts()
        {
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                return new[]
                {
                    db.Database.SqlQuery<int>("SELECT COUNT(*) FROM MonitorSession").Single(),
                    db.Database.SqlQuery<int>("SELECT COUNT(*) FROM MonitorEvent").Single(),
                    db.Database.SqlQuery<int>("SELECT COUNT(*) FROM ChildGuardian").Single()
                };
            }
        }

        private static void RunFixtures(BabySitterBooking_and_BabyMinderEntities db)
        {
            // PHASE 7 MIGRATION NOTE (2026-09-28): this fixture assumed
            // ChildGuardian was EMPTY in the live database. Phase 7 now backfills
            // ChildGuardian from Child.Parent_ID
            // (docs/database/phase7_guardian_pause_dnd.sql), so the (27,34) row
            // this harness needs already exists and a blind INSERT would violate
            // UQ_ChildGuardian_Child_Parent.
            //
            // FIX: the harness now establishes its OWN clean slate. No assertion
            // and no expected value changed - only the fixture. The R3 residue
            // check is unaffected because the DELETE and the INSERT both run
            // inside the rolled-back transaction.
            db.Database.ExecuteSqlCommand("DELETE FROM ChildGuardian");
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) VALUES (27, 34, N'TestFixture', 1, 0, 0)");
            // No live job is InProgress - flip statuses for positive tests (ROLLBACK restores).
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 170");
            Console.WriteLine("[TX] fixtures: guardian(27,34); jobs 171/170='In Progress' (168 stays 'Assigned' for denials)");
        }

        // ===== Group A + F: heartbeat happy path, column security, hygiene =====
        private static int RunBasic(BabySitterBooking_and_BabyMinderEntities db, MonitoringService svc)
        {
            var s27 = svc.StartSession(171, 27, 19, "Sitter");
            var s29 = svc.StartSession(171, 29, 19, "Sitter");
            Expect("A0 start sessions child27+child29 -> both Active, distinct ids",
                s27 != null && s29 != null && s27.Status == "Active" && s29.Status == "Active" &&
                s27.MonitorSession_ID != s29.MonitorSession_ID);

            var hb1 = svc.SendHeartbeat(171, 27, 19, "Sitter");
            Expect("T4-1 sitter heartbeat -> Ok=true", hb1 != null && hb1.Ok);

            var r0 = Row(db, 171, 27);
            Expect("T4-3a sitter beat touched ONLY SitterHeartbeatUtc (parent still NULL)",
                r0.ParentHeartbeatUtc == null && r0.SitterHeartbeatUtc != null);
            var sitterStamp1 = r0.SitterHeartbeatUtc;

            var hb2 = svc.SendHeartbeat(171, 27, 34, "Parent");
            Expect("T4-2 parent heartbeat -> Ok=true", hb2 != null && hb2.Ok);
            var r1 = Row(db, 171, 27);
            Expect("T4-3b parent beat touched ONLY ParentHeartbeatUtc (sitter stamp unchanged)",
                r1.ParentHeartbeatUtc != null && r1.SitterHeartbeatUtc == sitterStamp1);

            var now = DateTime.UtcNow;
            Expect("T4-4a stamp is server UTC (within 60s of now)",
                r1.SitterHeartbeatUtc.HasValue && Math.Abs((r1.SitterHeartbeatUtc.Value - now).TotalSeconds) < 60);
            Expect("T4-4b response ServerTimeUtc is server UTC (within 60s of now)",
                Math.Abs((hb2.ServerTimeUtc - now).TotalSeconds) < 60);

            // T4-5/T4-23: client cannot send a timestamp, role or column selector -
            // the request contract physically has no such field, and the response
            // leaks no room/token/database internals.
            var reqProps = typeof(HeartbeatMonitoringRequest).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray();
            var resProps = typeof(HeartbeatResponse).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray();
            Expect("T4-5 request DTO has ONLY JobId+ChildId (no heartbeatUtc/role/sessionId)",
                reqProps.SequenceEqual(new[] { "ChildId", "JobId" }), string.Join(",", reqProps));
            Expect("T4-23 response DTO has ONLY Ok+ServerTimeUtc (no RoomName/token/db internals)",
                resProps.SequenceEqual(new[] { "Ok", "ServerTimeUtc" }), string.Join(",", resProps));

            // T4-20: heartbeats on child27 never touch child29's independent session
            var r29 = Row(db, 171, 29);
            Expect("T4-20 other child's session untouched (29 both stamps NULL)",
                r29.ParentHeartbeatUtc == null && r29.SitterHeartbeatUtc == null);

            var c = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session/heartbeat");
            var resp = Exec(c.Heartbeat(new HeartbeatMonitoringRequest { JobId = 171, ChildId = 27 }));
            var body = BodyOf(resp);
            Expect("C4-1 controller heartbeat -> 200 Ok=true, no RoomName/token in body",
                resp.StatusCode == HttpStatusCode.OK && body.Contains("\"Ok\":true") &&
                !body.Contains("RoomName") && !body.Contains("Token"),
                (int)resp.StatusCode + " " + body);
            var resp400 = Exec(c.Heartbeat(new HeartbeatMonitoringRequest { JobId = 0, ChildId = 27 }));
            Expect("C4-2 controller heartbeat invalid ids -> 400", resp400.StatusCode == HttpStatusCode.BadRequest);
            var respNull = Exec(c.Heartbeat(null));
            Expect("C4-3 controller heartbeat missing body -> 400", respNull.StatusCode == HttpStatusCode.BadRequest);

            return s27.MonitorSession_ID;
        }

        // ===== Group B: denials reuse the Phase 3 MonitoringAccess chain =====
        private static void RunDenials(BabySitterBooking_and_BabyMinderEntities db, MonitoringService svc)
        {
            Expect("T4-8 sitter not assigned (sitter20) -> NotAssignedSitter",
                DenialOf(() => svc.SendHeartbeat(171, 27, 20, "Sitter"), "T4-8") == MonitoringDenial.NotAssignedSitter);
            Expect("T4-9 parent not guardian (parent1) -> NotGuardian",
                DenialOf(() => svc.SendHeartbeat(171, 27, 1, "Parent"), "T4-9") == MonitoringDenial.NotGuardian);
            Expect("T4-6 wrong child in job (sitter19 + child5, not in JobChildren) -> ChildNotInJob",
                DenialOf(() => svc.SendHeartbeat(171, 5, 19, "Sitter"), "T4-6") == MonitoringDenial.ChildNotInJob);
            Expect("T4-7 parent + child5 (not own child) -> NotGuardian",
                DenialOf(() => svc.SendHeartbeat(171, 5, 34, "Parent"), "T4-7") == MonitoringDenial.NotGuardian);
            Expect("T4-10 job status 'Assigned' (job168) -> JobNotInProgress",
                DenialOf(() => svc.SendHeartbeat(168, 27, 19, "Sitter"), "T4-10") == MonitoringDenial.JobNotInProgress);

            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'SitterArrived' WHERE Job_ID = 171");
            Expect("T4-11 job status 'SitterArrived' -> JobNotInProgress",
                DenialOf(() => svc.SendHeartbeat(171, 27, 19, "Sitter"), "T4-11") == MonitoringDenial.JobNotInProgress);
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");

            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'Completed' WHERE Job_ID = 171");
            Expect("T4-12 job status 'Completed' -> JobNotInProgress",
                DenialOf(() => svc.SendHeartbeat(171, 27, 19, "Sitter"), "T4-12") == MonitoringDenial.JobNotInProgress);
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");

            // T4-21: guardian of child27 CANNOT touch child29's separate session.
            var r29Before = Row(db, 171, 29);
            Expect("T4-21 parent34 has no guardian right on child29 -> NotGuardian",
                DenialOf(() => svc.SendHeartbeat(171, 29, 34, "Parent"), "T4-21") == MonitoringDenial.NotGuardian);
            var r29After = Row(db, 171, 29);
            Expect("T4-21b child29 stamps unchanged by denied attempt",
                r29Before.ParentHeartbeatUtc == r29After.ParentHeartbeatUtc &&
                r29Before.SitterHeartbeatUtc == r29After.SitterHeartbeatUtc);

            // T4-22: another Job cannot be affected - no job168 session exists/created.
            Expect("T4-22 no MonitorSession exists for job168 after denied heartbeat",
                CountSessions(db, 168, 27) == 0);

            var before = Row(db, 171, 27);
            var parentStamp = before.ParentHeartbeatUtc;
            var sitterStamp = before.SitterHeartbeatUtc;
            var c = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session/heartbeat");
            var resp = Exec(c.Heartbeat(new HeartbeatMonitoringRequest { JobId = 999999, ChildId = 27 }));
            Expect("C4-4 controller heartbeat nonexistent job -> 404 (JobNotFound semantics)",
                resp.StatusCode == HttpStatusCode.NotFound, ((int)resp.StatusCode).ToString());
            var respJob168 = Exec(c.Heartbeat(new HeartbeatMonitoringRequest { JobId = 168, ChildId = 27 }));
            Expect("C4-4b controller heartbeat existing but 'Assigned' job -> 403 (JobNotInProgress)",
                respJob168.StatusCode == HttpStatusCode.Forbidden, ((int)respJob168.StatusCode).ToString());

            var after = Row(db, 171, 27);
            Expect("denied attempts changed NO heartbeat columns on 27",
                after.ParentHeartbeatUtc == parentStamp && after.SitterHeartbeatUtc == sitterStamp);
            var deniedAudits = CountEvents(db, 171, 27, "SessionAccessDenied");
            Expect("each denied heartbeat wrote SessionAccessDenied audit on (171,27): exactly 4",
                deniedAudits == 4, deniedAudits.ToString());
            Expect("no ConnectionLost yet (beats fresh; denials never sweep)",
                CountEvents(db, 171, 27, "ConnectionLost") == 0);
        }

        // ===== Group C: derivation, sweep dedupe, config timeout, enriched GET =====
        private static void RunDerivation(BabySitterBooking_and_BabyMinderEntities db, MonitoringService svc)
        {
            var g = svc.GetSession(171, 27, 19, "Sitter");
            Expect("T4-13 GET shows both connections Connected (beats fresh)",
                g != null && g.ParentConnection == "Connected" && g.SitterConnection == "Connected" &&
                g.ParentHeartbeatUtc.HasValue && g.SitterHeartbeatUtc.HasValue);

            var g29 = svc.GetSession(171, 29, 19, "Sitter");
            Expect("T4-13b never-beaten session derives Lost/Lost with NULL stamps",
                g29 != null && g29.ParentConnection == "Lost" && g29.SitterConnection == "Lost" &&
                g29.ParentHeartbeatUtc == null && g29.SitterHeartbeatUtc == null);
            Expect("never-beaten sweep writes NO ConnectionLost (nothing ever connected)",
                CountEvents(db, 171, 29, "ConnectionLost") == 0);

            // T4-14: parent beat aged past the 999s configured timeout -> Lost,
            // while the sitter side (fresh) stays Connected - independent sides.
            SetBeat(db, 171, 27, "ParentHeartbeatUtc", DateTime.UtcNow.AddSeconds(-2000));
            var g14 = svc.GetSession(171, 27, 19, "Sitter");
            Expect("T4-14 stale parent -> ParentConnection=Lost, Sitter stays Connected",
                g14.ParentConnection == "Lost" && g14.SitterConnection == "Connected",
                g14.ParentConnection + "/" + g14.SitterConnection);

            // T4-15: repeated polls of the SAME stale beat -> exactly one audit.
            svc.GetSession(171, 27, 19, "Sitter");
            svc.GetSession(171, 27, 19, "Sitter");
            var lostParent = CountEvents(db, 171, 27, "ConnectionLost", "Parent");
            var lostAll = CountEvents(db, 171, 27, "ConnectionLost");
            Expect("T4-15 three polls after staleness -> exactly ONE ConnectionLost total",
                lostParent == 1 && lostAll == 1, "parent=" + lostParent + " all=" + lostAll);

            var shape = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = 171 AND Child_ID = 27 " +
                "AND EventType = 'ConnectionLost' AND ActorRole = 'Parent' AND ActorUserId = 0 " +
                "AND PayloadJson LIKE '%side%' AND PayloadJson LIKE '%timeoutSeconds%'").Single();
            Expect("T4-15b ConnectionLost audit shape: server actor 0, role=Parent, payload side+timeout",
                shape == 1, shape.ToString());

            // Config proof: with exe.config timeout=999 a 60s-old beat is still
            // Connected - the hardcoded 15s default would have said Lost here,
            // so this test FAILS if MonitoringHeartbeatTimeoutSeconds is ignored.
            SetBeat(db, 171, 27, "ParentHeartbeatUtc", DateTime.UtcNow.AddSeconds(-60));
            var g15 = svc.GetSession(171, 27, 19, "Sitter");
            Expect("config honored: 60s-old beat still Connected (timeout=999 from .exe.config, not default 15)",
                g15.ParentConnection == "Connected", g15.ParentConnection);
            Expect("config re-stale sweep added no bogus audit (beat fresh again)",
                CountEvents(db, 171, 27, "ConnectionLost") == 1);

            // C4-6: authorized GET carries the connection fields to the client.
            var cg = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/session?jobId=171&childId=27");
            var gresp = Exec(cg.GetSession(171, 27));
            var gbody = BodyOf(gresp);
            Expect("C4-6 GET body includes ParentConnection+SitterConnection+heartbeat stamps",
                gresp.StatusCode == HttpStatusCode.OK && gbody.Contains("ParentConnection") &&
                gbody.Contains("SitterConnection") && gbody.Contains("SitterHeartbeatUtc"),
                (int)gresp.StatusCode + " " + gbody);

            // C4-7: authorized GET without any session -> 404 (job170 has none).
            var c404 = MakeController(db, 34, "Parent", "http://localhost/api/monitoring/session?jobId=170&childId=27");
            var r404 = Exec(c404.GetSession(170, 27));
            Expect("C4-7 GET with no monitor session -> 404", r404.StatusCode == HttpStatusCode.NotFound,
                ((int)r404.StatusCode).ToString());
        }

        // ===== Group D: transition-only audits (Connected<->Lost, no per-beat spam) =====
        private static void RunTransitions(BabySitterBooking_and_BabyMinderEntities db, MonitoringService svc, int s27Id)
        {
            // Re-stale the SAME episode (backdated beat): sweep stays SILENT because
            // the earlier ConnectionLost row post-dates this fake-old beat
            // (dedupe: event AtUtc >= lastBeat) - repeated polls never duplicate.
            SetBeat(db, 171, 27, "ParentHeartbeatUtc", DateTime.UtcNow.AddSeconds(-2000));
            svc.GetSession(171, 27, 19, "Sitter");
            svc.GetSession(171, 27, 19, "Sitter");
            Expect("T4-15c re-staled same episode -> still exactly one ConnectionLost",
                CountEvents(db, 171, 27, "ConnectionLost") == 1);

            // T4-16: Lost -> Connected is audited by the authorized heartbeat, once.
            var hb = svc.SendHeartbeat(171, 27, 34, "Parent");
            var restored = CountEvents(db, 171, 27, "ConnectionRestored");
            var restoredParent = CountEvents(db, 171, 27, "ConnectionRestored", "Parent");
            Expect("T4-16 heartbeat after loss -> exactly one ConnectionRestored (Parent side)",
                hb.Ok && restored == 1 && restoredParent == 1,
                "all=" + restored + " parent=" + restoredParent);

            // T4-17: SAME session retained - no new row, still Active, same id,
            // and restoration never re-created anything.
            var row = Row(db, 171, 27);
            Expect("T4-17 restoration keeps SAME session (same id, Active, one row)",
                row.MonitorSession_ID == s27Id && row.Status == "Active" && CountSessions(db, 171, 27) == 1);
            var g = svc.GetSession(171, 27, 19, "Sitter");
            Expect("T4-16b parent derives Connected after restore", g.ParentConnection == "Connected");

            // Transition-only policy: ordinary beats write NO MonitorEvent rows.
            var totalBefore = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = 171 AND Child_ID = 27").Single();
            svc.SendHeartbeat(171, 27, 34, "Parent");
            svc.SendHeartbeat(171, 27, 19, "Sitter");
            var totalAfter = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = 171 AND Child_ID = 27").Single();
            Expect("ordinary beats write NO audit rows (transition-only policy)",
                totalAfter == totalBefore, totalBefore + "->" + totalAfter);

            // ---- second participant: FULL repeated loss/restore cycle ----
            var hb29 = svc.SendHeartbeat(171, 29, 19, "Sitter");
            Expect("first-ever beat on 29 connects SILENTLY (no ConnectionRestored)",
                hb29.Ok && CountEvents(db, 171, 29, "ConnectionRestored") == 0 &&
                Row(db, 171, 29).SitterHeartbeatUtc != null);

            SetBeat(db, 171, 29, "SitterHeartbeatUtc", DateTime.UtcNow.AddSeconds(-2000));
            svc.GetSession(171, 29, 19, "Sitter");
            svc.GetSession(171, 29, 19, "Sitter");
            Expect("episode 1: first loss -> exactly one ConnectionLost",
                CountEvents(db, 171, 29, "ConnectionLost") == 1);
            svc.SendHeartbeat(171, 29, 19, "Sitter");
            Expect("episode 1: restore -> ConnectionRestored=1 and Connected again",
                CountEvents(db, 171, 29, "ConnectionRestored") == 1 &&
                svc.GetSession(171, 29, 19, "Sitter").SitterConnection == "Connected");

            // Time compression (test-only, rolled back): normally a second loss
            // happens minutes later, when the fresh beat already post-dates the
            // first audit. We age the first audit row so a backdated re-stale
            // forms a genuinely NEW episode per the dedupe rule.
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitorEvent SET AtUtc = DATEADD(day, -365, AtUtc) " +
                "WHERE Job_ID = 171 AND Child_ID = 29 AND EventType = 'ConnectionLost'");
            SetBeat(db, 171, 29, "SitterHeartbeatUtc", DateTime.UtcNow.AddSeconds(-2000));
            svc.GetSession(171, 29, 19, "Sitter");
            svc.GetSession(171, 29, 19, "Sitter");
            Expect("episode 2: loss after restore -> second ConnectionLost (total 2, no dupes)",
                CountEvents(db, 171, 29, "ConnectionLost") == 2);
            svc.SendHeartbeat(171, 29, 19, "Sitter");
            Expect("episode 2: second restore -> ConnectionRestored total 2",
                CountEvents(db, 171, 29, "ConnectionRestored") == 2);
        }

        // ===== Group E: an Ended session is immutable for heartbeat/sweep =====
        private static void RunEnded(BabySitterBooking_and_BabyMinderEntities db, MonitoringService svc)
        {
            var ended = svc.EndSession(171, 29, 19, "Sitter");
            Expect("E0 end child29 session -> Status Ended, EndedAtUtc stamped",
                ended != null && ended.Status == "Ended" && ended.EndedAtUtc != null);
            var endedAt = Row(db, 171, 29).EndedAtUtc;

            Expect("T4-18 heartbeat on Ended session -> SessionNotFound (404 semantics)",
                DenialOf(() => svc.SendHeartbeat(171, 29, 19, "Sitter"), "T4-18") ==
                MonitoringDenial.SessionNotFound);

            var row = Row(db, 171, 29);
            Expect("T4-19 ended session NOT reopened (still Ended, same EndedAtUtc, one row)",
                row.Status == "Ended" && row.EndedAtUtc == endedAt && CountSessions(db, 171, 29) == 1);

            // Make staleness OBVIOUS so a wrongly-swept Ended session would emit:
            // age the audits past any dedupe and backdate the beat. If sweep ran
            // on Ended sessions this would grow the counts - it must not.
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitorEvent SET AtUtc = DATEADD(day, -365, AtUtc) " +
                "WHERE Job_ID = 171 AND Child_ID = 29 AND EventType = 'ConnectionLost'");
            SetBeat(db, 171, 29, "SitterHeartbeatUtc", DateTime.UtcNow.AddSeconds(-2000));

            var g = svc.GetSession(171, 29, 19, "Sitter");
            Expect("GET after end returns Ended DTO with connection fields still derived",
                g != null && g.Status == "Ended" && g.SitterConnection != null && g.ParentConnection != null);
            Expect("sweep SKIPPED for Ended session (event counts unchanged)",
                CountEvents(db, 171, 29, "ConnectionLost") == 2 &&
                CountEvents(db, 171, 29, "ConnectionRestored") == 2);

            // Ending one child's session never touched the sibling's session.
            var r27 = svc.SendHeartbeat(171, 27, 19, "Sitter");
            Expect("sibling session (27) unaffected by ending 29 -> still Active",
                r27.Ok && Row(db, 171, 27).Status == "Active");
        }

        private static void RunInvariants(BabySitterBooking_and_BabyMinderEntities db, int baselineConnEvents)
        {
            var noActor = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE ActorUserId IS NULL OR ActorRole IS NULL OR EventType IS NULL").Single();
            Expect("audit invariant: NO MonitorEvent row lacks ActorUserId/ActorRole/EventType",
                noActor == 0, noActor.ToString());

            var connTotal = db.Database.SqlQuery<int>(
                "SELECT COUNT(*) FROM MonitorEvent WHERE EventType IN ('ConnectionLost','ConnectionRestored')").Single();
            Expect("Phase 4 wrote exactly 3 ConnectionLost + 3 ConnectionRestored " +
                "(1 cycle on child27 + 2 full cycles on child29; baseline " +
                baselineConnEvents + "->" + connTotal + ")",
                connTotal == baselineConnEvents + 6, connTotal.ToString());
        }

        private static void RunResidue(int[] baselineCounts, string[,] baselineJobs)
        {
            var after = SnapshotCounts();
            Expect("R1 residue: MonitorSession count == baseline (" + baselineCounts[0] + ")",
                after[0] == baselineCounts[0], after[0].ToString());
            Expect("R2 residue: MonitorEvent count == baseline (" + baselineCounts[1] + ")",
                after[1] == baselineCounts[1], after[1].ToString());
            Expect("R3 residue: ChildGuardian count == baseline (" + baselineCounts[2] + ")",
                after[2] == baselineCounts[2], after[2].ToString());

            var now = SnapshotJobStatuses();
            bool same = baselineJobs.GetLength(0) == now.GetLength(0);
            string detail = "";
            if (same)
            {
                for (int i = 0; i < baselineJobs.GetLength(0); i++)
                {
                    if (baselineJobs[i, 0] != now[i, 0] || baselineJobs[i, 1] != now[i, 1])
                    {
                        same = false;
                        detail += baselineJobs[i, 0] + ":" + baselineJobs[i, 1] + "->" + now[i, 1] + " ";
                    }
                }
            }
            Expect("R4 residue: job statuses identical to baseline", same, detail);
        }

        private static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            var baselineCounts = SnapshotCounts();
            var baselineJobs = SnapshotJobStatuses();
            int baselineConnEvents;
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                baselineConnEvents = db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM MonitorEvent WHERE EventType IN ('ConnectionLost','ConnectionRestored')").Single();
            }
            Console.WriteLine("[BASE] MonitorSession/MonitorEvent/ChildGuardian counts, job statuses, " +
                "connection-event baseline (" + baselineConnEvents + ") captured");

            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            using (var tx = db.Database.BeginTransaction())
            {
                try
                {
                    RunFixtures(db);
                    var svc = new MonitoringService(db, ownsContext: false);
                    var s27Id = RunBasic(db, svc);
                    RunDenials(db, svc);
                    RunDerivation(db, svc);
                    RunTransitions(db, svc, s27Id);
                    RunEnded(db, svc);
                    RunInvariants(db, baselineConnEvents);
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

            RunResidue(baselineCounts, baselineJobs);
            Console.WriteLine();
            Console.WriteLine(string.Format("RESULT: {0} passed, {1} failed", _pass, _fail));
            return _fail == 0 ? 0 : 1;
        }
    }
}







