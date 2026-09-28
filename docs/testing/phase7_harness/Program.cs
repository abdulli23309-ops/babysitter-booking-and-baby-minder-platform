using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using WebApplication2.DTOs;
using WebApplication2.Infrastructure;
using WebApplication2.Models;
using WebApplication2.Services.Implementations;

namespace Phase7Harness
{
    /// <summary>
    /// Phase 7 verification harness: guardian connection, parent pause and
    /// parent DND, against the REAL development database inside ONE transaction
    /// that is always rolled back, followed by residue checks from a FRESH
    /// context. Exit code 0 = all passed.
    ///
    /// The most important assertions in this file are the SECURITY ones
    /// (T7-S1 / T7-S2): they prove that a parent who appears only in
    /// Child.Parent_ID and has NO active ChildGuardian row is neither authorized
    /// to monitor nor included in the parent-escalation fan-out. That is the
    /// Phase 7 fix for a real defect that used to live in
    /// CryIncidentService.ReadGuardianParentIds.
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

        /// <summary>Classifies how an action failed ("" = it did not throw).</summary>
        private static string ThrownBy(Action action)
        {
            try { action(); return ""; }
            catch (MonitoringAccessException ex) { return "Access:" + ex.Denial; }
            catch (UnauthorizedAccessException) { return "Unauthorized"; }
            catch (KeyNotFoundException) { return "NotFound"; }
            catch (ArgumentException) { return "Argument"; }
            catch (InvalidOperationException) { return "Rule"; }
            catch (Exception ex) { return ex.GetType().Name; }
        }

        /// <summary>Same classification but keeps the message, for diagnostics.</summary>
        private static string ThrownMessage(Action action)
        {
            try { action(); return "(no throw)"; }
            catch (Exception ex) { return ex.GetType().Name + ": " + ex.Message; }
        }

        private static int Scalar(BabySitterBooking_and_BabyMinderEntities db, string sql, params object[] args)
        {
            return db.Database.SqlQuery<int>(sql, args).Single();
        }

        private static string Text(BabySitterBooking_and_BabyMinderEntities db, string sql, params object[] args)
        {
            return db.Database.SqlQuery<string>(sql, args).FirstOrDefault();
        }

        private static int CountEvents(BabySitterBooking_and_BabyMinderEntities db, string eventType)
        {
            return Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = @p0", eventType);
        }

        private static int CountNotif(BabySitterBooking_and_BabyMinderEntities db, int userId, string type)
        {
            return Scalar(db, "SELECT COUNT(*) FROM Notification WHERE UserID = @p0 AND Type = @p1", userId, type);
        }

        private static void SetJobStatus(BabySitterBooking_and_BabyMinderEntities db, int jobId, string status)
        {
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = @p0 WHERE Job_ID = @p1", status, jobId);
            // The harness shares ONE context; JobService re-reads the TRACKED
            // entity, so a raw UPDATE must be followed by a reload.
            var tracked = db.Jobs.Find(jobId);
            if (tracked != null) db.Entry(tracked).Reload();
        }

        // ------------------------------------------------------------------
        // fixtures
        // ------------------------------------------------------------------

