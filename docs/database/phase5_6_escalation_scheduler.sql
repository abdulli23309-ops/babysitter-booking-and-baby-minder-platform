/*
    LITTLE CARE — PHASE 5 + 6
    Escalation Scheduler (SQL Server Agent) — OPERATIONAL REFERENCE SCRIPT

    STATUS OF THIS SCRIPT: DOCUMENTATION ONLY. IT WAS NEVER EXECUTED AND SQL
    AGENT WAS NOT TESTED in this development environment. It is committed so a
    deployment team has the exact configuration to apply — nothing in the
    codebase depends on it.

    WHY IT IS NOT PART OF THE APPLICATION
    Escalation state is PERSISTED in the database (CryAlert.EscalationStage +
    CryAlert.NextEscalationDueAt). No application timer, thread or MemoryCache
    job exists, so an AppPool recycle / IIS restart / app restart cannot lose a
    pending T+5 or T+15 step. Something merely has to ASK the database for work
    that is due — that "something" is a scheduler, and it is replaceable.

    TWO SUPPORTED SCHEDULERS (either one is enough):

    A) SQL Server Agent (primary, production)
       Minute job that calls the operations endpoint through HTTPS and passes
       the shared key from Web.config (MonitoringOpsSweepKey):

           curl -s -X POST "https://<host>/api/monitoring/ops/sweep?max=50" ^
                -H "X-Ops-Sweep-Key: <MonitoringOpsSweepKey value>"

       or with PowerShell:
           Invoke-RestMethod -Method Post -Uri "https://<host>/api/monitoring/ops/sweep" `
               -Headers @{ "X-Ops-Sweep-Key" = "<key>" }

    B) Sweep-on-poll (fallback, zero infrastructure)
       Every authorized monitoring GET (api/monitoring/session, api/monitoring/cry)
       also processes the due escalations of that session. As long as a
       monitoring page is open and polling, the T+5 / T+15 steps happen even
       with no scheduler at all. The polling client therefore drives its own
       escalation as a side effect of normal use.

    HONEST TIMING STATEMENT (do not claim exact seconds)
    A job that runs every minute cannot fire exactly at T+5.0 or T+15.0.
    Example: expected T+5, actual T+5.8 — that is NORMAL and ACCEPTABLE.
    The authoritative deadline is NextEscalationDueAt, and "due" only means
    "not yet processed", so a late run catches up on the next tick. The
    implementation deliberately does not fake second-level precision.

    IDEMPOTENCY / DUPLICATE SAFETY
    The claim itself is atomic (UPDLOCK + READPAST, stage and due time advanced
    in the same UPDATE) and each stage's notification is guarded by its
    MonitorEvent audit row. Running the job twice, or running it while a
    monitoring client is also polling, therefore cannot double-notify.

    DEVELOPMENT ENVIRONMENT FACTS (recorded honestly)
    - Edition: SQL Server Express Edition (64-bit), version 17.0.1135.8.
    - Service "SQLAgent$SQLEXPRESS" exists but is STOPPED and DISABLED, and
      scheduled Agent jobs are not a supported Express Edition feature.
    - Therefore the Phase 5/6 verification relied on the ops endpoint and the
      sweep-on-poll fallback. Configuring SQL Agent stays an operational
      deployment task (SQL Server Standard/Enterprise, or any external
      scheduler such as Windows Task Scheduler / cron / a CI pipeline).

    ---------------------------------------------------------------------------
    REFERENCE: SQL Server Agent job definition (run with sqlcmd -i, only on a
    server that has Agent; replace <host> and the key; NOT executed here).
    ---------------------------------------------------------------------------

    USE msdb;
    GO
    -- 1) Create the job
    EXEC dbo.sp_add_job
         @job_name = N'LittleCare_CryEscalationSweep',
         @enabled  = 1,
         @description = N'Claims and processes due cry escalations (Phase 5/6).';
    GO
    -- 2) One step: call the operations endpoint (PowerShell step type)
    EXEC dbo.sp_add_jobstep
         @job_name   = N'LittleCare_CryEscalationSweep',
         @step_id    = 1,
         @step_name  = N'Sweep due escalations',
         @subsystem  = N'PowerShell',
         @command    = N'Invoke-RestMethod -Method Post -Uri "https://<host>/api/monitoring/ops/sweep?max=50" -Headers @{ "X-Ops-Sweep-Key" = "<MonitoringOpsSweepKey>" }',
         @on_success_action = 1,   -- quit with success
         @on_fail_action    = 2;   -- quit with failure
    GO
    -- 3) Schedule it every minute
    EXEC dbo.sp_add_schedule
         @schedule_name = N'EveryMinute',
         @freq_type     = 4,       -- daily
         @freq_interval = 1,
         @freq_subday_type = 4,    -- minutes
         @freq_subday_interval = 1,
         @active_start_time = 0;
    GO
    EXEC dbo.sp_attach_schedule
         @job_name = N'LittleCare_CryEscalationSweep',
         @schedule_name = N'EveryMinute';
    GO
    EXEC dbo.sp_add_jobserver
         @job_name = N'LittleCare_CryEscalationSweep',
         @server_name = N'(LOCAL)';
    GO

    ---------------------------------------------------------------------------
    USEFUL OPERATIONAL QUERIES
    ---------------------------------------------------------------------------
    -- Pending escalations (the "due work" the scheduler looks for)
    SELECT Id, JobId, Child_ID, MonitorSession_ID, Status, EscalationStage,
           NextEscalationDueAt, DATEDIFF(SECOND, NextEscalationDueAt, GETUTCDATE()) AS SecondsLate
    FROM dbo.CryAlert
    WHERE IsDeleted = 0
      AND Status IN ('Open','Acknowledged')
      AND NextEscalationDueAt IS NOT NULL
      AND NextEscalationDueAt <= GETUTCDATE()
    ORDER BY NextEscalationDueAt;

    -- Incident timeline for one child
    SELECT Status, EscalationStage, CreatedAt, NextEscalationDueAt, SitterResponse,
           RespondedAt, ResolvedAtUtc, CancelledAtUtc, CancellationReason
    FROM dbo.CryAlert
    WHERE JobId = 171 AND Child_ID = 27
    ORDER BY CreatedAt DESC;

    -- Escalation audit trail
    SELECT EventType, ActorUserId, ActorRole, AtUtc, PayloadJson
    FROM dbo.MonitorEvent
    WHERE IncidentId = '<incident guid>'
    ORDER BY AtUtc;
*/
