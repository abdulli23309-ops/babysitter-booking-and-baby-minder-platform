/*
    LITTLE CARE - PHASE 14
    Feed Baby - 30-Second Video Recording metadata

    PURPOSE:
    Creates the ONE small metadata table the feeding-video feature needs.
    Schema ONLY: no controller, service, frontend or recording runtime.

    WHY A TABLE IS NECESSARY (Phase 0.5 verification):
    The .webm file itself needs no row - it lives at
    E:\feeding ababy video\<JobId>\<ChildId>\<Guid>.webm and history could in
    principle be read back by listing that folder. Four requirements cannot be
    met from the filesystem alone:

      1. REQUEST LIFECYCLE. A request exists BEFORE any file does
         (Requested -> Recording -> Uploading -> Completed). Directory
         enumeration only sees files that already finished, so Phone 2 would
         have nothing to poll for and the sitter would have no status.
      2. DUPLICATE PROTECTION. "Is a recording already in flight for this
         Job+Child?" is server state. An in-memory cache would be lost on
         app-pool recycle and is forbidden by the feature constraints.
      3. DURATION. DurationSeconds lives in the WebM EBML container, not in
         NTFS metadata, so it is not derivable from a file listing.
      4. AUTHORIZATION BINDING. PublicId must be bound to a (Job_ID, Child_ID)
         the requester was already authorized for, so the streaming endpoint
         never has to trust a client-supplied scope.

    ARCHITECTURE (consistent with the frozen Phase 2/13 rules):
    - SQL Server + EF6 Database-First. Model1.edmx stays UNCHANGED.
    - Read/written with RAW SQL (approved approach for these objects), so no
      EDMX regeneration and no Code First migration is required.
    - Recordings are a PER-CHILD care log, exactly like MonitorSession: one row
      per (Job_ID, Child_ID), never one shared row for a multi-child job.
    - IsDeleted is deliberately ABSENT. A feeding video is historical evidence
      and must never be deleted (S25 of the feature brief). It follows the
      MonitoringDeviceSession / MonitoringPairingCode precedent, which omit
      IsDeleted. Rows are retired by Status, never removed.
    - MonitorSession_ID is deliberately ABSENT. It would make history depend on
      a row monitoring soft-deletes, and recordings must outlive both the
      session and the Job. Authorization is per (Job, Child) via
      MonitoringAccess, so nothing is lost.

    TARGET DATABASE (development):
    Server:   DESKTOP-UD649GB\SQLEXPRESS
    Database: "BabySitterBooking and BabyMinder"

    IDEMPOTENCY:
    Every CREATE is guarded by OBJECT_ID / sys.indexes checks. The script may be
    executed any number of times: first run applies, later runs are no-ops.

    TRANSACTION BEHAVIOR:
    One transaction, XACT_ABORT ON. All-or-nothing; no half-applied state.

    DATA SAFETY:
    - No DROP, no TRUNCATE, no DELETE, no renames.
    - No existing table is modified. FeedingRecording is purely additive.

    HOW TO RUN (from SQLCMD or SSMS, in the target database):
        sqlcmd -S DESKTOP-UD649GB\SQLEXPRESS -E ^
               -d "BabySitterBooking and BabyMinder" ^
               -i docs/database/phase14_feeding_recording.sql

    NOT IN SCOPE (later phases - do not add here):
    upload endpoints, MediaRecorder, streaming, authorization services,
    React UI, duration parsing, retention jobs.
    ================================================================= */

