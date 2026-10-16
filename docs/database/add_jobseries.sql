-- ============================================================================
-- Phase 1A: add_jobseries.sql
-- Adds the JobSeries rule table + three indexes supporting atomic, idempotent
-- recurring-series creation (audited design: Phase 0 Addendum + Stage A plan).
--
-- SAFETY: additive only. Creates one table and three indexes. Does not modify
-- any existing column or row. Apply to the target database deliberately:
--   scratch (LittleCare_Bench_20261013) for tests,
--   [BabySitterBooking and BabyMinder] only when deployment is authorized.
-- Rollback: docs/database/rollback_jobseries.sql (defensive, guarded).
-- ============================================================================
SET QUOTED_IDENTIFIER ON;  -- required: filtered indexes
SET ANSI_NULLS ON;
GO

IF OBJECT_ID(N'dbo.JobSeries', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.JobSeries (
        JobSeries_ID        int          NOT NULL CONSTRAINT PK_JobSeries PRIMARY KEY, -- = head Job_ID (existing convention; no FK - legacy rows have none)
        StartDate           date         NOT NULL,   -- requested start, verbatim
        EndDate             date         NOT NULL,   -- requested end, verbatim (never derived from last matching weekday)
        WeekdayMask         nvarchar(64) NOT NULL,   -- normalized 'Sun,Mon,...' (7-day mask = 27 chars)
        StartTime           time(7)      NULL,       -- requested booking window
        EndTime             time(7)      NULL,
        Status              nvarchar(20) NOT NULL CONSTRAINT DF_JobSeries_Status DEFAULT N'Active',
        MaterializedThrough date         NOT NULL,   -- = EndDate under eager generation (Phase 2 watermark)
        ClientRequestId     nvarchar(64) NULL,       -- idempotency key (GUID string)
        CreatedAt           datetime     NOT NULL CONSTRAINT DF_JobSeries_CreatedAt DEFAULT GETDATE()
    );
END
GO

-- Idempotency key: unique among non-NULL request ids
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_JobSeries_ClientRequestId' AND object_id = OBJECT_ID(N'dbo.JobSeries'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_JobSeries_ClientRequestId
        ON dbo.JobSeries (ClientRequestId)
        WHERE ClientRequestId IS NOT NULL;
GO

-- Intra-series duplicate protection (filtered: single-day rows have NULL series id and are excluded)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Job_Series_Date' AND object_id = OBJECT_ID(N'dbo.Job'))
    CREATE UNIQUE NONCLUSTERED INDEX UX_Job_Series_Date
        ON dbo.Job (JobSeries_ID, JobDate)
        WHERE JobSeries_ID IS NOT NULL;
GO

-- ExpireStaleJobs / status scans (validated in the Phase 0 search plan)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Job_Status_Date' AND object_id = OBJECT_ID(N'dbo.Job'))
    CREATE NONCLUSTERED INDEX IX_Job_Status_Date
        ON dbo.Job (Status, JobDate);
GO
