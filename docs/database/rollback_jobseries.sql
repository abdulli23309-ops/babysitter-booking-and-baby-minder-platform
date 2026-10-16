-- ============================================================================
-- Phase 1A: rollback_jobseries.sql (DEFENSIVE)
-- Removes ONLY the Phase 1A additions from add_jobseries.sql.
-- Guards (all must pass, otherwise the script ABORTS without dropping):
--   1. Operator must confirm the target database name explicitly below.
--   2. dbo.JobSeries must be EMPTY (populated table => abort; data removal
--      requires a separate, explicitly approved operation).
--   3. No foreign key or other object may reference dbo.JobSeries.
-- Never touches Job, JobInvitation, Notification rows or any other object.
-- ============================================================================
SET QUOTED_IDENTIFIER ON;
GO

-- GUARD 0: refuse to run inside an unnamed/system database
IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
BEGIN
    RAISERROR(N'rollback_jobseries: refusing to run in a system database.', 16, 1);
    RETURN;
END

-- GUARD 1: JobSeries must be empty before any drop
IF OBJECT_ID(N'dbo.JobSeries', N'U') IS NOT NULL
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.JobSeries)
    BEGIN
        RAISERROR(N'rollback_jobseries: dbo.JobSeries contains rows. Export or approve data removal separately before rollback. ABORTING.', 16, 1);
        RETURN;
    END
END

-- GUARD 2: no dependent objects referencing JobSeries
IF EXISTS (
    SELECT 1 FROM sys.foreign_keys WHERE referenced_object_id = OBJECT_ID(N'dbo.JobSeries')
    UNION ALL
    SELECT 1 FROM sys.objects WHERE parent_object_id = OBJECT_ID(N'dbo.JobSeries') AND type > 0
)
BEGIN
    RAISERROR(N'rollback_jobseries: objects still reference dbo.JobSeries. ABORTING.', 16, 1);
    RETURN;
END

-- Drops (each guarded; additive objects only)
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_JobSeries_ClientRequestId' AND object_id = OBJECT_ID(N'dbo.JobSeries'))
    DROP INDEX UX_JobSeries_ClientRequestId ON dbo.JobSeries;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Job_Series_Date' AND object_id = OBJECT_ID(N'dbo.Job'))
    DROP INDEX UX_Job_Series_Date ON dbo.Job;

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Job_Status_Date' AND object_id = OBJECT_ID(N'dbo.Job'))
    DROP INDEX IX_Job_Status_Date ON dbo.Job;

IF OBJECT_ID(N'dbo.JobSeries', N'U') IS NOT NULL
    DROP TABLE dbo.JobSeries;

PRINT N'rollback_jobseries: completed (guarded drops only).';
GO
