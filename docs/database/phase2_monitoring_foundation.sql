/*
    LITTLE CARE — PHASE 2
    Monitoring Database Foundation

    PURPOSE:
    Adds the database foundation required by the future
    Child Monitoring feature. This script creates schema ONLY.
    No monitoring runtime behavior (controllers, services, heartbeat
    endpoints, escalation jobs, triggers, JaaS, frontend) is
    implemented here — those belong to later phases.

    ARCHITECTURE (FROZEN — DO NOT REOPEN):
    - SQL Server + EF6 Database-First. Model1.edmx stays UNCHANGED.
    - These additions are delivered through this additive SQL script.
    - The later monitoring implementation reads/writes these tables
      with RAW SQL (approved approach), so no EDMX regeneration and
      no Code First migrations are ever needed for these objects.
    - A sitting (job in progress) = Job + JobChildren.
    - Monitoring state = MonitorSession, PER CHILD (one session row
      per child of the job, never one shared row for a multi-child job).
    - Guardians = ChildGuardian. Child.Parent_ID stays for backward
      compatibility. There is NO new Family table.
    - Cry incidents = the EXISTING CryAlert table (extended here).
      We deliberately do NOT create a "MonitoringIncident" table,
      because two competing incident concepts would be confusing.
    - Audit = MonitorEvent, append-only.

    TARGET DATABASE (development):
    Server:   DESKTOP-UD649GB\SQLEXPRESS
    Database: "BabySitterBooking and BabyMinder"
    (Same database as Web.config connection string
     "BabySitterBooking_and_BabyMinderEntities".)

    IDEMPOTENCY:
    Every CREATE/ALTER is guarded by an existence check
    (OBJECT_ID / COL_LENGTH / sys.indexes / sys.foreign_keys /
    sys.key_constraints). The script may be executed any number
    of times: first run applies, later runs are no-ops.

    TRANSACTION BEHAVIOR:
    The whole script runs inside ONE transaction with XACT_ABORT ON.
    It either applies completely or not at all — no half-applied
    state. On failure the transaction is rolled back and the error
    is re-thrown.

    DATA SAFETY:
    - No DROP, no TRUNCATE, no DELETE, no renames.
    - No existing data is modified, backfilled or fabricated
      (no fake guardians, sessions, or CryAlert-child links).
    - CryAlert contains 0 rows (verified before Phase 2); its new
      columns are still NULLABLE so historical rows stay valid.

    NOT IN SCOPE (future phases — do not add here):
    MonitoringController/Service/Access, MonitorSession endpoints,
    heartbeat logic, connection-loss detection, escalation engine,
    SQL Agent jobs, sweep endpoint, cry lifecycle logic, DND logic,
    pause workflow, calming-video API, JaaS/JWT media, SignalR,
    frontend monitoring screens, notification fan-out.

    FUTURE CONSUMERS:
    MonitoringAccess, MonitoringService, CryAlertService,
    EscalationSweeper, Parent/Sitter monitoring APIs.

    HOW TO RUN (from SQLCMD or SSMS, in the target database):
        sqlcmd -S DESKTOP-UD649GB\SQLEXPRESS -E ^
               -d "BabySitterBooking and BabyMinder" ^
               -i docs/database/phase2_monitoring_foundation.sql

    PHASE 1 NOTE (status spelling):
    Phase 1 discovered legacy rows store Job.Status as 'InProgress'
    while display code uses 'In Progress'. This script does NOT
    touch status data. Future monitoring authorization must treat
    "job is actively in progress" conceptually as
    Job.Status == InProgress and deliberately handle BOTH spellings
    when implemented (raw SQL there). Also: GetActiveJob including
    'SitterArrived' is NOT monitoring authorization — monitoring will
    later require the job's genuinely active state.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    /* =================================================================
       SECTION A — TABLE: ChildGuardian
       -----------------------------------------------------------------
       PURPOSE:
       Child.Parent_ID keeps representing the ORIGINAL primary-parent
       relationship and must not be removed — existing code, jobs and
       queries depend on it. ChildGuardian adds support for MULTIPLE
       parent/guardian accounts per child without breaking that schema:

           Child A  ←→  Mother  (Parent row 1)
           Child A  ←→  Father  (Parent row 2)
           Child A  ←→  Other approved guardian (Parent row 3)

       WHY (Child_ID, Parent_ID) IS UNIQUE:
       The same parent must not be linked to the same child twice.
       The unique constraint is the database-level guarantee that
       guardian relationships are never duplicated.

       CanApprovePause (BIT, default 0):
       Whether this guardian may approve a future monitoring pause
       request. IMPORTANT: this table only DEFINES the relationship
       and the flag; server-side business logic (later phase) must
       enforce the rule. The table alone grants nothing.

       IsPrimary (BIT, default 0):
       Marks which guardian is the primary contact for the child.
       With Child.Parent_ID still present, the IsPrimary row is the
       ChildGuardian mirror of that original relationship (kept in
       sync by the future application layer, not by this script).

       IsDeleted:
       Follows the existing project convention — tables in this
       database soft-delete via an IsDeleted BIT default 0 column
       (Child, Parent, Job, JobChildren, CryAlert, Notification...).
       We do the same instead of hard deletes.

       SECURITY:
       Guardian relationships drive who may see/approve monitoring
       actions later. Authorization must always be checked server-side
       against this table — never trusted from the client.

       LIFECYCLE:
       Rows are added when a guardian relationship is established and
       soft-deleted when it ends. Nothing in Phase 2 writes rows.

       FUTURE CONSUMERS:
       MonitoringAccess (guardian authorization checks), parent
       management APIs.
       ================================================================= */

    IF OBJECT_ID('dbo.ChildGuardian', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.ChildGuardian (
            ChildGuardian_ID  INT IDENTITY(1,1) NOT NULL,
            Child_ID          INT                NOT NULL,
            Parent_ID         INT                NOT NULL,
            Relation          NVARCHAR(50)       NULL,
            CanApprovePause   BIT                NOT NULL CONSTRAINT DF_ChildGuardian_CanApprovePause DEFAULT (0),
            IsPrimary         BIT                NOT NULL CONSTRAINT DF_ChildGuardian_IsPrimary       DEFAULT (0),
            CreatedAt         DATETIME           NOT NULL CONSTRAINT DF_ChildGuardian_CreatedAt       DEFAULT (GETUTCDATE()),
            IsDeleted         BIT                NOT NULL CONSTRAINT DF_ChildGuardian_IsDeleted       DEFAULT (0),
            CONSTRAINT PK_ChildGuardian PRIMARY KEY CLUSTERED (ChildGuardian_ID)
        );
        PRINT 'Created table dbo.ChildGuardian.';
    END
    ELSE
        PRINT 'dbo.ChildGuardian already exists - skipped CREATE.';

    -- ChildGuardian.Child_ID -> Child.Child_ID
    -- (NO ACTION: matches every existing FK in this database; no cascade deletes.)
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ChildGuardian_Child')
    BEGIN
        ALTER TABLE dbo.ChildGuardian ADD CONSTRAINT FK_ChildGuardian_Child
            FOREIGN KEY (Child_ID) REFERENCES dbo.Child (Child_ID);
        PRINT 'Created FK_ChildGuardian_Child.';
    END;

    -- ChildGuardian.Parent_ID -> Parent.Parent_ID
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ChildGuardian_Parent')
    BEGIN
        ALTER TABLE dbo.ChildGuardian ADD CONSTRAINT FK_ChildGuardian_Parent
            FOREIGN KEY (Parent_ID) REFERENCES dbo.Parent (Parent_ID);
        PRINT 'Created FK_ChildGuardian_Parent.';
    END;

    -- One guardian appears at most once per child.
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UQ_ChildGuardian_Child_Parent')
    BEGIN
        ALTER TABLE dbo.ChildGuardian ADD CONSTRAINT UQ_ChildGuardian_Child_Parent
            UNIQUE (Child_ID, Parent_ID);
        PRINT 'Created UQ_ChildGuardian_Child_Parent (Child_ID, Parent_ID).';
    END;

    /* =================================================================
       SECTION B — TABLE: MonitorSession
       -----------------------------------------------------------------
       PURPOSE:
       Holds the runtime STATE of monitoring for ONE child during a
       job. The architecture is PER CHILD — a job's children are
       listed in JobChildren, and each monitored child gets his or
       her own MonitorSession row:

           Job (multi-child sitting)
             ├── Child A  →  JobChildren row  →  MonitorSession A
             ├── Child B  →  JobChildren row  →  MonitorSession B
             └── Child C  →  JobChildren row  →  MonitorSession C

       Do NOT create one shared MonitorSession for an entire
       multi-child job — that would break per-child state
       (heartbeats, DND, calming video, pause are per child).

       IMPORTANT COLUMNS:
       - Job_ID / Child_ID : the sitting and the monitored child.
         Membership of the child in the job is defined by JobChildren
         (Job_ID, Child_ID). The FKs below only guarantee the job and
         child themselves exist; app-level logic (later raw SQL) must
         verify the child belongs to the job via JobChildren.
       - RoomName : reserved for the future media layer (a media room
         per session). STORAGE ONLY in Phase 2 — no JaaS, no JWT, no
         room exposure through APIs, no logging of room names.
       - Status : 'Active' by default. The later application layer
         defines the lifecycle; the schema must at least represent
         'Active', 'Paused', 'Ended'. No enum table, no triggers,
         no lifecycle logic in Phase 2.
       - ParentHeartbeatUtc / SitterHeartbeatUtc : STORAGE ONLY.
         Later phases read these timestamps to detect that an
         authorized participant stopped communicating. No heartbeat
         endpoints or connection-loss logic exist yet.
       - ParentDndUntilUtc / SitterDndUntilUtc : STORAGE ONLY.
         Do-Not-Disturb windows per participant role. No DND logic or
         mutual-exclusion enforcement in Phase 2. Mother/Father
         granularity comes from ChildGuardian (who the guardians are)
         plus MonitorEvent actor rows (who did what) — the session
         itself is per child, so no extra DND columns are needed.
         This matches the approved field list; no redesign performed.
       - CalmingVideoRequired / CalmingVideoWatchedAt : the
         SESSION-level state of whether a calming video is required /
         was watched. The actual child-level media file reference
         lives on Child (CalmingVideoUrl / CalmingVideoThumbnail) —
         different concern, different table.
       - IsDeleted : project soft-delete convention (see Section A).

       DELETION / CASCADE:
       FKs are NO ACTION (project convention; every existing FK in
       this database is NO ACTION). Monitoring records must remain
       auditable — no cascade that could silently erase history.

       SECURITY:
       Session rows tie a child to a job; later authorization must
       verify caller's role (assigned sitter for that job, or a
       guardian of that child) before exposing or mutating them.

       FUTURE CONSUMERS:
       MonitoringService, MonitorSession APIs, heartbeat handling,
       DND, calming-video flow, media (JaaS room binding).
       ================================================================= */

    IF OBJECT_ID('dbo.MonitorSession', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MonitorSession (
            MonitorSession_ID       INT IDENTITY(1,1) NOT NULL,
            Job_ID                  INT                NOT NULL,
            Child_ID                INT                NOT NULL,
            RoomName                NVARCHAR(200)      NOT NULL,
            Status                  NVARCHAR(20)       NOT NULL CONSTRAINT DF_MonitorSession_Status       DEFAULT ('Active'),
            StartedAtUtc            DATETIME           NOT NULL CONSTRAINT DF_MonitorSession_StartedAtUtc DEFAULT (GETUTCDATE()),
            EndedAtUtc              DATETIME           NULL,
            ParentHeartbeatUtc      DATETIME           NULL,
            SitterHeartbeatUtc      DATETIME           NULL,
            ParentDndUntilUtc       DATETIME           NULL,
            SitterDndUntilUtc       DATETIME           NULL,
            CalmingVideoRequired    BIT                NOT NULL CONSTRAINT DF_MonitorSession_CalmingVideoRequired DEFAULT (0),
            CalmingVideoWatchedAt   DATETIME           NULL,
            IsDeleted               BIT                NOT NULL CONSTRAINT DF_MonitorSession_IsDeleted    DEFAULT (0),
            CONSTRAINT PK_MonitorSession PRIMARY KEY CLUSTERED (MonitorSession_ID)
        );
        PRINT 'Created table dbo.MonitorSession.';
    END
    ELSE
        PRINT 'dbo.MonitorSession already exists - skipped CREATE.';

    -- MonitorSession.Job_ID -> Job.Job_ID (NO ACTION: keep monitoring rows auditable.)
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MonitorSession_Job')
    BEGIN
        ALTER TABLE dbo.MonitorSession ADD CONSTRAINT FK_MonitorSession_Job
            FOREIGN KEY (Job_ID) REFERENCES dbo.Job (Job_ID);
        PRINT 'Created FK_MonitorSession_Job.';
    END;

    -- MonitorSession.Child_ID -> Child.Child_ID (NO ACTION.)
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MonitorSession_Child')
    BEGIN
        ALTER TABLE dbo.MonitorSession ADD CONSTRAINT FK_MonitorSession_Child
            FOREIGN KEY (Child_ID) REFERENCES dbo.Child (Child_ID);
        PRINT 'Created FK_MonitorSession_Child.';
    END;

    /* =================================================================
       SECTION C — TABLE: Child (media columns only)
       -----------------------------------------------------------------
       WHY: The approved architecture stores the child's ACTUAL
       calming-video media reference at child level (a per-child file,
       reusable across sessions), while MonitorSession only tracks
       session-level state (required / watched-at). Two different
       concerns → two different tables.

       STORAGE ONLY — Phase 2 does NOT add:
       upload endpoints, streaming, cloud storage, validation logic,
       or any JaaS/media functionality. Later phases handle secure
       media access and validation.

       AGE RULE (DO NOT ADD IsUnderFive / AgeGroup):
       The approved architecture derives the child's age group from
       Child.DOB at runtime. Child.DOB is DATE NOT NULL and already
       exists. Duplicating age into a stored flag would create a
       second source of truth that goes stale on every birthday and
       invites inconsistency. The database must NOT carry this data.
       ================================================================= */

    IF COL_LENGTH('dbo.Child', 'CalmingVideoUrl') IS NULL
    BEGIN
        ALTER TABLE dbo.Child ADD CalmingVideoUrl NVARCHAR(500) NULL;
        PRINT 'Added Child.CalmingVideoUrl.';
    END;

    IF COL_LENGTH('dbo.Child', 'CalmingVideoThumbnail') IS NULL
    BEGIN
        ALTER TABLE dbo.Child ADD CalmingVideoThumbnail NVARCHAR(500) NULL;
        PRINT 'Added Child.CalmingVideoThumbnail.';
    END;

    /* =================================================================
       SECTION D — EXTEND TABLE: CryAlert
       -----------------------------------------------------------------
       WHY EXTEND INSTEAD OF A NEW "MonitoringIncident" TABLE:
       CryAlert already IS this project's cry-detection record
       (created by the YAMNet CryDetection flow; columns Id, Timestamp,
       Level, RoomName, JobId, ParentId, BabysitterId, CreatedAt,
       IsDeleted). A second incident table would create two competing
       concepts for the same real-world event. The architecture
       therefore extends CryAlert.

       FUTURE FLOW (later phases — only storage exists now):
           YAMNet detection
                ↓
           CryDetection API        (exists today)
                ↓
           CryAlert incident       (this table, extended here)
                ↓
           MonitorSession + Child  (link via Child_ID / MonitorSession_ID)
                ↓
           Escalation state        (EscalationStage / NextEscalationDueAt)
                ↓
           Notification
                ↓
           Resolution / Cancel     (ResolvedAtUtc / CancelledAtUtc...)

       NEW COLUMNS:
       - Child_ID (NULL!) / MonitorSession_ID (NULL!):
         Nullable on purpose — historical alerts must remain valid
         without a child/session link. Phase 2 does NOT backfill or
         fabricate child/session values for existing rows.
       - Status: future lifecycle values Open / Acknowledged /
         Escalated / Resolved / Cancelled (all fit NVARCHAR(20)).
         Nullable so legacy rows stay untouched. NO lifecycle logic,
         NO triggers in Phase 2 — the application layer defines
         transitions later.
       - EscalationStage / NextEscalationDueAt: foundation for the
         approved PERSISTED DUE-WORK architecture — a later phase
         atomically claims rows where a due time has passed. Phase 2
         explicitly does NOT implement: timers, threads, MemoryCache,
         background workers, Hangfire, Quartz, or SQL Agent jobs.
       - AcknowledgedAt / AcknowledgedByUserId / SitterResponse /
         RespondedAt: who acknowledged and how the sitter responded.
       - ResolvedAtUtc / CancelledAtUtc / CancellationReason:
         end states of the incident.

       NAMING NOTE (reported, not "fixed"):
       Existing CryAlert columns use the Id-suffix style (JobId,
       ParentId, BabysitterId) while the approved Phase 2 spec uses
       Child_ID / MonitorSession_ID. The spec is authoritative, so
       the new columns follow the spec; both styles now coexist.
       Do NOT rename existing columns.

       ROW SAFETY:
       CryAlert had 0 rows when Phase 2 was written (verified). New
       columns are still nullable/defaulted so this remains safe if
       rows exist on any other machine.

       FUTURE CONSUMERS:
       CryAlertService, EscalationSweeper, monitoring APIs.
       ================================================================= */

    -- Each column guarded individually so a partially-applied state
    -- (e.g. someone ran an older draft by hand) also converges safely.
    IF COL_LENGTH('dbo.CryAlert', 'Child_ID') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD Child_ID INT NULL;
        PRINT 'Added CryAlert.Child_ID.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'MonitorSession_ID') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD MonitorSession_ID INT NULL;
        PRINT 'Added CryAlert.MonitorSession_ID.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'Status') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD Status NVARCHAR(20) NULL
            CONSTRAINT DF_CryAlert_Status DEFAULT ('Open');
        PRINT 'Added CryAlert.Status.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'EscalationStage') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD EscalationStage INT NOT NULL
            CONSTRAINT DF_CryAlert_EscalationStage DEFAULT (0);
        PRINT 'Added CryAlert.EscalationStage.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'NextEscalationDueAt') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD NextEscalationDueAt DATETIME NULL;
        PRINT 'Added CryAlert.NextEscalationDueAt.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'AcknowledgedAt') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD AcknowledgedAt DATETIME NULL;
        PRINT 'Added CryAlert.AcknowledgedAt.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'AcknowledgedByUserId') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD AcknowledgedByUserId INT NULL;
        PRINT 'Added CryAlert.AcknowledgedByUserId.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'SitterResponse') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD SitterResponse NVARCHAR(40) NULL;
        PRINT 'Added CryAlert.SitterResponse.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'RespondedAt') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD RespondedAt DATETIME NULL;
        PRINT 'Added CryAlert.RespondedAt.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'ResolvedAtUtc') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD ResolvedAtUtc DATETIME NULL;
        PRINT 'Added CryAlert.ResolvedAtUtc.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'CancelledAtUtc') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD CancelledAtUtc DATETIME NULL;
        PRINT 'Added CryAlert.CancelledAtUtc.';
    END;

    IF COL_LENGTH('dbo.CryAlert', 'CancellationReason') IS NULL
    BEGIN
        ALTER TABLE dbo.CryAlert ADD CancellationReason NVARCHAR(200) NULL;
        PRINT 'Added CryAlert.CancellationReason.';
    END;

    -- CryAlert.Child_ID -> Child.Child_ID (NO ACTION; NULL allowed for legacy rows.)
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CryAlert_Child')
    BEGIN
        ALTER TABLE dbo.CryAlert ADD CONSTRAINT FK_CryAlert_Child
            FOREIGN KEY (Child_ID) REFERENCES dbo.Child (Child_ID);
        PRINT 'Created FK_CryAlert_Child.';
    END;

    -- CryAlert.MonitorSession_ID -> MonitorSession.MonitorSession_ID (NO ACTION.)
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CryAlert_MonitorSession')
    BEGIN
        ALTER TABLE dbo.CryAlert ADD CONSTRAINT FK_CryAlert_MonitorSession
            FOREIGN KEY (MonitorSession_ID) REFERENCES dbo.MonitorSession (MonitorSession_ID);
        PRINT 'Created FK_CryAlert_MonitorSession.';
    END;

    -- AcknowledgedByUserId deliberately gets NO foreign key:
    -- this database has NO unified "User" table. Users live in two
    -- separate tables (Parent.Parent_ID and Babysitter.Sitter_ID),
    -- and the acknowledging user can be either a parent or a sitter.
    -- A single FK would force one wrong reference. This matches the
    -- existing project convention (UserSessions.UserId and
    -- CryAlert.ParentId/BabysitterId also carry no FKs). The
    -- application layer validates the actor's identity instead.

    /* =================================================================
       SECTION E — TABLE: MonitorEvent
       -----------------------------------------------------------------
       PURPOSE:
       Append-only AUDIT TRAIL for everything the monitoring system
       does. Future event types (documentation examples only — NO
       rows, enums, or triggers are created in Phase 2):
           MonitoringStarted, MonitoringEnded, CryDetected,
           CryEscalated, SitterAcknowledged, SitterViewing,
           SitterWithChild, PauseRequested, PauseApproved,
           PauseRejected, ConnectionLost, ConnectionRestored,
           CalmingVideoStarted, CalmingVideoStopped

       IMMUTABILITY:
       This table is INSERT-ONLY by design. There must be no UPDATE
       or DELETE business operations for MonitorEvent, and no cascade
       that could silently erase audit records. It intentionally has
       NO foreign keys: audit writes must never fail because a
       referenced job/child/incident row was cleaned up, and the same
       "no FK" precedent already exists on CryAlert.JobId/ParentId.
       Referential values (Job_ID, Child_ID, IncidentId) are still
       kept consistent by the writing application logic.

       IMPORTANT COLUMNS:
       - MonitorEvent_ID BIGINT identity: high-volume-safe ordering.
       - Job_ID / Child_ID / IncidentId: nullable context. IncidentId
         is UNIQUEIDENTIFIER matching CryAlert.Id so an event can be
         tied to a cry incident when relevant.
       - EventType NVARCHAR(50): free-form event name; no enum table
         (Phase 2 does not define application events).
       - ActorUserId / ActorRole: WHO did it (polymorphic user id —
         parent or sitter — plus their role, mirroring the
         Notification table's UserID + UserRole pattern; no FK for
         the same no-unified-user-table reason as Section D).
       - PayloadJson: small flexible context, e.g.
             {"reason":"Parent approved pause"}
             {"escalationStage":2}
         SECURITY: never store passwords, tokens, secrets, media
         credentials, or unnecessary personal information here.
         Payload generation itself is a later-phase concern.

       FUTURE CONSUMERS:
       MonitoringService, audit/history APIs, support debugging.
       ================================================================= */

    IF OBJECT_ID('dbo.MonitorEvent', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.MonitorEvent (
            MonitorEvent_ID BIGINT IDENTITY(1,1) NOT NULL,
            Job_ID          INT              NULL,
            Child_ID        INT              NULL,
            IncidentId      UNIQUEIDENTIFIER NULL,
            EventType       NVARCHAR(50)     NOT NULL,
            ActorUserId     INT              NULL,
            ActorRole       NVARCHAR(20)     NULL,
            AtUtc           DATETIME         NOT NULL CONSTRAINT DF_MonitorEvent_AtUtc DEFAULT (GETUTCDATE()),
            PayloadJson     NVARCHAR(MAX)    NULL,
            CONSTRAINT PK_MonitorEvent PRIMARY KEY CLUSTERED (MonitorEvent_ID)
        );
        PRINT 'Created table dbo.MonitorEvent.';
    END
    ELSE
        PRINT 'dbo.MonitorEvent already exists - skipped CREATE.';

    /* =================================================================
       SECTION F — INDEXES
       -----------------------------------------------------------------
       All five approved indexes were checked against the REAL schema
       before creation; every referenced column exists (Child_ID and
       the CryAlert monitoring columns were added in Section D),
       so no adaptation of the approved definitions was needed.

       SQL Server has no "CREATE INDEX IF NOT EXISTS", so each index
       is guarded by a sys.indexes name check.
       ================================================================= */

    -- WHY: fast lookup of the live session(s) for a job/child.
    -- SUPPORTS: "find active session for this job + this child"
    --            (heartbeat updates, session start/end, status reads)
    --            and "list all active sessions" (Status first).
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.MonitorSession')
                     AND name = 'IX_MonitorSession_Active')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_MonitorSession_Active
            ON dbo.MonitorSession (Status, Job_ID, Child_ID);
        PRINT 'Created IX_MonitorSession_Active.';
    END;

    -- WHY: the future escalation sweep claims due work by asking:
    --      "which alerts are still in an escalation-eligible Status
    --       and due at or before NOW()?"
    -- SUPPORTS: EscalationSweeper atomic due-work claim
    --           (Status equality + NextEscalationDueAt range scan).
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.CryAlert')
                     AND name = 'IX_CryAlert_Due')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_CryAlert_Due
            ON dbo.CryAlert (Status, NextEscalationDueAt);
        PRINT 'Created IX_CryAlert_Due.';
    END;

    -- WHY: parent-facing history: "my child's cry alerts, newest first".
    -- SUPPORTS: parent monitoring/incident list filtered by parent and
    --           child, ordered by detection time DESC.
    -- (ParentId, Child_ID, Timestamp all pre-exist on CryAlert except
    --  Child_ID which Section D added — matches approved definition.)
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.CryAlert')
                     AND name = 'IX_CryAlert_Parent_Child_Time')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_CryAlert_Parent_Child_Time
            ON dbo.CryAlert (ParentId, Child_ID, [Timestamp] DESC);
        PRINT 'Created IX_CryAlert_Parent_Child_Time.';
    END;

    -- WHY: inbox-style reads: "notifications for this user/role,
    --      newest first" — matches Notification's existing
    --      (UserID, UserRole, CreatedAt) columns exactly.
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.Notification')
                     AND name = 'IX_Notification_User')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_Notification_User
            ON dbo.Notification (UserID, UserRole, CreatedAt DESC);
        PRINT 'Created IX_Notification_User.';
    END;

    -- WHY: monitoring authorization will eventually ask
    --      "which jobs are assigned to this sitter in this status"
    --      (Job.AssignedSitter_ID + Job.Status both pre-exist).
    -- NOTE: Phase 1 status-spelling caveat applies — queries using
    --       this index must handle 'InProgress' AND 'In Progress'.
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.Job')
                     AND name = 'IX_Job_Sitter_Status')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_Job_Sitter_Status
            ON dbo.Job (AssignedSitter_ID, Status);
        PRINT 'Created IX_Job_Sitter_Status.';
    END;

    COMMIT TRANSACTION;
    PRINT 'PHASE 2 MIGRATION: committed successfully.';
