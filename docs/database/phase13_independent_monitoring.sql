/*
   Phase 13: isolated Phone-2 independent monitoring foundation.
   Additive/idempotent. Existing job MonitorSession and authorization remain untouched.
   Pairing values and device credentials are stored only as SHA-256 hashes.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.IndependentMonitoringSession','U') IS NULL
    BEGIN
        CREATE TABLE dbo.IndependentMonitoringSession (
            IndependentMonitoringSession_ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IndependentMonitoringSession PRIMARY KEY,
            Parent_ID INT NOT NULL,
            Child_ID INT NOT NULL,
            RoomName NVARCHAR(100) NOT NULL,
            Status NVARCHAR(20) NOT NULL CONSTRAINT DF_IndependentMonitoringSession_Status DEFAULT ('Active'),
            StartedAtUtc DATETIME NOT NULL,
            EndedAtUtc DATETIME NULL,
            LastDeviceSeenAtUtc DATETIME NULL,
            IsDeleted BIT NOT NULL CONSTRAINT DF_IndependentMonitoringSession_IsDeleted DEFAULT (0),
            CONSTRAINT FK_IndependentMonitoringSession_Parent FOREIGN KEY (Parent_ID) REFERENCES dbo.Parent(Parent_ID),
            CONSTRAINT FK_IndependentMonitoringSession_Child FOREIGN KEY (Child_ID) REFERENCES dbo.Child(Child_ID),
            CONSTRAINT CK_IndependentMonitoringSession_Status CHECK (Status IN ('Active','Ended'))
        );
    END;

    IF OBJECT_ID('dbo.MonitoringPairingCode','U') IS NULL
    BEGIN
        CREATE TABLE dbo.MonitoringPairingCode (
            MonitoringPairingCode_ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MonitoringPairingCode PRIMARY KEY,
            Parent_ID INT NOT NULL,
            Child_ID INT NOT NULL,
            CodeHash CHAR(64) NOT NULL,
            CreatedAtUtc DATETIME NOT NULL,
            ExpiresAtUtc DATETIME NOT NULL,
            RedeemedAtUtc DATETIME NULL,
            IsRevoked BIT NOT NULL CONSTRAINT DF_MonitoringPairingCode_IsRevoked DEFAULT (0),
            CONSTRAINT FK_MonitoringPairingCode_Parent FOREIGN KEY (Parent_ID) REFERENCES dbo.Parent(Parent_ID),
            CONSTRAINT FK_MonitoringPairingCode_Child FOREIGN KEY (Child_ID) REFERENCES dbo.Child(Child_ID)
        );
    END;

    IF OBJECT_ID('dbo.MonitoringDeviceSession','U') IS NULL
    BEGIN
        CREATE TABLE dbo.MonitoringDeviceSession (
            MonitoringDeviceSession_ID INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_MonitoringDeviceSession PRIMARY KEY,
            IndependentMonitoringSession_ID INT NOT NULL,
            CredentialHash CHAR(64) NOT NULL,
            CreatedAtUtc DATETIME NOT NULL,
            ExpiresAtUtc DATETIME NOT NULL,
            RevokedAtUtc DATETIME NULL,
            LastSeenAtUtc DATETIME NULL,
            CONSTRAINT FK_MonitoringDeviceSession_IndependentSession FOREIGN KEY (IndependentMonitoringSession_ID)
                REFERENCES dbo.IndependentMonitoringSession(IndependentMonitoringSession_ID)
        );
    END;

    IF OBJECT_ID('dbo.IndependentCryEvent','U') IS NULL
    BEGIN
        CREATE TABLE dbo.IndependentCryEvent (
            IndependentCryEvent_ID BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_IndependentCryEvent PRIMARY KEY,
            IndependentMonitoringSession_ID INT NOT NULL,
            Parent_ID INT NOT NULL,
            Child_ID INT NOT NULL,
            DetectedAtUtc DATETIME NOT NULL,
            ResolvedAtUtc DATETIME NULL,
            CONSTRAINT FK_IndependentCryEvent_Session FOREIGN KEY (IndependentMonitoringSession_ID)
                REFERENCES dbo.IndependentMonitoringSession(IndependentMonitoringSession_ID),
            CONSTRAINT FK_IndependentCryEvent_Parent FOREIGN KEY (Parent_ID) REFERENCES dbo.Parent(Parent_ID),
            CONSTRAINT FK_IndependentCryEvent_Child FOREIGN KEY (Child_ID) REFERENCES dbo.Child(Child_ID)
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.IndependentMonitoringSession') AND name='UX_IndependentMonitoringSession_ActiveParent')
        CREATE UNIQUE INDEX UX_IndependentMonitoringSession_ActiveParent ON dbo.IndependentMonitoringSession(Parent_ID) WHERE Status='Active' AND IsDeleted=0;
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.MonitoringPairingCode') AND name='UX_MonitoringPairingCode_CodeHash')
        CREATE UNIQUE INDEX UX_MonitoringPairingCode_CodeHash ON dbo.MonitoringPairingCode(CodeHash);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.MonitoringPairingCode') AND name='IX_MonitoringPairingCode_Parent_Expiry')
        CREATE INDEX IX_MonitoringPairingCode_Parent_Expiry ON dbo.MonitoringPairingCode(Parent_ID, ExpiresAtUtc);

    /* Brute-force protection. A pairing code is 10 chars from a 32-char
       alphabet (~50 bits) and lives 5 minutes, so online guessing is already
       impractical; this counter adds a hard lockout so a leaked/observed code
       cannot be brute-forced locally either. */
    IF COL_LENGTH('dbo.MonitoringPairingCode','AttemptCount') IS NULL
        ALTER TABLE dbo.MonitoringPairingCode ADD AttemptCount INT NOT NULL CONSTRAINT DF_MonitoringPairingCode_AttemptCount DEFAULT (0);

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.MonitoringDeviceSession') AND name='UX_MonitoringDeviceSession_CredentialHash')
        CREATE UNIQUE INDEX UX_MonitoringDeviceSession_CredentialHash ON dbo.MonitoringDeviceSession(CredentialHash);
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.IndependentCryEvent') AND name='IX_IndependentCryEvent_Session_Open')
        CREATE UNIQUE INDEX IX_IndependentCryEvent_Session_Open ON dbo.IndependentCryEvent(IndependentMonitoringSession_ID) WHERE ResolvedAtUtc IS NULL;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

/*
   IndependentCryEvent is the independent-context incident store. The legacy
   CryAlert incident engine is job-scoped and schedules sitter escalation; using
   it here would couple this flow to sitter delivery. Parent notifications are
   surfaced by the authenticated polling API, and no sitter route can read these rows.
*/
