-- ===================================================================
-- add_assigned_tasks_column.sql
-- Phase 10.0 — Task Allocation ("Today's Required Tasks").
-- Adds one nullable column to Job holding the serialized list of
-- predefined task identifiers chosen by the parent at booking time.
-- Idempotent: safe to run multiple times on the same database.
-- Only ADDS a column. Does NOT drop, rename, or alter any existing column.
-- Schema managed outside the EDMX (accessed via raw SQL in the service layer),
-- identical pattern to docs/database/add_geo_columns.sql (Job.Latitude/Longitude).
--
-- Stored representation: NVARCHAR(MAX) JSON array of stable ids, e.g.
--   ["bottle-feeding","diaper-change"]
-- NULL  = historical job created before this feature (renders as no tasks).
-- ===================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name='AssignedTasks' AND Object_ID=OBJECT_ID('Job'))
    ALTER TABLE Job ADD AssignedTasks NVARCHAR(MAX) NULL;
GO