END TRY
BEGIN CATCH
    -- Never leave a half-applied schema: roll back everything.
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;
    PRINT 'PHASE 2 MIGRATION: FAILED - transaction rolled back, no changes were kept.';
    THROW;
END CATCH;

    /* =================================================================
       SECTION G — POST-RUN VERIFICATION (read-only)
       -----------------------------------------------------------------
       Runs outside the migration transaction. After execution you
       should see three "EXISTS" tables = 1, all column checks = 1,
       five indexes = 1, and the six relationship/constraint checks
       = 1. Re-running the whole script later must produce identical
       results (idempotency).
       ================================================================= */
SELECT 'ChildGuardian table'   AS CheckItem,
       CASE WHEN OBJECT_ID('dbo.ChildGuardian','U')  IS NOT NULL THEN 1 ELSE 0 END AS OK
UNION ALL
SELECT 'MonitorSession table',
       CASE WHEN OBJECT_ID('dbo.MonitorSession','U') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'MonitorEvent table',
       CASE WHEN OBJECT_ID('dbo.MonitorEvent','U')   IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'Child.CalmingVideoUrl',
       CASE WHEN COL_LENGTH('dbo.Child','CalmingVideoUrl') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'Child.CalmingVideoThumbnail',
       CASE WHEN COL_LENGTH('dbo.Child','CalmingVideoThumbnail') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.Child_ID',
       CASE WHEN COL_LENGTH('dbo.CryAlert','Child_ID') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.MonitorSession_ID',
       CASE WHEN COL_LENGTH('dbo.CryAlert','MonitorSession_ID') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.Status',
       CASE WHEN COL_LENGTH('dbo.CryAlert','Status') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.EscalationStage',
       CASE WHEN COL_LENGTH('dbo.CryAlert','EscalationStage') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.NextEscalationDueAt',
       CASE WHEN COL_LENGTH('dbo.CryAlert','NextEscalationDueAt') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.AcknowledgedAt',
       CASE WHEN COL_LENGTH('dbo.CryAlert','AcknowledgedAt') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.AcknowledgedByUserId',
       CASE WHEN COL_LENGTH('dbo.CryAlert','AcknowledgedByUserId') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.SitterResponse',
       CASE WHEN COL_LENGTH('dbo.CryAlert','SitterResponse') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.RespondedAt',
       CASE WHEN COL_LENGTH('dbo.CryAlert','RespondedAt') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.ResolvedAtUtc',
       CASE WHEN COL_LENGTH('dbo.CryAlert','ResolvedAtUtc') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.CancelledAtUtc',
       CASE WHEN COL_LENGTH('dbo.CryAlert','CancelledAtUtc') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'CryAlert.CancellationReason',
       CASE WHEN COL_LENGTH('dbo.CryAlert','CancellationReason') IS NOT NULL THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: ChildGuardian->Child',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_ChildGuardian_Child') THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: ChildGuardian->Parent',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_ChildGuardian_Parent') THEN 1 ELSE 0 END