SET ANSI_NULLS ON;
-- PHASE 13 PRECEDENT, NOT OPTIONAL: UX_FeedingRecording_Active is a FILTERED
-- index, and SQL Server refuses to create a filtered index unless
-- QUOTED_IDENTIFIER is ON for the session. sqlcmd leaves it OFF by default, which
-- is why Phase 13 sets it explicitly before its own filtered indexes. Without
-- these two lines the script fails with Msg 1934.
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
    /* =================================================================
       SECTION A - TABLE: FeedingRecording
       -----------------------------------------------------------------
       COLUMN NOTES (types taken from the verified Phase 0.5 review of the
       real schema, not from assumption):
       - FeedingRecording_ID INT IDENTITY: matches MonitorSession /
         ChildGuardian / MonitoringDeviceSession.
       - PublicId UNIQUEIDENTIFIER: the ONLY identifier ever exposed to a
         browser. Matches the existing CryAlert.Id / MonitorEvent.IncidentId
         convention. Indexed unique below.
       - Job_ID / Child_ID INT NOT NULL: exact types of Job.Job_ID and
         Child.Child_ID, verified against Phase 2 DDL.
       - Status NVARCHAR(20): constrained by a CHECK, matching the
         CK_IndependentMonitoringSession_Status precedent from Phase 13
         (Phase 2 used only a default; Phase 13 tightened it, and a lifecycle
         with a CK is the newer and safer convention here).
       - RequestedByUserId / RequestedByRole: POLYMORPHIC, no FK. This
         database has no unified User table - ChildGuardian.Parent_ID and
         Babysitters.Sitter_ID are separate. Mirrors MonitorEvent's
         ActorUserId + ActorRole exactly, including the documented reason.
       - CreatedAtUtc / CompletedAtUtc DATETIME: project convention is
         DATETIME with GETUTCDATE(), NOT DATETIME2. Verified against
         StartedAtUtc, CreatedAtUtc, DetectedAtUtc, AtUtc, ExpiresAtUtc.
       - FileName: the server-generated filename only. The client never
         chooses a filesystem name. Holds "{PublicId}.webm".
       - DurationSeconds: the only value not obtainable from the filesystem.
       - FailureReason: technical detail, deliberately kept server-side so the
         API can return friendly copy while this holds the specifics.
       ================================================================= */
    IF OBJECT_ID('dbo.FeedingRecording', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FeedingRecording (
            FeedingRecording_ID INT IDENTITY(1,1) NOT NULL,
            PublicId            UNIQUEIDENTIFIER NOT NULL,
            Job_ID              INT              NOT NULL,
            Child_ID            INT              NOT NULL,
            Status              NVARCHAR(20)     NOT NULL
                                CONSTRAINT DF_FeedingRecording_Status DEFAULT ('Requested'),
            RequestedByUserId   INT              NULL,
            RequestedByRole     NVARCHAR(20)     NULL,
            CreatedAtUtc        DATETIME         NOT NULL
                                CONSTRAINT DF_FeedingRecording_CreatedAtUtc DEFAULT (GETUTCDATE()),
            CompletedAtUtc      DATETIME         NULL,
            FileName            NVARCHAR(80)     NULL,
            DurationSeconds     INT              NULL,
            FileSizeBytes       BIGINT           NULL,
            FailureReason       NVARCHAR(200)    NULL,
            CONSTRAINT PK_FeedingRecording PRIMARY KEY CLUSTERED (FeedingRecording_ID),
            CONSTRAINT CK_FeedingRecording_Status
                CHECK (Status IN ('Requested','Recording','Uploading','Completed','Failed')),
            -- NO ACTION, matching every existing FK in this database
            -- (ChildGuardian, MonitorSession, MonitoringDeviceSession).
            -- NO CASCADE: feeding videos are a care record; a job or child
            -- must never be able to silently erase the evidence trail.
            CONSTRAINT FK_FeedingRecording_Job
                FOREIGN KEY (Job_ID) REFERENCES dbo.Job(Job_ID),
            CONSTRAINT FK_FeedingRecording_Child
                FOREIGN KEY (Child_ID) REFERENCES dbo.Child(Child_ID)
        );
        PRINT 'Created table dbo.FeedingRecording.';
    END
    ELSE
        PRINT 'dbo.FeedingRecording already exists - skipped CREATE.';
    /* =================================================================
       SECTION B - INDEXES

       UX_FeedingRecording_PublicId
           The public handle must be globally unique; it is also the only thing
           a browser may present, so its uniqueness is a security property, not
           just an optimisation. Mirrors Phase 13 UX_* naming.

       UX_FeedingRecording_Active  (FILTERED, Status = 'Requested')
           SERVER-SIDE DUPLICATE PROTECTION. A second "Feed Baby" press for the
           same Job+Child violates this index and the service converts that
           into a friendly 409, so double-clicking cannot produce two
           recordings even if the client-side guard is bypassed.

           WHY THE FILTER IS THE SINGLE VALUE 'Requested' AND NOT
           IN ('Requested','Recording','Uploading'):
           SQL Server requires a filtered index to use a DISCRETE set of filter
           values the designer intends to keep stable. If a fourth in-flight
           status were added later, the CREATE would fail against existing
           data. Filtering on one value and moving the row OUT of it as work
           advances keeps that set provably stable - and is exactly the shape
           of the two existing Phase 13 precedents
           (UX_IndependentMonitoringSession_ActiveParent filters on
           Status='Active'; IX_IndependentCryEvent_Session_Open filters on
           ResolvedAtUtc IS NULL).

       IX_FeedingRecording_Job_Child_Time
           History reads: "this child's videos for this job, newest first".
           Mirrors IX_CryAlert_Parent_Child_Time, including the DESC on the
           time column, because that DESC is the actual query shape.
       ================================================================= */
    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.FeedingRecording')
                     AND name = 'UX_FeedingRecording_PublicId')
    BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX UX_FeedingRecording_PublicId
            ON dbo.FeedingRecording (PublicId);
        PRINT 'Created UX_FeedingRecording_PublicId.';
    END
    ELSE
        PRINT 'UX_FeedingRecording_PublicId already exists - skipped.';

    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.FeedingRecording')
                     AND name = 'UX_FeedingRecording_Active')
    BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX UX_FeedingRecording_Active
            ON dbo.FeedingRecording (Job_ID, Child_ID)
            WHERE Status = 'Requested';
        PRINT 'Created UX_FeedingRecording_Active (one in-flight request per Job+Child).';
    END
    ELSE
        PRINT 'UX_FeedingRecording_Active already exists - skipped.';

    IF NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE object_id = OBJECT_ID('dbo.FeedingRecording')
                     AND name = 'IX_FeedingRecording_Job_Child_Time')
    BEGIN
        CREATE NONCLUSTERED INDEX IX_FeedingRecording_Job_Child_Time
            ON dbo.FeedingRecording (Job_ID, Child_ID, CreatedAtUtc DESC);
        PRINT 'Created IX_FeedingRecording_Job_Child_Time.';
    END
    ELSE
        PRINT 'IX_FeedingRecording_Job_Child_Time already exists - skipped.';