        /// <summary>
        /// Phase 7 fixtures (all inside the rolled-back transaction):
        ///   * job 171 = 'In Progress' and job 170 = 'In Progress'
        ///     (job 168 stays 'Assigned' for the denial cases)
        ///   * child 27 and child 29 are owned by parent 34 via Child.Parent_ID
        ///   * parent 34 is an active ChildGuardian of BOTH children, with
        ///     CanApprovePause = 0 because a lone guardian may never approve
        ///   * parent 1 is NOT a guardian of 27/29 - it is the reserved
        ///     "parent that exists only in Child.Parent_ID" security probe
        ///   * a spare parent owning no child and no guardian row, used as the
        ///     guardian invitee
        /// </summary>
        private static void RunFixtures(BabySitterBooking_and_BabyMinderEntities db, out int fatherId)
        {
            db.Database.ExecuteSqlCommand("DELETE FROM ChildGuardian");
            db.Database.ExecuteSqlCommand("DELETE FROM GuardianInvitation");
            db.Database.ExecuteSqlCommand("DELETE FROM MonitoringPause");
            db.Database.ExecuteSqlCommand("DELETE FROM MonitoringDnd");
            db.Database.ExecuteSqlCommand("DELETE FROM CryAlert");
            db.Database.ExecuteSqlCommand("DELETE FROM MonitorEvent");
            db.Database.ExecuteSqlCommand("DELETE FROM MonitorSession");

            fatherId = db.Database.SqlQuery<int>(
                "SELECT TOP (1) p.Parent_ID FROM Parent p " +
                "WHERE p.IsDeleted = 0 AND p.Parent_ID NOT IN (34, 1) " +
                "  AND NOT EXISTS (SELECT 1 FROM Child c WHERE c.Parent_ID = p.Parent_ID AND c.IsDeleted = 0) " +
                "ORDER BY p.Parent_ID").Single();

            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, CreatedAt, IsDeleted) " +
                "VALUES (27, 34, N'Mother', 1, 0, GETUTCDATE(), 0)");
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, CreatedAt, IsDeleted) " +
                "VALUES (29, 34, N'Mother', 1, 0, GETUTCDATE(), 0)");

            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 171");
            db.Database.ExecuteSqlCommand("UPDATE Job SET Status = 'In Progress' WHERE Job_ID = 170");

            Console.WriteLine("[TX] phase 7 fixtures: guardians(27,34)+(29,34); invitee=" + fatherId +
                              "; jobs 171/170='In Progress', 168='Assigned'");
        }

        /// <summary>Grants the pause-approval capability the way acceptance does.</summary>
        private static void GrantPauseCapability(BabySitterBooking_and_BabyMinderEntities db, int childId, int parentId)
        {
            db.Database.ExecuteSqlCommand(
                "UPDATE ChildGuardian SET CanApprovePause = 1 WHERE Child_ID = @p0 AND Parent_ID = @p1 AND IsDeleted = 0",
                childId, parentId);
        }

        // ==================================================================
        // GUARDIAN CONNECTION
        // ==================================================================
        private static void RunGuardianTests(BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g, int fatherId)
        {
            string fatherUsername = Text(db, "SELECT Username FROM Parent WHERE Parent_ID = @p0", fatherId);
            string motherUsername = Text(db, "SELECT Username FROM Parent WHERE Parent_ID = 34");
            Expect("T7-G0 fixture: the invitee has a unique username to be found by",
                !string.IsNullOrEmpty(fatherUsername), fatherUsername);

            // --- creation guards ---
            Expect("T7-G1 self-invite is refused",
                ThrownBy(() => g.CreateInvitation(27, motherUsername, "Mother", 34, "Parent")) == "Rule");
            Expect("T7-G2 unknown identifier is refused",
                ThrownBy(() => g.CreateInvitation(27, "no.such.user.zzz", "Father", 34, "Parent")) == "Rule");
            Expect("T7-G3 a non-guardian cannot invite for that child (parent 1)",
                ThrownBy(() => g.CreateInvitation(27, fatherUsername, "Father", 1, "Parent")) == "Unauthorized");
            Expect("T7-G4 a SITTER can never use the family/pause/DND surface",
                ThrownBy(() => g.CreateInvitation(27, fatherUsername, "Father", 19, "Sitter")) == "Access:InvalidRole");

            // --- happy path ---
            var invitation = g.CreateInvitation(27, fatherUsername, "Father", 34, "Parent");
            Expect("T7-G5 invitation created Pending for the resolved invitee",
                invitation != null && invitation.Status == "Pending" &&
                invitation.InvitedByParent_ID == 34 && invitation.Child_ID == 27 &&
                invitation.IdentifierType == "Username",
                invitation == null ? "null" : invitation.Status);

            Expect("T7-G6 the plaintext token is NEVER stored or returned",
                Scalar(db, "SELECT COUNT(*) FROM GuardianInvitation WHERE TokenHash IS NULL") == 0 &&
                Scalar(db, "SELECT COUNT(*) FROM GuardianInvitation WHERE LEN(TokenHash) = 64") == 1);
            Expect("T7-G7 the token hash never leaks into the audit trail",
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE PayloadJson LIKE '%TokenHash%' OR PayloadJson LIKE '%Token%'") == 0);
            Expect("T7-G8 an audit row records the real actor",
                CountEvents(db, "GuardianInvitationCreated") == 1 &&
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = 'GuardianInvitationCreated' AND ActorUserId = 34 AND ActorRole = 'Parent'") == 1);
            Expect("T7-G9 the invitee got a persisted notification",
                CountNotif(db, fatherId, "GuardianInvitation") == 1);

            Expect("T7-G10 duplicate PENDING invitation for the same (child, invitee) is refused",
                ThrownBy(() => g.CreateInvitation(27, fatherUsername, "Father", 34, "Parent")) == "Rule");
            Expect("T7-G11 inviting an already-connected guardian is refused",
                ThrownBy(() => g.CreateInvitation(27, motherUsername, "Mother", 34, "Parent")) == "Rule");
            Expect("T7-G12 a pending invitation grants NO monitoring access yet",
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = 27 AND Parent_ID = @p0 AND IsDeleted = 0",
                    fatherId).Single() == 0);

            // Group isolation: this scenario deliberately leaves the invitation
            // PENDING (it is what T7-G12 asserts), so clear it before the next
            // group creates its own invitation for the same (child, invitee).
            db.Database.ExecuteSqlCommand(
                "DELETE FROM GuardianInvitation WHERE Status = 'Pending' AND IsDeleted = 0");
        }

        private static void RunGuardianAcceptTests(BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g, int fatherId)
        {
            string fatherUsername = Text(db, "SELECT Username FROM Parent WHERE Parent_ID = @p0", fatherId);

            // --- visibility (server derives the invitee from the token) ---
            var invitation = g.CreateInvitation(27, fatherUsername, "Father", 34, "Parent");
            int id = invitation.GuardianInvitation_ID;
            var hisInbox = g.GetInvitationsForCurrentUser(fatherId, "Parent").ToList();
            var herInbox = g.GetInvitationsForCurrentUser(34, "Parent").ToList();
            Expect("T7-G13 the invitee sees his own pending invitation",
                hisInbox.Count == 1 && hisInbox[0].GuardianInvitation_ID == id, "count=" + hisInbox.Count);
            Expect("T7-G14 a parent cannot list another parent's invitations",
                herInbox.Count == 0, "count=" + herInbox.Count);
            Expect("T7-G14b the invitation response carries no token/hash field",
                !JSONHas(invitation, "TokenHash") && !JSONHas(invitation, "Token"));

            // --- hostile third party ---
            Expect("T7-G15 a THIRD party cannot accept somebody else's invitation",
                ThrownBy(() => g.AcceptInvitation(id, 1, "Parent")) == "Unauthorized");
            Expect("T7-G16 the refused accept left NO guardian row and the invitation Pending",
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = 27 AND Parent_ID = @p0 AND IsDeleted = 0",
                    fatherId).Single() == 0 &&
                Text(db, "SELECT Status FROM GuardianInvitation WHERE GuardianInvitation_ID = @p0", id) == "Pending");

            // --- atomic acceptance ---
            var accepted = g.AcceptInvitation(id, fatherId, "Parent");
            Expect("T7-G17 accept is atomic: invitation Accepted AND ChildGuardian created",
                accepted != null && accepted.Status == "Accepted" &&
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = 27 AND Parent_ID = @p0 AND IsDeleted = 0",
                    fatherId).Single() == 1,
                accepted == null ? "null" : accepted.Status);
            Expect("T7-G18 the accepted guardian got CanApprovePause from the relation (server-side)",
                db.Database.SqlQuery<bool>(
                    "SELECT CanApprovePause FROM ChildGuardian WHERE Child_ID = 27 AND Parent_ID = @p0 AND IsDeleted = 0",
                    fatherId).Single());
            Expect("T7-G19 accepting twice is refused (no duplicate relationship)",
                ThrownBy(() => g.AcceptInvitation(id, fatherId, "Parent")) == "Rule");
            Expect("T7-G20 the new guardian is now authorized for monitoring (ChildGuardian path)",
                MonitoringAccess.Check(db, fatherId, "Parent", 171, 27) == MonitoringDenial.Allowed);
        }

        private static void RunGuardianLifecycleTests(BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g, int fatherId)
        {
            string fatherUsername = Text(db, "SELECT Username FROM Parent WHERE Parent_ID = @p0", fatherId);

            // --- guardians listing ---
            var guardians = g.GetGuardians(171, 27, 34, "Parent").ToList();
            Expect("T7-G21 GET guardians returns the ChildGuardian relationships only",
                guardians.Count == 2 &&
                guardians.Any(x => x.Parent_ID == 34 && x.IsPrimary && x.IsCurrentUser) &&
                guardians.Any(x => x.Parent_ID == fatherId && x.Relation == "Father" && x.CanApprovePause),
                "count=" + guardians.Count);
            Expect("T7-G21b the guardians response exposes no email/password/hash",
                !JSONHas(guardians.First(), "Password") && !JSONHas(guardians.First(), "Email"));
            Expect("T7-G22 a non-guardian cannot list the guardians of that child",
                ThrownBy(() => g.GetGuardians(171, 27, 1, "Parent")) == "Access:NotGuardian");

            // --- reject / cancel ---
            var toReject = g.CreateInvitation(29, fatherUsername, "Father", 34, "Parent");
            var rejected = g.RejectInvitation(toReject.GuardianInvitation_ID, fatherId, "Parent");
            Expect("T7-G23 reject closes the invitation without creating a guardian",
                rejected.Status == "Rejected" &&
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = 29 AND Parent_ID = @p0 AND IsDeleted = 0",
                    fatherId).Single() == 0);

            var toCancel = g.CreateInvitation(29, fatherUsername, "Father", 34, "Parent");
            var cancelled = g.CancelInvitation(toCancel.GuardianInvitation_ID, 34, "Parent");
            Expect("T7-G24 the inviter can withdraw a pending invitation",
                cancelled.Status == "Cancelled");
            var toSteal = g.CreateInvitation(29, fatherUsername, "Father", 34, "Parent");
            Expect("T7-G25 the INVITEE cannot withdraw somebody else's invitation",
                ThrownBy(() => g.CancelInvitation(toSteal.GuardianInvitation_ID, fatherId, "Parent")) == "Unauthorized");
            // Group isolation: clear what is still pending so the expiry scenario
            // below can create its own invitation for the same (child, invitee).
            db.Database.ExecuteSqlCommand(
                "DELETE FROM GuardianInvitation WHERE Status = 'Pending' AND IsDeleted = 0");

            // --- expiry (lazy, no timer) ---
            var expiring = g.CreateInvitation(29, fatherUsername, "Father", 34, "Parent");
            db.Database.ExecuteSqlCommand(
                "UPDATE GuardianInvitation SET ExpiresAtUtc = DATEADD(HOUR, -1, GETUTCDATE()) WHERE GuardianInvitation_ID = @p0",
                expiring.GuardianInvitation_ID);
            Expect("T7-G26 an EXPIRED invitation cannot be accepted",
                ThrownBy(() => g.AcceptInvitation(expiring.GuardianInvitation_ID, fatherId, "Parent")) == "Rule");
            Expect("T7-G27 an expired invitation reads as Expired",
                Text(db, "SELECT Status FROM GuardianInvitation WHERE GuardianInvitation_ID = @p0",
                    expiring.GuardianInvitation_ID) == "Expired");
        }

        /// <summary>Cheap response-hygiene probe: serialize and look for a field name.</summary>
        private static bool JSONHas(object dto, string fieldName)
        {
            string json = JsonConvert.SerializeObject(dto);
            return json.IndexOf("\"" + fieldName + "\"", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        // ==================================================================
        // PARENT PAUSE
        // ==================================================================
        private static void RunPauseRequestTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g,
            MonitoringService mon, int fatherId)
        {
            var session27 = mon.StartSession(171, 27, 19, "Sitter");
            var session29 = mon.StartSession(171, 29, 19, "Sitter");
            Expect("T7-P0 fixture: both children have an Active monitoring session",
                session27 != null && session29 != null &&
                session27.Status == "Active" && session29.Status == "Active");

            // --- request validation ---
            string p3 = ThrownMessage(() => g.RequestPause(999999, 27, 34, "Parent"));
            string p4 = ThrownMessage(() => g.RequestPause(171, 5, 34, "Parent"));
            string p5 = ThrownMessage(() => g.RequestPause(168, 27, 34, "Parent"));
            string p6 = ThrownMessage(() => g.RequestPause(170, 27, 34, "Parent"));
            Expect("T7-P1 a non-guardian cannot request a pause (parent 1)",
                ThrownBy(() => g.RequestPause(171, 27, 1, "Parent")) == "Access:NotGuardian");
            Expect("T7-P2 a SITTER cannot request a pause",
                ThrownBy(() => g.RequestPause(171, 27, 19, "Sitter")) == "Access:InvalidRole");
            Expect("T7-P3 an unknown job is refused",
                ThrownBy(() => g.RequestPause(999999, 27, 34, "Parent")) == "Access:JobNotFound", p3);
            Expect("T7-P4 a child the caller does not guard is refused (identity is checked BEFORE membership)",
                ThrownBy(() => g.RequestPause(171, 5, 34, "Parent")) == "Access:NotGuardian", p4);
            Expect("T7-P5 a job that is not In Progress is refused",
                ThrownBy(() => g.RequestPause(168, 27, 34, "Parent")) == "Access:JobNotInProgress", p5);
            Expect("T7-P6 a pause without an Active session is refused",
                ThrownBy(() => g.RequestPause(170, 27, 34, "Parent")) == "Access:SessionNotFound", p6);

            // --- the request itself has NO immediate effect ---
            var request = g.RequestPause(171, 27, 34, "Parent");
            Expect("T7-P7 an authorized guardian can request a pause (status Requested)",
                request != null && request.Status == "Requested" &&
                request.RequestedByParent_ID == 34 && request.PauseStartUtc == null &&
                request.PauseExpiresAtUtc == null,
                request == null ? "null" : request.Status);
            Expect("T7-P8 requesting pauses NOTHING yet (no start, no expiry, session still active)",
                Text(db, "SELECT TOP (1) Status FROM MonitorSession WHERE Job_ID = 171 AND Child_ID = 27 AND Status = 'Active'") == "Active" &&
                Scalar(db, "SELECT COUNT(*) FROM MonitoringPause WHERE Status = 'Approved'") == 0);
            Expect("T7-P9 the other guardian was notified to decide",
                CountNotif(db, fatherId, "PauseRequested") == 1 &&
                CountEvents(db, "PauseRequested") == 1);
            Expect("T7-P10 a second open pause request is refused",
                ThrownBy(() => g.RequestPause(171, 27, 34, "Parent")) == "Rule");
            Expect("T7-P11 the requester can withdraw their own pending request",
                g.CancelPause(request.MonitoringPause_ID, 34, "Parent").Status == "Cancelled");
            Expect("T7-P12 nobody else can cancel somebody's request",
                ThrownBy(() => g.RequestPause(171, 27, 34, "Parent")) == "" &&
                ThrownBy(() => g.CancelPause(
                    db.Database.SqlQuery<int>(
                        "SELECT TOP (1) MonitoringPause_ID FROM MonitoringPause WHERE Status = 'Requested'").Single(),
                    fatherId, "Parent")) == "Unauthorized");

            // Group isolation: leave NO open pause behind, the next group needs
            // to create its own request for the same session.
            db.Database.ExecuteSqlCommand(
                "DELETE FROM MonitoringPause WHERE MonitorSession_ID IN " +
                "(SELECT MonitorSession_ID FROM MonitorSession WHERE Job_ID = 171 AND Child_ID = 27 AND IsDeleted = 0) " +
                "AND IsDeleted = 0");
        }

        private static void RunPauseApprovalTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g,
            MonitoringService mon, CryIncidentService inc, int fatherId)
        {
            // A fresh request to approve, with the incident running.
            var request = g.RequestPause(171, 27, 34, "Parent");
            int pauseId = request.MonitoringPause_ID;
            var incident = inc.CreateIncident(171, 27, 19, "Sitter");
            Expect("T7-P13 fixture: a cry incident is Open and scheduled before approval",
                incident != null && !incident.Reused &&
                Text(db, "SELECT TOP (1) Status FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 ORDER BY CreatedAt DESC") == "Open");

            // --- who may approve ---
            Expect("T7-P14 the REQUESTER can never approve their own request",
                ThrownBy(() => g.ApprovePause(pauseId, 34, "Parent")) == "Unauthorized");
            Expect("T7-P15 a non-guardian cannot approve",
                ThrownBy(() => g.ApprovePause(pauseId, 1, "Parent")) == "Access:NotGuardian");

            // Explicitly remove the capability to prove the server really checks
            // ChildGuardian.CanApprovePause (it is never taken from the request).
            db.Database.ExecuteSqlCommand(
                "UPDATE ChildGuardian SET CanApprovePause = 0 WHERE Child_ID = 27 AND Parent_ID = @p0", fatherId);
            Expect("T7-P16 an authorized guardian WITHOUT CanApprovePause is refused",
                ThrownBy(() => g.ApprovePause(pauseId, fatherId, "Parent")) == "Unauthorized");
            // Give the requester the capability too, to prove that even a capable
            // requester still cannot approve their OWN request.
            db.Database.ExecuteSqlCommand(
                "UPDATE ChildGuardian SET CanApprovePause = 1 WHERE Child_ID = 27 AND Parent_ID = 34");
            Expect("T7-P16b the requester still cannot approve even WITH the capability (no self-approval)",
                ThrownBy(() => g.ApprovePause(pauseId, 34, "Parent")) == "Unauthorized");

            // --- approval ---
            GrantPauseCapability(db, 27, fatherId);
            var approved = g.ApprovePause(pauseId, fatherId, "Parent");
            double window = (approved.PauseExpiresAtUtc.Value - approved.PauseStartUtc.Value).TotalSeconds;
            Expect("T7-P17 approval is EXACTLY 150 seconds (2 min 30 s), server-computed",
                approved.Status == "Approved" && Math.Abs(window - 150) < 2,
                "seconds=" + window.ToString("0.0"));
            Expect("T7-P18 the approval window is within seconds of now (client cannot backdate)",
                Math.Abs((approved.PauseStartUtc.Value - DateTime.UtcNow).TotalSeconds) < 30);
            Expect("T7-P19 the pause DTO exposes no client-supplied duration field",
                !JSONHas(approved, "DurationSeconds") && !JSONHas(approved, "RequestedByParentId"));
            Expect("T7-P20 the approver was audited and the requester notified",
                CountEvents(db, "PauseApproved") == 1 && CountNotif(db, 34, "PauseApproved") == 1);

            // --- CryAlert integration (the Phase 5/6 reuse) ---
            Expect("T7-P21 approving the pause CANCELLED the active cry incident",
                Text(db, "SELECT TOP (1) Status FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 ORDER BY CreatedAt DESC") == "Cancelled");
            Expect("T7-P22 the cancellation reason is ParentPauseApproved",
                Text(db, "SELECT TOP (1) CancellationReason FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 ORDER BY CreatedAt DESC")
                    == CryIncidentService.CancelParentPauseApproved);
            Expect("T7-P23 NextEscalationDueAt was cleared, so the scheduler can never claim it",
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 AND NextEscalationDueAt IS NOT NULL") == 0);
            Expect("T7-P24 the sweeper claims nothing for the paused session",
                inc.ProcessDueEscalations(50).Claimed == 0);
            Expect("T7-P25 an already-approved pause cannot be approved or denied again",
                ThrownBy(() => g.ApprovePause(pauseId, fatherId, "Parent")) == "Rule" &&
                ThrownBy(() => g.DenyPause(pauseId, fatherId, "Parent")) == "Rule");
            Expect("T7-P26 the requester cannot shorten an APPROVED pause (no early resume)",
                ThrownBy(() => g.CancelPause(pauseId, 34, "Parent")) == "Rule");
        }

        private static void RunPauseSitterAndExpiryTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g,
            MonitoringService mon, CryIncidentService inc, int fatherId)
        {
            int pauseId = db.Database.SqlQuery<int>(
                "SELECT TOP (1) MonitoringPause_ID FROM MonitoringPause WHERE Status = 'Approved'").Single();

            // --- the SITTER sees the paused state through the EXISTING session GET ---
            var sitterView = mon.GetSession(171, 27, 19, "Sitter");
            Expect("T7-P27 the sitter sees IsPaused through GET session (no sitter pause endpoint)",
                sitterView != null && sitterView.IsPaused && sitterView.PauseExpiresAtUtc.HasValue &&
                sitterView.PauseSecondsRemaining.HasValue && sitterView.PauseSecondsRemaining.Value > 0,
                sitterView == null ? "null" : "remaining=" + sitterView.PauseSecondsRemaining);
            Expect("T7-P28 a pause is NOT a connection loss: heartbeat/connection still work",
                sitterView.ParentHeartbeatUtc == null && sitterView.SitterHeartbeatUtc == null &&
                mon.SendHeartbeat(171, 27, 19, "Sitter").Ok &&
                mon.GetSession(171, 27, 19, "Sitter").SitterHeartbeatUtc.HasValue);
            Expect("T7-P29 the session is still Active and the parent may still view it manually",
                mon.GetSession(171, 27, 34, "Parent").Status == "Active" &&
                mon.GetSession(171, 27, 19, "Sitter").Status == "Active");

            // --- the OLD incident never resumes ---
            Expect("T7-P30 the cancelled incident never resumes after the pause window",
                inc.ProcessDueEscalations(50).Claimed == 0 &&
                Text(db, "SELECT TOP (1) Status FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 ORDER BY CreatedAt DESC") == "Cancelled");

            // --- force expiry (server-side column, exactly as the 150s window would) ---
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringPause SET PauseExpiresAtUtc = DATEADD(SECOND, -1, GETUTCDATE()) WHERE MonitoringPause_ID = @p0",
                pauseId);
            var afterExpiry = g.GetPause(171, 27, 34, "Parent");
            Expect("T7-P31 an expired pause resolves to Expired lazily (no timer)",
                afterExpiry != null && afterExpiry.Status == "Expired" && !afterExpiry.IsActive,
                afterExpiry == null ? "null" : afterExpiry.Status);
            Expect("T7-P32 expiry was audited",
                CountEvents(db, "PauseExpired") >= 1);
            Expect("T7-P33 an expired pause stops suppressing monitoring (sitter no longer sees paused)",
                !mon.GetSession(171, 27, 19, "Sitter").IsPaused);

            // --- a NEW cry after the pause creates a FRESH T+0 incident ---
            var fresh = inc.CreateIncident(171, 27, 19, "Sitter");
            Expect("T7-P34 a cry after the pause creates a NEW incident, not a resume",
                fresh != null && !fresh.Reused &&
                Text(db, "SELECT TOP (1) Status FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0 ORDER BY CreatedAt DESC") == "Open" &&
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE Child_ID = 27 AND IsDeleted = 0") == 2,
                fresh == null ? "null" : "reused=" + fresh.Reused);
            Expect("T7-P35 the fresh incident has a fresh T+0 schedule",
                fresh.NextEscalationDueAt.HasValue &&
                Math.Abs((fresh.NextEscalationDueAt.Value - fresh.CreatedAtUtc).TotalSeconds - 5) < 1.5);
        }

        private static void RunPauseDenyTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g, int fatherId)
        {
            var request = g.RequestPause(171, 27, 34, "Parent");
            int pauseId = request.MonitoringPause_ID;
            GrantPauseCapability(db, 27, fatherId);

            Expect("T7-P36 the requester cannot deny their own request",
                ThrownBy(() => g.DenyPause(pauseId, 34, "Parent")) == "Unauthorized");
            // Scoped to THIS denial: count before/after, because an earlier test in
            // this run legitimately cancelled an incident by approving a pause.
            int pauseCancelledBefore = Scalar(db,
                "SELECT COUNT(*) FROM CryAlert WHERE CancellationReason = @p0",
                CryIncidentService.CancelParentPauseApproved);
            var denied = g.DenyPause(pauseId, fatherId, "Parent");
            Expect("T7-P37 an authorized approver can deny",
                denied.Status == "Denied" && denied.DecidedByParent_ID == fatherId);
            Expect("T7-P38 a denial NEVER touches the cry incident",
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE CancellationReason = @p0",
                    CryIncidentService.CancelParentPauseApproved) == pauseCancelledBefore);
            Expect("T7-P39 denial is audited and the requester notified",
                CountEvents(db, "PauseDenied") == 1 && CountNotif(db, 34, "PauseDenied") >= 1);
        }

        private static void RunPauseLifecycleTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g,
            MonitoringService mon, int fatherId)
        {
            // A pending request must not survive a session end.
            var request = g.RequestPause(171, 27, 34, "Parent");
            int pauseId = request.MonitoringPause_ID;
            GrantPauseCapability(db, 27, fatherId);
            mon.EndSession(171, 27, 19, "Sitter");
            Expect("T7-P40 ending the session cancels a PENDING pause (it can never be approved later)",
                Text(db, "SELECT Status FROM MonitoringPause WHERE MonitoringPause_ID = @p0", pauseId) == "Cancelled" &&
                ThrownBy(() => g.ApprovePause(pauseId, fatherId, "Parent")) == "Rule");
        }

        // ==================================================================
        // PARENT DND  (presentation only, mutually exclusive)
        // ==================================================================
        private static void RunDndTests(
            BabySitterBooking_and_BabyMinderEntities db, GuardianConnectionService g,
            MonitoringService mon, CryIncidentService inc, int fatherId)
        {
            mon.StartSession(171, 27, 19, "Sitter");
            mon.StartSession(171, 29, 19, "Sitter");
            // The second guardian is connected to BOTH children so the
            // per-child-session DND scenarios below are legitimate.
            db.Database.ExecuteSqlCommand(
                "INSERT INTO ChildGuardian (Child_ID, Parent_ID, Relation, IsPrimary, CanApprovePause, CreatedAt, IsDeleted) " +
                "VALUES (29, @p0, N'Father', 0, 0, GETUTCDATE(), 0)", fatherId);

            // --- enable ---
            Expect("T7-D1 a non-guardian cannot enable DND",
                ThrownBy(() => g.EnableDnd(171, 27, 1, "Parent")) == "Access:NotGuardian");
            Expect("T7-D2 a SITTER cannot use the parent DND endpoint",
                ThrownBy(() => g.EnableDnd(171, 27, 19, "Sitter")) == "Access:InvalidRole");
            Expect("T7-D3 DND needs an Active session",
                ThrownBy(() => g.EnableDnd(170, 27, 34, "Parent")) == "Access:SessionNotFound");

            var dnd = g.EnableDnd(171, 27, 34, "Parent");
            Expect("T7-D4 the caller's own DND is enabled for a bounded server window",
                dnd != null && dnd.IsActive && dnd.UserId == 34 && dnd.IsCurrentUser &&
                dnd.DndUntilUtc > DateTime.UtcNow &&
                dnd.DndUntilUtc <= DateTime.UtcNow.AddSeconds(GuardianConnectionService.DndDurationSeconds + 5),
                dnd == null ? "null" : dnd.DndUntilUtc.ToString("o"));
            Expect("T7-D5 the DND request DTO carries no UserId/Role/expiry field to forge",
                !JSONHas(new MonitoringDndRequest(), "UserId") &&
                !JSONHas(new MonitoringDndRequest(), "Role") &&
                !JSONHas(new MonitoringDndRequest(), "DndUntilUtc"));

            // --- mutual exclusion ---
            Expect("T7-D6 the OTHER parent is refused while this one is DND (server-side)",
                ThrownBy(() => g.EnableDnd(171, 27, fatherId, "Parent")) == "Rule");
            Expect("T7-D7 the refusal is audited",
                CountEvents(db, "DndDenied") >= 1);
            Expect("T7-D8 exactly ONE active DND owner exists for the session",
                Scalar(db, "SELECT COUNT(*) FROM MonitoringDnd WHERE MonitorSession_ID IN " +
                    "(SELECT MonitorSession_ID FROM MonitorSession WHERE Job_ID = 171 AND Child_ID = 27 AND Status = 'Active') " +
                    "AND IsDeleted = 0 AND CancelledAtUtc IS NULL AND DndUntilUtc > GETUTCDATE()") == 1);
            Expect("T7-D9 the other parent may enable DND on a DIFFERENT child session",
                g.EnableDnd(171, 29, fatherId, "Parent") != null);

            // --- DND never stops escalation ---
            // The FATHER currently has active DND on child 29 (T7-D9). A cry on
            // that session must still escalate to the parents, and the father
            // must STILL receive a persisted notification - DND suppresses only
            // ringing, never the inbox row.
            var incident = inc.CreateIncident(171, 29, 19, "Sitter");
            db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET EscalationStage = 1, NextEscalationDueAt = DATEADD(SECOND, -1, GETUTCDATE()) WHERE Id = @p0",
                incident.Id);
            var sweep = inc.ProcessDueEscalations(50);
            Expect("T7-D10 DND does NOT stop escalation (the incident still escalates)",
                sweep.Claimed == 1 && sweep.ParentEscalations == 1,
                "claimed=" + sweep.Claimed + " parentEsc=" + sweep.ParentEscalations);
            Expect("T7-D11 a parent WITH DND still gets the persisted notification (DND is presentation only)",
                CountNotif(db, fatherId, "CryAlertParent") == 1 &&
                CountNotif(db, 34, "CryAlertParent") >= 1,
                "father=" + CountNotif(db, fatherId, "CryAlertParent") +
                " mother=" + CountNotif(db, 34, "CryAlertParent"));
            Expect("T7-D12 the DND-active parent's incident is NOT cancelled by DND",
                Text(db, "SELECT TOP (1) Status FROM CryAlert WHERE Id = @p0", incident.Id) != "Cancelled" &&
                Scalar(db, "SELECT COUNT(*) FROM CryAlert WHERE Id = @p0 AND CancellationReason = @p1",
                    incident.Id, CryIncidentService.CancelParentPauseApproved) == 0);
            Expect("T7-D13 enabling DND is audited",
                CountEvents(db, "DndEnabled") >= 2);

            // --- disable ---
            Expect("T7-D14 a parent cannot disable ANOTHER parent's DND",
                ThrownBy(() => g.DisableDnd(171, 27, fatherId, "Parent")) == "Rule");
            var off = g.DisableDnd(171, 27, 34, "Parent");
            Expect("T7-D15 a parent can disable their OWN DND (history kept)",
                off != null && !off.IsActive &&
                Scalar(db, "SELECT COUNT(*) FROM MonitoringDnd WHERE UserId = 34 AND CancelledAtUtc IS NOT NULL AND IsDeleted = 0") >= 1);
            Expect("T7-D16 after the first parent is off, the other can enable DND",
                g.EnableDnd(171, 27, fatherId, "Parent") != null);

            // --- expiry (lazy, no timer) ---
            db.Database.ExecuteSqlCommand(
                "UPDATE MonitoringDnd SET DndUntilUtc = DATEADD(SECOND, -1, GETUTCDATE()) " +
                "WHERE UserId = @p0 AND CancelledAtUtc IS NULL", fatherId);
            var states = g.GetDndStates(171, 27, 34, "Parent").ToList();
            Expect("T7-D17 expired DND reads as inactive but is NOT deleted",
                states.Count >= 1 && states.All(x => !x.IsActive) &&
                Scalar(db, "SELECT COUNT(*) FROM MonitoringDnd WHERE UserId = @p0", fatherId) >= 1);
            Expect("T7-D18 an expired DND frees the other parent again",
                g.EnableDnd(171, 27, 34, "Parent") != null);
        }

        // ==================================================================
        // THE PHASE 7 SECURITY FIX
        // Child.Parent_ID is NOT monitoring authorization, anywhere.
        // ==================================================================
        private static void RunSecurityTests(
            BabySitterBooking_and_BabyMinderEntities db, MonitoringService mon, CryIncidentService inc, int fatherId)
        {
            // Parent 1 is the owner of a DIFFERENT child (Child.Parent_ID = 1 for
            // child 1) but has NO ChildGuardian row for child 27 - the frozen
            // architecture must refuse him, exactly as it always did.
            Expect("T7-S1 a parent in Child.Parent_ID but NOT in ChildGuardian is NOT a guardian",
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM Child WHERE Child_ID = 1 AND Parent_ID = 1 AND IsDeleted = 0").Single() == 1 &&
                db.Database.SqlQuery<int>(
                    "SELECT COUNT(*) FROM ChildGuardian WHERE Child_ID = 27 AND Parent_ID = 1 AND IsDeleted = 0").Single() == 0 &&
                MonitoringAccess.Check(db, 1, "Parent", 171, 27) == MonitoringDenial.NotGuardian);

            // The escalation fan-out must use ChildGuardian ONLY. Notification
            // counts are measured as DELTAS so the assertion is about THIS
            // escalation, not about rows earlier tests already created.
            int beforeP1 = CountNotif(db, 1, "CryAlertParent");
            int beforeMother = CountNotif(db, 34, "CryAlertParent");
            int beforeFather = CountNotif(db, fatherId, "CryAlertParent");

            var incident = inc.CreateIncident(171, 27, 19, "Sitter");
            db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET EscalationStage = 1, NextEscalationDueAt = DATEADD(SECOND, -1, GETUTCDATE()) WHERE Id = @p0",
                incident.Id);
            var sweep = inc.ProcessDueEscalations(50);

            Expect("T7-S2 the parent-escalation fan-out goes to CHILDGUARDIAN parents only",
                sweep.ParentEscalations == 1 &&
                CountNotif(db, 34, "CryAlertParent") == beforeMother + 1 &&
                CountNotif(db, fatherId, "CryAlertParent") == beforeFather + 1,
                "escalations=" + sweep.ParentEscalations +
                " mother+" + (CountNotif(db, 34, "CryAlertParent") - beforeMother) +
                " father+" + (CountNotif(db, fatherId, "CryAlertParent") - beforeFather));
            Expect("T7-S3 a parent who is only in Child.Parent_ID gets NO escalation notification",
                CountNotif(db, 1, "CryAlertParent") == beforeP1,
                "delta=" + (CountNotif(db, 1, "CryAlertParent") - beforeP1));

            // And the legacy owner column must never be used as the guardian set
            // even when NO ChildGuardian row exists at all.
            //
            // Start from a CLEAN child-29 incident: the Phase 5/6 dedupe guard
            // (HasAudit "ParentEscalated") would otherwise suppress the very
            // escalation this test wants to observe.
            db.Database.ExecuteSqlCommand("DELETE FROM ChildGuardian");
            db.Database.ExecuteSqlCommand("DELETE FROM CryAlert WHERE Child_ID = 29 AND IsDeleted = 0");
            db.Database.ExecuteSqlCommand(
                "DELETE FROM MonitorEvent WHERE EventType = 'ParentEscalated' AND Child_ID = 29");
            int beforeNoGuardian = CountNotif(db, 34, "CryAlertParent");
            var orphan = inc.CreateIncident(171, 29, 19, "Sitter");
            db.Database.ExecuteSqlCommand(
                "UPDATE CryAlert SET EscalationStage = 1, NextEscalationDueAt = DATEADD(SECOND, -1, GETUTCDATE()) WHERE Id = @p0",
                orphan.Id);
            var sweep2 = inc.ProcessDueEscalations(50);
            Expect("T7-S4 with NO ChildGuardian rows, the fan-out notifies NOBODY (no owner fallback)",
                sweep2.ParentEscalations == 1 &&
                CountNotif(db, 34, "CryAlertParent") == beforeNoGuardian,
                "delta=" + (CountNotif(db, 34, "CryAlertParent") - beforeNoGuardian));
            Expect("T7-S5 the parent-escalation audit records the real guardian count",
                Scalar(db, "SELECT COUNT(*) FROM MonitorEvent WHERE EventType = 'ParentEscalated' AND PayloadJson LIKE '%guardianCount%'") >= 1);
        }

        // ==================================================================
        // RESIDUE (from a FRESH context, after the rollback)
        // ==================================================================
        private static int[] Snapshot()
        {
            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            {
                return new[]
                {
                    Scalar(db, "SELECT COUNT(*) FROM Child"),
                    Scalar(db, "SELECT COUNT(*) FROM Parent"),
                    Scalar(db, "SELECT COUNT(*) FROM ChildGuardian"),
                    Scalar(db, "SELECT COUNT(*) FROM GuardianInvitation"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitorSession"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitoringPause"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitoringDnd"),
                    Scalar(db, "SELECT COUNT(*) FROM CryAlert"),
                    Scalar(db, "SELECT COUNT(*) FROM MonitorEvent"),
                    Scalar(db, "SELECT COUNT(*) FROM Notification"),
                    Scalar(db, "SELECT COUNT(*) FROM UserSessions")
                };
            }
        }

        private static void RunResidue(int[] baseline)
        {
            var after = Snapshot();
            string[] names =
            {
                "Child", "Parent", "ChildGuardian", "GuardianInvitation", "MonitorSession",
                "MonitoringPause", "MonitoringDnd", "CryAlert", "MonitorEvent",
                "Notification", "UserSessions"
            };
            for (int i = 0; i < names.Length; i++)
            {
                Expect("R7 residue: " + names[i] + " count == baseline (" + baseline[i] + ")",
                    after[i] == baseline[i], "after=" + after[i]);
            }
        }

        private static int Main()
        {
            Console.OutputEncoding = Encoding.UTF8;
            var baseline = Snapshot();
            Console.WriteLine("[BASE] counts captured: " + string.Join(", ", baseline));

            using (var db = new BabySitterBooking_and_BabyMinderEntities())
            using (var tx = db.Database.BeginTransaction())
            {
                try
                {
                    int fatherId;
                    RunFixtures(db, out fatherId);

                    var mon = new MonitoringService(db, ownsContext: false);
                    var inc = new CryIncidentService(db, ownsContext: false);
                    var g = new GuardianConnectionService(db, ownsContext: false);

                    RunGuardianTests(db, g, fatherId);
                    RunGuardianAcceptTests(db, g, fatherId);
                    RunGuardianLifecycleTests(db, g, fatherId);

                    RunPauseRequestTests(db, g, mon, fatherId);
                    RunPauseApprovalTests(db, g, mon, inc, fatherId);
                    RunPauseSitterAndExpiryTests(db, g, mon, inc, fatherId);
                    RunPauseDenyTests(db, g, fatherId);
                    RunPauseLifecycleTests(db, g, mon, fatherId);

                    RunDndTests(db, g, mon, inc, fatherId);
                    RunSecurityTests(db, mon, inc, fatherId);

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

            RunResidue(baseline);
            Console.WriteLine();
            Console.WriteLine(string.Format("RESULT: {0} passed, {1} failed", _pass, _fail));
            return _fail == 0 ? 0 : 1;
        }
    }
}