UNION ALL
SELECT 'UQ: ChildGuardian(Child_ID,Parent_ID)',
       CASE WHEN EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='UQ_ChildGuardian_Child_Parent') THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: MonitorSession->Job',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_MonitorSession_Job') THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: MonitorSession->Child',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_MonitorSession_Child') THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: CryAlert->Child',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_CryAlert_Child') THEN 1 ELSE 0 END
UNION ALL
SELECT 'FK: CryAlert->MonitorSession',
       CASE WHEN EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name='FK_CryAlert_MonitorSession') THEN 1 ELSE 0 END
UNION ALL
SELECT 'IX: IX_MonitorSession_Active',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_MonitorSession_Active') THEN 1 ELSE 0 END
UNION ALL
SELECT 'IX: IX_CryAlert_Due',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_CryAlert_Due') THEN 1 ELSE 0 END
UNION ALL
SELECT 'IX: IX_CryAlert_Parent_Child_Time',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_CryAlert_Parent_Child_Time') THEN 1 ELSE 0 END
UNION ALL
SELECT 'IX: IX_Notification_User',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Notification_User') THEN 1 ELSE 0 END
UNION ALL
SELECT 'IX: IX_Job_Sitter_Status',
       CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_Job_Sitter_Status') THEN 1 ELSE 0 END;






