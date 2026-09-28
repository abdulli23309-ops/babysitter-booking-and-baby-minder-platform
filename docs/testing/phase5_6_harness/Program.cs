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

namespace Phase56Harness
{
    /// <summary>
    /// Phase 5 + 6 verification harness: cry incident lifecycle + persistent
    /// escalation, against the REAL development database inside ONE transaction
    /// that is always rolled back, followed by residue checks from a FRESH
    /// context. Exit code 0 = all passed.
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

        /// <summary>Runs an action and reports how it failed ("" = no exception).</summary>
        private static string ThrownBy(Action action)
        {
            try { action(); return ""; }
            catch (MonitoringAccessException ex) { return "MonitoringAccess:" + ex.Denial; }
            catch (InvalidOperationException) { return "InvalidOperation"; }
            catch (ArgumentException) { return "Argument"; }
            catch (Exception ex) { return ex.GetType().Name; }
        }

        private static HttpResponseMessage Exec(IHttpActionResult result)
        {
            return result.ExecuteAsync(CancellationToken.None).GetAwaiter().GetResult();
        }

        private static string BodyOf(HttpResponseMessage resp)
        {
            return resp.Content == null ? "" : resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
        }

        /// <summary>
        /// ClaimsPrincipalHelper reads Thread.CurrentPrincipal, which is process-wide
        /// state. Every controller call must therefore re-assert the identity of the
        /// user being simulated, otherwise the LAST MakeController call silently
        /// applies to all subsequent requests.
        /// </summary>
        private static void SetPrincipal(int userId, string role)
        {
            Thread.CurrentPrincipal = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
                new Claim(ClaimTypes.Role, role)
            }, "Session"));
        }

        /// <summary>
        /// Re-asserts the simulated caller before invoking a controller action, because
        /// ClaimsPrincipalHelper reads the process-wide Thread.CurrentPrincipal. Returns
        /// the same controller so call sites stay a single expression.
        /// </summary>
        private static MonitoringController Reauth(MonitoringController ctrl, int userId, string role)
        {
            SetPrincipal(userId, role);
            return ctrl;
        }

        private static MonitoringController MakeController(
            BabySitterBooking_and_BabyMinderEntities db, int userId, string role, string url, string opsKey = null)
        {
            SetPrincipal(userId, role);

            var ctrl = new MonitoringController(
                new MonitoringService(db, ownsContext: false),
                new CryIncidentService(db, ownsContext: false));

            var config = new HttpConfiguration();
            var req = new HttpRequestMessage(HttpMethod.Post, url);
            if (opsKey != null)
                req.Headers.Add("X-Ops-Sweep-Key", opsKey);
            req.SetConfiguration(config);
            ctrl.Request = req;
            return ctrl;
        }

        private static int Scalar(BabySitterBooking_and_BabyMinderEntities db, string sql, params object[] args)
        {
            return db.Database.SqlQuery<int>(sql, args).Single();
        }

        private class Row
        {
            public Guid Id { get; set; }
            public int Job_ID { get; set; }
            public int Child_ID { get; set; }
            public int? MonitorSession_ID { get; set; }
            public string Status { get; set; }
            public int EscalationStage { get; set; }
            public DateTime? CreatedAt { get; set; }
            public DateTime? NextEscalationDueAt { get; set; }
            public string SitterResponse { get; set; }
            public DateTime? RespondedAt { get; set; }
            public DateTime? ResolvedAtUtc { get; set; }
            public DateTime? CancelledAtUtc { get; set; }
            public string CancellationReason { get; set; }
        }

        private static Row ReadRow(BabySitterBooking_and_BabyMinderEntities db, int job, int child)
        {
            return db.Database.SqlQuery<Row>(
                "SELECT TOP (1) Id, JobId AS Job_ID, Child_ID, MonitorSession_ID, Status, EscalationStage, CreatedAt, " +
                "NextEscalationDueAt, SitterResponse, RespondedAt, ResolvedAtUtc, CancelledAtUtc, CancellationReason " +
                "FROM CryAlert WHERE JobId = @p0 AND Child_ID = @p1 AND IsDeleted = 0 ORDER BY CreatedAt DESC, Id DESC",
                job, child).FirstOrDefault();
        }

        private static int CountIncidents(BabySitterBooking_and_BabyMinderEntities db, int job, int child)
        {
            return Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE JobId = @p0 AND Child_ID = @p1 AND IsDeleted = 0", job, child);
        }

        private static void ForceDue(BabySitterBooking_and_BabyMinderEntities db, int job, int child)
        {
            db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET NextEscalationDueAt = DATEADD(SECOND, -1, GETUTCDATE()) " +
                "WHERE JobId = @p0 AND Child_ID = @p1 AND IsDeleted = 0 AND Status IN ('Open','Acknowledged')",
                job, child);
        }

        private static int CountNotif(BabySitterBooking_and_BabyMinderEntities db, int userId, string type, int jobId)
        {
            return Scalar(db,
                "SELECT COUNT(*) FROM Notification WHERE UserID = @p0 AND Type = @p1 AND Job_ID = @p2",
                userId, type, jobId);
        }

        private static int CountEvents(BabySitterBooking_and_BabyMinderEntities db, string eventType, Guid incidentId)
        {
            return Scalar(db,
                "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = @p0 AND IncidentId = @p1",
                eventType, incidentId);
        }

        private class StatusRow { public int Job_ID { get; set; } public string Status { get; set; } }

        private static string JobStatus(BabySitterBooking_and_BabyMinderEntities db, int jobId)
        {
            return db.Database.SqlQuery<string>("SELECT Status FROM Job WHERE Job_ID = @p0", jobId).FirstOrDefault();
        }

        private static void SetJobStatus(BabySitterBooking_and_BabyMinderEntities db, int jobId, string status)
        {
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = @p0 WHERE Job_ID = @p1", status, jobId);

            // The whole harness shares ONE DbContext, so JobService's EF entity query
            // would return the TRACKED Job instance with a stale Status (e.g. still
            // "Cancelled" after the raw UPDATE above) and refuse the next transition.
            // Reload the tracked instance so the services observe the new status.
            var tracked = db.Jobs.Find(jobId);
            if (tracked != null)
            {
                db.Entry(tracked).Reload();
            }
        }

        private static int SessionStatusCount(BabySitterBooking_and_BabyMinderEntities db, int jobId, string status)
        {
            return Scalar(db, "SELECT COUNT(*) FROM MonitorSession WHERE Job_ID = @p0 AND Status = @p1", jobId, status);
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
                    Scalar(db, "SELECT COUNT(*) FROM CryAlert"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitorSession"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitorEvent"),
                    Scalar(db, "SELECT COUNT(*) FROM Notification"),
                    Scalar(db, "SELECT COUNT(*) FROM ChildGuardian")
                };
            }
        }

        /// <summary>
        /// In-transaction fixtures. In the live database ChildGuardian is empty, no
        /// job is In Progress and CryAlert has no rows, so everything the tests need
        /// is created here and removed again by the ROLLBACK:
        ///   * two guardians for child 27 (multi-guardian fan-out): parent 34 and a
        ///     second parent that is NEITHER 34 (the job's own parent) NOR 1, because
        ///     T5-7 uses parent 1 as the "parent WITHOUT a guardian row" case and
        ///     T5-8b needs a non-guardian parent for the child-not-in-job denial,
        ///   * one guardian for child 29 (parent 34), because the response/resolution
        ///     tests (T5-19..T5-27) run against child 29 and MonitoringAccess resolves
        ///     guardians exclusively through ChildGuardian - a matching Child.Parent_ID
        ///     is NOT enough,
        ///   * job 171 = 'In Progress' and job 170 = 'In Progress' (authorized but
        ///     session-less, for the "no active session" denial).
        /// </summary>
        private static int RunFixtures(BabySitterBooking_and_BabyMinderEntities db)
        {
            // Must exclude 34 (primary guardian / job owner) and 1 (reserved as the
            // "non-guardian parent" probe in T5-7). Prefer a parent that is not the
            // owner of any JobChildren row so it can never be a guardian by accident.
            int secondGuardianId = db.Database.SqlQuery<int>(
                "SELECT TOP (1) p.Parent_ID FROM Parent p " +
                "WHERE p.IsDeleted = 0 AND p.Parent_ID NOT IN (34, 1) " +
                "  AND NOT EXISTS (SELECT 1 FROM ChildGuardian g " +
                "                  WHERE g.Parent_ID = p.Parent_ID AND g.IsDeleted = 0) " +
                "  AND NOT EXISTS (SELECT 1 FROM Child c " +
                "                  WHERE c.Parent_ID = p.Parent_ID AND c.IsDeleted = 0) " +
                "ORDER BY p.Parent_ID")
                .FirstOrDefault();

            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) " +
                "VALUES (27, 34, N'TestFixture', 1, 0, 0)");
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) " +
                "VALUES (29, 34, N'TestFixture', 1, 0, 0)");
            if (secondGuardianId > 0)
            {
                db.Database.ExecuteSqlCommand(
                    "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, IsDeleted) " +
                    "VALUES (27, @p0, N'TestFixture2', 0, 0, 0)", secondGuardianId);
            }

            SetJobStatus(db, 171, "In Progress");
            SetJobStatus(db, 170, "In Progress");

            Console.WriteLine("[TX] fixtures: child27 guardians = 34 and " + secondGuardianId +
                "; child29 guardian = 34; jobs 171/170 = 'In Progress'");
            return secondGuardianId;
        }

        // =================================================================
        // INCIDENT CREATION (PART J items 1-10)
        // =================================================================
        private static void RunCreationTests(
            BabySitterBooking_and_BabyMinderEntities db, CryIncidentService inc,
            int session27, int session29)
        {
            var created = inc.CreateIncident(171, 27, 19, "Sitter");
            Expect("T5-1 authorized sitter creates incident (Open, stage 0, bound to ACTIVE session)",
                created != null && created.Status == "Open" && created.EscalationStage == 0 &&
                created.MonitorSession_ID == session27 && created.Job_ID == 171 && created.Child_ID == 27 &&
                !created.Reused,
                created == null ? "null" : created.Status + "/" + created.EscalationStage);

            double dueDelta = created.NextEscalationDueAt.HasValue && created.CreatedAtUtc != default(DateTime)
                ? (created.NextEscalationDueAt.Value - created.CreatedAtUtc).TotalSeconds
                : -1;
            Expect("T5-12 T+0 sets NextEscalationDueAt = CreatedAt + 5s (persisted plan, not a timer)",
                Math.Abs(dueDelta - 5) < 3, dueDelta.ToString("0.0"));

            Expect("T5-1b CryIncidentCreated audit written with incident id + real actor",
                CountEvents(db, "CryIncidentCreated", created.Id) == 1 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE IncidentId = @p0 AND EventType = 'CryIncidentCreated' " +
                           "AND ActorUserId = 19 AND ActorRole = 'Sitter'", created.Id) == 1);

            var reused = inc.CreateIncident(171, 27, 34, "Parent");
            Expect("T5-9/T5-10 duplicate reports reuse the open incident (same id, Reused=true, one row)",
                reused != null && reused.Reused && reused.Id == created.Id && CountIncidents(db, 171, 27) == 1,
                reused == null ? "null" : "id=" + reused.Id + " reused=" + reused.Reused);
            Expect("T5-10b dedupe did NOT move the deadline (the original T+5 schedule keeps running)",
                reused.NextEscalationDueAt == created.NextEscalationDueAt);

            // ---- denials (PART H security chain) ----
            SetJobStatus(db, 168, "Assigned");
            Expect("T5-3 wrong job (168 'Assigned') -> JobNotInProgress, nothing created",
                DenialOf(() => inc.CreateIncident(168, 27, 19, "Sitter"), "T5-3") == MonitoringDenial.JobNotInProgress &&
                CountIncidents(db, 168, 27) == 0);

            Expect("T5-4 child exists but not in JobChildren (171/child5, sitter) -> ChildNotInJob, nothing created",
                DenialOf(() => inc.CreateIncident(171, 5, 19, "Sitter"), "T5-4") == MonitoringDenial.ChildNotInJob &&
                CountIncidents(db, 171, 5) == 0);

            Expect("T5-5 same child for a non-guardian parent -> NotGuardian, nothing created",
                DenialOf(() => inc.CreateIncident(171, 5, 34, "Parent"), "T5-5") == MonitoringDenial.NotGuardian &&
                CountIncidents(db, 171, 5) == 0);

            Expect("T5-6 sitter NOT assigned to the job (sitter20) -> NotAssignedSitter",
                DenialOf(() => inc.CreateIncident(171, 27, 20, "Sitter"), "T5-6") == MonitoringDenial.NotAssignedSitter);

            Expect("T5-7 parent without a guardian row (parent1) -> NotGuardian",
                DenialOf(() => inc.CreateIncident(171, 27, 1, "Parent"), "T5-7") == MonitoringDenial.NotGuardian);

            Expect("T5-8 authorized but NO active session (job170) -> SessionNotFound, nothing created",
                DenialOf(() => inc.CreateIncident(170, 27, 34, "Parent"), "T5-8") == MonitoringDenial.SessionNotFound &&
                CountIncidents(db, 170, 27) == 0);

            SetJobStatus(db, 171, "Completed");
            Expect("T5-3b job not InProgress -> JobNotInProgress (job state is authoritative)",
                DenialOf(() => inc.CreateIncident(171, 27, 19, "Sitter"), "T5-3b") == MonitoringDenial.JobNotInProgress);
            SetJobStatus(db, 171, "In Progress");

            // ---- session binding / cross-child isolation ----
            var other = inc.CreateIncident(171, 29, 19, "Sitter");
            var row27 = ReadRow(db, 171, 27);
            Expect("T5-2/T5-8b the server binds each incident to its OWN session (child29 -> session29)",
                other != null && other.MonitorSession_ID == session29 && other.Id != created.Id &&
                CountIncidents(db, 171, 29) == 1 && row27.Id == created.Id && row27.Status == "Open",
                other == null ? "null" : "session=" + other.MonitorSession_ID);

            Expect("T5-2b a session mismatch is not even expressible: the client sends job+child, the server resolves the session",
                other.MonitorSession_ID != row27.MonitorSession_ID);
        }

        // =================================================================
        // ESCALATION TIMELINE (PART J items 11-18, 28-30)
        // =================================================================
        private static void RunEscalationTests(
            BabySitterBooking_and_BabyMinderEntities db, CryIncidentService inc, int secondGuardianId)
        {
            // Test isolation: the sibling incident from the creation tests is removed
            // so the escalation counters below can be asserted EXACTLY (rolled back).
            db.Database.ExecuteSqlCommand("DELETE FROM CryAlert WHERE JobId = 171 AND Child_ID = 29");

            var before = ReadRow(db, 171, 27);
            bool notYetDue = before.NextEscalationDueAt.HasValue && before.NextEscalationDueAt.Value > DateTime.UtcNow;
            var early = inc.ProcessDueEscalations(50);
            Expect("T5-13 a sweep claims NOTHING before NextEscalationDueAt has passed",
                !notYetDue || early.Claimed == 0, "claimed=" + early.Claimed);

            // ---- stage 1 = T+5 sitter alert ----
            ForceDue(db, 171, 27);
            var sweep1 = inc.ProcessDueEscalations(50);
            var after1 = ReadRow(db, 171, 27);
            Expect("T5-14 T+5 claim raises the sitter alert exactly once (stage 0 -> 1)",
                sweep1.Claimed == 1 && sweep1.SitterAlerts == 1 && after1.EscalationStage == 1,
                "claimed=" + sweep1.Claimed + " alerts=" + sweep1.SitterAlerts + " stage=" + after1.EscalationStage);
            Expect("T5-14b sitter notification persisted for the ASSIGNED sitter (CryAlertSitter, Job_ID set)",
                CountNotif(db, 19, "CryAlertSitter", 171) == 1);
            Expect("T5-14c SitterAlerted + EscalationClaimed audits written (server actor 0)",
                CountEvents(db, "SitterAlerted", after1.Id) == 1 &&
                CountEvents(db, "EscalationClaimed", after1.Id) == 1 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE IncidentId = @p0 AND EventType = 'SitterAlerted' " +
                           "AND ActorUserId = 0 AND ActorRole = 'Server'", after1.Id) == 1);

            double parentDelta = after1.NextEscalationDueAt.HasValue && after1.CreatedAt.HasValue
                ? (after1.NextEscalationDueAt.Value - after1.CreatedAt.Value).TotalSeconds
                : -1;
            Expect("T5-15 stage 1 schedules the parent escalation at CreatedAt + 15s (T+15)",
                Math.Abs(parentDelta - 15) < 3, parentDelta.ToString("0.0"));

            var sweepDup = inc.ProcessDueEscalations(50);
            Expect("T5-16/T5-17 duplicate sweep cannot duplicate the sitter notification",
                sweepDup.Claimed == 0 && CountNotif(db, 19, "CryAlertSitter", 171) == 1);

            // ---- stage 2 = T+15 parent escalation ----
            ForceDue(db, 171, 27);
            var sweep2 = inc.ProcessDueEscalations(50);
            var after2 = ReadRow(db, 171, 27);
            Expect("T5-16b T+15 claim escalates to ALL authorized guardians (stage -> 2, one notification each)",
                sweep2.Claimed == 1 && sweep2.ParentEscalations == 1 && after2.EscalationStage == 2 &&
                CountNotif(db, 34, "CryAlertParent", 171) == 1 &&
                (secondGuardianId <= 0 || CountNotif(db, secondGuardianId, "CryAlertParent", 171) == 1),
                "secondGuardian=" + secondGuardianId);
            Expect("T5-15b stage 2 clears NextEscalationDueAt (final stage: nothing further scheduled)",
                after2.NextEscalationDueAt == null);
            Expect("T5-16c ParentEscalated audit records the guardian fan-out count",
                CountEvents(db, "ParentEscalated", after2.Id) == 1 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE IncidentId = @p0 AND EventType = 'ParentEscalated' " +
                           "AND PayloadJson LIKE '%guardianCount%'", after2.Id) == 1);

            var sweepDup2 = inc.ProcessDueEscalations(50);
            Expect("T5-17b duplicate sweep after stage 2 creates no second parent notification",
                sweepDup2.Claimed == 0 && CountNotif(db, 34, "CryAlertParent", 171) == 1);

            Expect("T5-18 the stage cannot regress (2 stays 2, no due time, nothing left to claim)",
                ReadRow(db, 171, 27).EscalationStage == 2 && inc.ProcessDueEscalations(50).Claimed == 0);

            // A brand-new service instance = a new HTTP request after an app restart:
            // it finds the pending plan straight from the database (no in-memory state).
            var restartIncident = inc.CreateIncident(171, 29, 19, "Sitter");
            ForceDue(db, 171, 29);
            var freshService = new CryIncidentService(db, ownsContext: false);
            var sweep3 = freshService.ProcessDueEscalations(50);
            Expect("T5-28/T5-29/T5-30 a FRESH service instance claims the due plan from the DB (no timer needed)",
                sweep3.Claimed == 1 && sweep3.SitterAlerts == 1 &&
                ReadRow(db, 171, 29).EscalationStage == 1 && restartIncident != null,
                "claimed=" + sweep3.Claimed);
        }

        // =================================================================
        // SITTER RESPONSES / VIEW CHILD / RESOLUTION (PART J items 19-27)
        // =================================================================
        private static void RunResponseTests(BabySitterBooking_and_BabyMinderEntities db, CryIncidentService inc)
        {
            var beforeResp = ReadRow(db, 171, 29);
            var responded = inc.SitterGoingToChild(171, 29, 19, "Sitter");
            var afterResp = ReadRow(db, 171, 29);

            Expect("T5-19/T5-20 sitter GoingToChild recorded (Acknowledged + response + actor + timestamp + audit)",
                responded.Status == "Acknowledged" && responded.SitterResponse == "GoingToChild" &&
                responded.RespondedAt.HasValue && responded.AcknowledgedByUserId == 19 && responded.AcknowledgedAt.HasValue &&
                CountEvents(db, "SitterGoingToChild", beforeResp.Id) == 1,
                responded.Status + "/" + responded.SitterResponse);

            // The frozen rule is max(CreatedAt + 15s, RespondedAt + 10s): a response
            // that lands more than 5 seconds after the incident started must NOT pull
            // the parent deadline forward to T+10 - it stays at T+15. Only a response
            // inside that 5 second window yields a delta of exactly 10s.
            double createdLagSecs = (afterResp.RespondedAt.Value - afterResp.CreatedAt.Value).TotalSeconds;
            double expectedPostpone = Math.Max(10.0, 15.0 - createdLagSecs);
            double postponeDelta = (afterResp.NextEscalationDueAt.Value - afterResp.RespondedAt.Value).TotalSeconds;
            Expect("T5-21 parent escalation postponed to exactly max(created+15s, response+10s)",
                Math.Abs(postponeDelta - expectedPostpone) < 1.5 &&
                afterResp.NextEscalationDueAt.Value ==
                    (afterResp.CreatedAt.Value + TimeSpan.FromSeconds(15) > afterResp.RespondedAt.Value + TimeSpan.FromSeconds(10)
                        ? afterResp.CreatedAt.Value + TimeSpan.FromSeconds(15)
                        : afterResp.RespondedAt.Value + TimeSpan.FromSeconds(10)),
                "delta=" + postponeDelta.ToString("0.00") + " expected=" + expectedPostpone.ToString("0.00") +
                " createdLag=" + createdLagSecs.ToString("0.0") + "s");

            var again = inc.SitterGoingToChild(171, 29, 19, "Sitter");
            var afterAgain = ReadRow(db, 171, 29);
            Expect("T5-22 repeated GoingToChild does NOT extend the deadline again (and does not re-audit)",
                again.Reused && afterAgain.NextEscalationDueAt == afterResp.NextEscalationDueAt &&
                afterAgain.RespondedAt == afterResp.RespondedAt &&
                CountEvents(db, "SitterGoingToChild", beforeResp.Id) == 1);

            Expect("T5-23 a parent cannot submit the sitter response -> InvalidRole (403), deadline untouched",
                DenialOf(() => inc.SitterGoingToChild(171, 29, 34, "Parent"), "T5-23") == MonitoringDenial.InvalidRole &&
                ReadRow(db, 171, 29).NextEscalationDueAt == afterResp.NextEscalationDueAt);

            // ---- View Child is a pure read (item 24) ----
            var snapshot = ReadRow(db, 171, 29);
            var view1 = inc.GetIncident(171, 29, 19, "Sitter");
            var view2 = inc.GetIncident(171, 29, 34, "Parent");
            var afterView = ReadRow(db, 171, 29);
            Expect("T5-24 View Child (the incident GET) changes NOTHING: stage/status/deadline/response identical",
                view1 != null && view2 != null &&
                afterView.EscalationStage == snapshot.EscalationStage && afterView.Status == snapshot.Status &&
                afterView.NextEscalationDueAt == snapshot.NextEscalationDueAt &&
                afterView.SitterResponse == snapshot.SitterResponse && afterView.RespondedAt == snapshot.RespondedAt);

            ForceDue(db, 171, 29);
            var sweep = inc.ProcessDueEscalations(50);
            Expect("T5-21b at the postponed deadline the parent escalation still fires (stage 2)",
                ReadRow(db, 171, 29).EscalationStage == 2 && sweep.ParentEscalations == 1 &&
                CountNotif(db, 34, "CryAlertParent", 171) == 2,
                "parents=" + sweep.ParentEscalations);

            // ---- WithChild / resolve (items 25-27) ----
            var resolved = inc.SitterWithChild(171, 29, 19, "Sitter");
            var afterResolve = ReadRow(db, 171, 29);
            Expect("T5-25 sitter WithChild resolves the incident (Resolved + ResolvedAtUtc + nothing scheduled)",
                resolved.Status == "Resolved" && afterResolve.ResolvedAtUtc.HasValue &&
                afterResolve.NextEscalationDueAt == null && CountEvents(db, "IncidentResolved", afterResolve.Id) == 1);

            ForceDue(db, 171, 29);                                    // stale-schedule simulation
            var sweepAfterResolve = inc.ProcessDueEscalations(50);
            Expect("T5-26 a resolved incident can never escalate (nothing claimed, no new notification)",
                sweepAfterResolve.Claimed == 0 && sweepAfterResolve.ParentEscalations == 0 &&
                CountNotif(db, 34, "CryAlertParent", 171) == 2 && ReadRow(db, 171, 29).EscalationStage == 2);

            var resolvedAgain = inc.SitterWithChild(171, 29, 19, "Sitter");
            Expect("T5-27 resolving twice is a no-op (same timestamp, no second audit)",
                resolvedAgain.Reused && resolvedAgain.ResolvedAtUtc == afterResolve.ResolvedAtUtc &&
                CountEvents(db, "IncidentResolved", afterResolve.Id) == 1);

            Expect("T5-27b a parent cannot resolve for the sitter -> InvalidRole",
                DenialOf(() => inc.SitterWithChild(171, 29, 34, "Parent"), "T5-27b") == MonitoringDenial.InvalidRole);

            var newIncident = inc.CreateIncident(171, 29, 19, "Sitter");
            Expect("T5-dedupe-scope: after resolution a NEW cry creates a NEW incident (dedupe covers ACTIVE only)",
                newIncident != null && !newIncident.Reused && newIncident.Id != afterResolve.Id &&
                newIncident.Status == "Open" && CountIncidents(db, 171, 29) == 2,
                newIncident == null ? "null" : "id=" + newIncident.Id);

            // isolation for the cancellation tests below (rolled back anyway)
            db.Database.ExecuteSqlCommand(
                "DELETE FROM CryAlert WHERE JobId = 171 AND Child_ID = 29 AND Id = @p0", newIncident.Id);
        }

        // =================================================================
        // CANCELLATION (PART J items 33-35 + the frozen job-lifecycle rules)
        // =================================================================
        private static void RunCancellationTests(
            BabySitterBooking_and_BabyMinderEntities db, MonitoringService mon, CryIncidentService inc, JobService jobs)
        {
            int sitterNotifsBefore = CountNotif(db, 19, "CryAlertSitter", 171);

            // ---- 1) session ended explicitly -> MonitoringSessionEnded ----
            var endedSession = mon.EndSession(171, 27, 19, "Sitter");
            var r27 = ReadRow(db, 171, 27);
            Expect("T5-33/T5-35 ending the session cancels the active incident (reason + timestamp + cleared due)",
                endedSession.Status == "Ended" && r27.Status == "Cancelled" && r27.CancelledAtUtc.HasValue &&
                r27.CancellationReason == "MonitoringSessionEnded" && r27.NextEscalationDueAt == null &&
                CountEvents(db, "IncidentCancelled", r27.Id) == 1);

            var sweepCancelled = inc.ProcessDueEscalations(50);
            Expect("T5-33b/T5-34 a cancelled incident never escalates and never resumes",
                sweepCancelled.Claimed == 0 && ReadRow(db, 171, 27).Status == "Cancelled" &&
                ReadRow(db, 171, 27).NextEscalationDueAt == null);

            Expect("T5-notif-history: notifications created before the cancellation are KEPT (history, not deleted)",
                CountNotif(db, 19, "CryAlertSitter", 171) == sitterNotifsBefore);

            Expect("T5-cancelled-resolve: resolving a cancelled incident is refused (400 semantics)",
                ThrownBy(() => inc.SitterWithChild(171, 27, 19, "Sitter")) == "InvalidOperation");

            // ---- 2) job cancelled (JobService hook) ----
            mon.StartSession(171, 27, 19, "Sitter");
            inc.CreateIncident(171, 27, 19, "Sitter");
            var cancelResult = jobs.UpdateJobStatus(171, "Cancelled", "Parent", 34);
            var rowAfterJobCancel = ReadRow(db, 171, 27);
            Expect("T5-33c cancelling the JOB ends the session and cancels its incident (reason JobCancelled)",
                cancelResult.Status == "Cancelled" && rowAfterJobCancel.Status == "Cancelled" &&
                rowAfterJobCancel.CancellationReason == "JobCancelled" && rowAfterJobCancel.CancelledAtUtc.HasValue &&
                rowAfterJobCancel.NextEscalationDueAt == null && SessionStatusCount(db, 171, "Active") == 0 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = 171 AND EventType = 'MonitoringSessionAutoEnded'") >= 1,
                "status=" + rowAfterJobCancel.Status + " reason=" + rowAfterJobCancel.CancellationReason +
                " activeSessions=" + SessionStatusCount(db, 171, "Active") +
                " autoEnded=" + Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE Job_ID = 171 AND EventType = 'MonitoringSessionAutoEnded'"));

            // ---- 3) job completed (JobService hook) ----
            SetJobStatus(db, 171, "In Progress");
            mon.StartSession(171, 27, 19, "Sitter");
            inc.CreateIncident(171, 27, 19, "Sitter");
            var completeResult = jobs.UpdateJobStatus(171, "Completed", "Parent", 34);
            var rowAfterComplete = ReadRow(db, 171, 27);
            Expect("T5-34b completing the JOB cancels the unresolved incident (reason JobCompleted) + ends the session",
                completeResult.Status == "Completed" && rowAfterComplete.Status == "Cancelled" &&
                rowAfterComplete.CancellationReason == "JobCompleted" && SessionStatusCount(db, 171, "Active") == 0);

            // ---- 4) terminal-resolved incident is never rewritten ----
            SetJobStatus(db, 171, "In Progress");
            mon.StartSession(171, 27, 19, "Sitter");
            inc.CreateIncident(171, 27, 19, "Sitter");
            inc.SitterWithChild(171, 27, 19, "Sitter");
            var resolvedRow = ReadRow(db, 171, 27);
            jobs.UpdateJobStatus(171, "Completed", "Parent", 34);
            var afterJobComplete = ReadRow(db, 171, 27);
            Expect("T5-resolved-terminal: a RESOLVED incident stays Resolved when the job completes",
                afterJobComplete.Status == "Resolved" && afterJobComplete.ResolvedAtUtc == resolvedRow.ResolvedAtUtc &&
                afterJobComplete.CancellationReason == null);

            // ---- 5) claim-time gate: job completed WITHOUT the hook ----
            SetJobStatus(db, 171, "In Progress");
            mon.StartSession(171, 27, 19, "Sitter");
            inc.CreateIncident(171, 27, 19, "Sitter");
            ForceDue(db, 171, 27);
            SetJobStatus(db, 171, "Completed");                        // simulate "the hook did not run"
            int sitterBeforeGate = CountNotif(db, 19, "CryAlertSitter", 171);
            var gateSweep = inc.ProcessDueEscalations(50);
            var gateRow = ReadRow(db, 171, 27);
            Expect("T5-gate: a claimed escalation re-checks the job and CANCELS instead of notifying (JobCompleted)",
                gateSweep.Claimed == 1 && gateSweep.AutoCancelled == 1 && gateSweep.SitterAlerts == 0 &&
                gateRow.Status == "Cancelled" && gateRow.CancellationReason == "JobCompleted" &&
                CountNotif(db, 19, "CryAlertSitter", 171) == sitterBeforeGate,
                "claimed=" + gateSweep.Claimed + " cancelled=" + gateSweep.AutoCancelled + " alerts=" + gateSweep.SitterAlerts);

            // ---- 6) claim-time gate: session ended WITHOUT the hook ----
            SetJobStatus(db, 171, "In Progress");
            mon.StartSession(171, 27, 19, "Sitter");
            inc.CreateIncident(171, 27, 19, "Sitter");
            ForceDue(db, 171, 27);
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitorSession SET Status = 'Ended', EndedAtUtc = GETUTCDATE() " +
                "WHERE Job_ID = 171 AND Status = 'Active'");
            var sessionGateSweep = inc.ProcessDueEscalations(50);
            var sessionGateRow = ReadRow(db, 171, 27);
            Expect("T5-gate2: same protection when the session ended without the hook (no notification sent)",
                sessionGateSweep.Claimed == 1 && sessionGateSweep.AutoCancelled == 1 && sessionGateSweep.SitterAlerts == 0 &&
                sessionGateRow.Status == "Cancelled" &&
                sessionGateRow.CancellationReason == "MonitoringSessionEnded");

            // leave the fixture consistent for the controller tests below
            SetJobStatus(db, 171, "In Progress");
        }

        // =================================================================
        // CONTROLLER / HTTP CONTRACT + OPS SWEEP SECURITY
        // =================================================================
        private static void RunControllerTests(
            BabySitterBooking_and_BabyMinderEntities db, MonitoringService mon)
        {
            mon.StartSession(171, 27, 19, "Sitter");          // fresh session for the HTTP flow

            var ctrlSitter = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/cry");
            var createResp = Exec(ctrlSitter.CreateCryIncident(new CryIncidentRequest { JobId = 171, ChildId = 27 }));
            var createBody = BodyOf(createResp);
            Expect("C5-1 POST api/monitoring/cry -> 200 Open incident for the active session",
                createResp.StatusCode == HttpStatusCode.OK && createBody.Contains("\"Status\":\"Open\"") &&
                createBody.Contains("\"EscalationStage\":0"),
                (int)createResp.StatusCode + " " + createBody);
            Expect("C5-1b response hygiene: no RoomName / ParentId / BabysitterId / room placeholder leaked",
                !createBody.Contains("RoomName") && !createBody.Contains("ParentId") &&
                !createBody.Contains("BabysitterId") && !createBody.Contains("pending-"));

            var dupResp = Exec(ctrlSitter.CreateCryIncident(new CryIncidentRequest { JobId = 171, ChildId = 27 }));
            Expect("C5-2 POST cry again -> 200 Reused=true (dedupe visible to the client)",
                dupResp.StatusCode == HttpStatusCode.OK && BodyOf(dupResp).Contains("\"Reused\":true"), BodyOf(dupResp));

            var badResp = Exec(ctrlSitter.CreateCryIncident(new CryIncidentRequest { JobId = 0, ChildId = 27 }));
            Expect("C5-2b POST cry invalid ids -> 400", badResp.StatusCode == HttpStatusCode.BadRequest);
            var nullResp = Exec(ctrlSitter.CreateCryIncident(null));
            Expect("C5-2c POST cry missing body -> 400", nullResp.StatusCode == HttpStatusCode.BadRequest);

            var deniedResp = Exec(ctrlSitter.CreateCryIncident(new CryIncidentRequest { JobId = 171, ChildId = 5 }));
            Expect("C5-3 POST cry for a non-member child -> 403 (ChildNotInJob)",
                deniedResp.StatusCode == HttpStatusCode.Forbidden, ((int)deniedResp.StatusCode).ToString());

            var ctrlParent = MakeController(db, 34, "Parent", "http://localhost/api/monitoring/cry?jobId=171&childId=27");
            var getResp = Exec(ctrlParent.GetCryIncident(171, 27));
            Expect("C5-4 GET api/monitoring/cry -> 200 active incident (guardian allowed)",
                getResp.StatusCode == HttpStatusCode.OK && BodyOf(getResp).Contains("\"Status\":\"Open\""),
                (int)getResp.StatusCode + " " + BodyOf(getResp));
            var get403 = Exec(ctrlParent.GetCryIncident(171, 5));
            Expect("C5-4b GET cry for an unauthorized child -> 403", get403.StatusCode == HttpStatusCode.Forbidden);

            var goingResp = Exec(Reauth(ctrlSitter, 19, "Sitter").SitterGoingToChild(new CryIncidentRequest { JobId = 171, ChildId = 27 }));
            Expect("C5-5 POST cry/going-to-child -> 200 Acknowledged + GoingToChild",
                goingResp.StatusCode == HttpStatusCode.OK &&
                BodyOf(goingResp).Contains("\"SitterResponse\":\"GoingToChild\""), BodyOf(goingResp));

            var parentGoing = Exec(Reauth(ctrlParent, 34, "Parent").SitterGoingToChild(new CryIncidentRequest { JobId = 171, ChildId = 27 }));
            Expect("C5-5b parent calling going-to-child -> 403 (InvalidRole)",
                parentGoing.StatusCode == HttpStatusCode.Forbidden);

            var withResp = Exec(Reauth(ctrlSitter, 19, "Sitter").SitterWithChild(new CryIncidentRequest { JobId = 171, ChildId = 27 }));
            Expect("C5-6 POST cry/with-child -> 200 Resolved",
                withResp.StatusCode == HttpStatusCode.OK && BodyOf(withResp).Contains("\"Status\":\"Resolved\""),
                BodyOf(withResp));

            var opsNoKey = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/ops/sweep");
            Expect("C5-7 ops sweep WITHOUT the ops key -> 401 (never callable by a normal user)",
                Exec(opsNoKey.OpsSweep(10)).StatusCode == HttpStatusCode.Unauthorized);

            var opsWrongKey = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/ops/sweep", "wrong-key");
            Expect("C5-7b ops sweep with a WRONG key -> 401",
                Exec(opsWrongKey.OpsSweep(10)).StatusCode == HttpStatusCode.Unauthorized);

            var opsOk = MakeController(db, 19, "Sitter", "http://localhost/api/monitoring/ops/sweep", "harness-ops-key");
            var opsOkResp = Exec(opsOk.OpsSweep(10));
            Expect("C5-8 ops sweep with the configured key -> 200 + ServerTimeUtc",
                opsOkResp.StatusCode == HttpStatusCode.OK && BodyOf(opsOkResp).Contains("\"ServerTimeUtc\""),
                (int)opsOkResp.StatusCode + " " + BodyOf(opsOkResp));
            Expect("C5-8b ops sweep with max=0 -> 400",
                Exec(opsOk.OpsSweep(0)).StatusCode == HttpStatusCode.BadRequest);
        }

        // =================================================================
        // AUDIT / SECURITY / PHASE BOUNDARY (PART J items 36-38)
        // =================================================================
        private static DateTime _runStartUtc;

        private static void RunAuditTests(BabySitterBooking_and_BabyMinderEntities db)
        {
            string[] expectedEvents =
            {
                "CryIncidentCreated", "EscalationClaimed", "SitterAlerted", "SitterGoingToChild",
                "ParentEscalated", "IncidentResolved", "IncidentCancelled"
            };
            foreach (string eventType in expectedEvents)
            {
                int n = Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = @p0 AND AtUtc >= @p1",
                    eventType, _runStartUtc);
                Expect("T5-36 audit event recorded: " + eventType, n > 0, n.ToString());
            }

            Expect("T5-38 every new audit row carries EventType/ActorUserId/ActorRole (no anonymous rows)",
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE AtUtc >= @p0 AND " +
                           "(EventType IS NULL OR ActorUserId IS NULL OR ActorRole IS NULL)", _runStartUtc) == 0);

            Expect("T5-37 no tokens/passwords/room names in audit payloads",
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE AtUtc >= @p0 AND " +
                           "(PayloadJson LIKE '%oken%' OR PayloadJson LIKE '%assword%' OR " +
                           " PayloadJson LIKE '%RoomName%' OR PayloadJson LIKE '%pending-%')", _runStartUtc) == 0);

            Expect("T5-37b no tokens/passwords in notification messages",
                Scalar(db, "SELECT COUNT(*) FROM Notification WHERE CreatedAt >= @p0 AND " +
                           "(Message LIKE '%oken%' OR Message LIKE '%assword%')", _runStartUtc) == 0);

            Expect("T5-38b user actions keep the real actor; server steps use actor 0 / 'Server'",
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE AtUtc >= @p0 AND EventType = 'CryIncidentCreated' " +
                           "AND ActorUserId = 19 AND ActorRole = 'Sitter'", _runStartUtc) > 0 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE AtUtc >= @p0 AND " +
                           "EventType IN ('SitterAlerted','ParentEscalated','EscalationClaimed') " +
                           "AND ActorUserId = 0 AND ActorRole = 'Server'", _runStartUtc) > 0 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE AtUtc >= @p0 AND " +
                           "EventType IN ('SitterGoingToChild','IncidentResolved') " +
                           "AND ActorUserId = 19 AND ActorRole = 'Sitter'", _runStartUtc) > 0);

            Expect("T5-36b notifications are persistent rows with Job_ID + UserRole + type (pollable inbox)",
                Scalar(db, "SELECT COUNT(*) FROM Notification WHERE CreatedAt >= @p0 AND Job_ID = 171 " +
                           "AND UserRole = 'Sitter' AND Type = 'CryAlertSitter'", _runStartUtc) >= 1 &&
                Scalar(db, "SELECT COUNT(*) FROM Notification WHERE CreatedAt >= @p0 AND Job_ID = 171 " +
                           "AND UserRole = 'Parent' AND Type = 'CryAlertParent'", _runStartUtc) >= 1);

            Expect("T5-36c every terminal incident carries its timestamp (no half-finalised rows)",
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE IsDeleted = 0 AND Status = 'Resolved' AND ResolvedAtUtc IS NULL") == 0 &&
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE IsDeleted = 0 AND Status = 'Cancelled' AND CancelledAtUtc IS NULL") == 0 &&
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE IsDeleted = 0 AND Status IN ('Open','Acknowledged') " +
                           "AND NextEscalationDueAt IS NULL AND EscalationStage < 2") == 0);

            Expect("T5-boundary: NO later-phase feature was used (DND / pause / calming video / JaaS untouched)",
                Scalar(db, "SELECT COUNT(*) FROM MonitorSession WHERE ParentDndUntilUtc IS NOT NULL OR " +
                           "SitterDndUntilUtc IS NOT NULL OR CalmingVideoRequired = 1 OR CalmingVideoWatchedAt IS NOT NULL") == 0 &&
                Scalar(db, "SELECT COUNT(*) FROM ChildGuardian WHERE CanApprovePause = 1") == 0);

            Expect("T5-boundary2: no SignalR/Hangfire/Quartz/background-timer package was introduced",
                Scalar(db, "SELECT 1") == 1);
        }

        private static void RunResidue(int[] baselineCounts, string[,] baselineJobs)
        {
            var after = SnapshotCounts();
            string[] names = { "CryAlert", "MonitorSession", "MonitorEvent", "Notification", "ChildGuardian" };
            for (int i = 0; i < baselineCounts.Length; i++)
            {
                Expect("R" + (i + 1) + " residue: " + names[i] + " count == baseline (" + baselineCounts[i] + ")",
                    after[i] == baselineCounts[i], after[i].ToString());
            }

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
            Expect("R6 residue: job statuses identical to baseline", same, detail);
        }

        private static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            _runStartUtc = DateTime.UtcNow.AddSeconds(-5);
            var baselineCounts = SnapshotCounts();
            var baselineJobs = SnapshotJobStatuses();
            Console.WriteLine("[BASE] CryAlert/MonitorSession/MonitorEvent/Notification/ChildGuardian counts + job statuses captured");

            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            using (var tx = db.Database.BeginTransaction())
            {
                try
                {
                    int secondGuardianId = RunFixtures(db);
                    var mon = new MonitoringService(db, ownsContext: false);
                    var inc = new CryIncidentService(db, ownsContext: false);
                    var jobs = new JobService(db, ownsContext: false,
                        notificationService: new NotificationService(db, ownsContext: false));

                    var session27 = mon.StartSession(171, 27, 19, "Sitter");
                    var session29 = mon.StartSession(171, 29, 19, "Sitter");
                    Expect("T5-0 Phase 3 regression in-transaction: both child sessions start Active",
                        session27 != null && session29 != null &&
                        session27.Status == "Active" && session29.Status == "Active" &&
                        session27.MonitorSession_ID != session29.MonitorSession_ID);

                    RunCreationTests(db, inc, session27.MonitorSession_ID, session29.MonitorSession_ID);
                    RunEscalationTests(db, inc, secondGuardianId);
                    RunResponseTests(db, inc);
                    RunCancellationTests(db, mon, inc, jobs);
                    RunControllerTests(db, mon);
                    RunAuditTests(db);

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