COMMIT TRANSACTION;
GO

    /* =================================================================
       SECTION C - VERIFICATION (run after the script; all must be 1,
       except FK count which must be 2)
       ================================================================= */
    SELECT 'Table: FeedingRecording' AS CheckItem,
           CASE WHEN EXISTS (SELECT 1 FROM sys.tables
                             WHERE object_id = OBJECT_ID('dbo.FeedingRecording')) THEN 1 ELSE 0 END AS Ok
    UNION ALL
    SELECT 'Index: UX_FeedingRecording_PublicId',
           CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_FeedingRecording_PublicId') THEN 1 ELSE 0 END
    UNION ALL
    SELECT 'Index: UX_FeedingRecording_Active',
           CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_FeedingRecording_Active') THEN 1 ELSE 0 END
    UNION ALL
    SELECT 'Index: IX_FeedingRecording_Job_Child_Time',
           CASE WHEN EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_FeedingRecording_Job_Child_Time') THEN 1 ELSE 0 END
    UNION ALL
    SELECT 'Constraint: CK_FeedingRecording_Status',
           CASE WHEN EXISTS (SELECT 1 FROM sys.check_constraints WHERE name='CK_FeedingRecording_Status') THEN 1 ELSE 0 END
    UNION ALL
    SELECT 'FK count (expect 2: Job, Child)',
           (SELECT COUNT(1) FROM sys.foreign_keys
             WHERE parent_object_id = OBJECT_ID('dbo.FeedingRecording'))
    UNION ALL
    SELECT 'IsDeleted column ABSENT (expect 1)',
           CASE WHEN COL_LENGTH('dbo.FeedingRecording','IsDeleted') IS NULL THEN 1 ELSE 0 END
    UNION ALL
    SELECT 'MonitorSession_ID column ABSENT (expect 1)',
           CASE WHEN COL_LENGTH('dbo.FeedingRecording','MonitorSession_ID') IS NULL THEN 1 ELSE 0 END;