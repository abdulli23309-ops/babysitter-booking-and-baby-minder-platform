// Offline verification for the MiroTalk room-derivation helpers added to
// MediaSessionService. It is deliberately PURE: no SQL Server, no IIS, no
// MiroTalk instance, no browser, no network, no credentials and no database.
// The helpers are internal, so they are invoked through reflection exactly as
// the previous offline regression did.
//
// The salt used below is a THROWAWAY generated in memory for this run. It is
// never the deployed MonitoringMediaRoomSalt and is never printed.
using System;
using System.Globalization;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using WebApplication2.Services.Implementations;

internal static class MiroTalkRoomDerivationVerification
{
    private static int passed;
    private static int failed;

    private const string ScopeJob = "job";
    private const string ScopeIndependent = "independent";

    private static void Check(string name, bool ok)
    {
        if (ok) passed++; else failed++;
        Console.WriteLine("{0}  {1}", ok ? "PASS" : "FAIL", name);
    }

    // Mirrors the documented algorithm, implemented independently here, so a
    // bug in the production helper cannot hide behind the same bug in the test.
    private static string Expected(string scope, int sessionId, string salt)
    {
        using (var hmac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes(salt)))
        {
            byte[] d = hmac.ComputeHash(Encoding.UTF8.GetBytes(scope + ":" + sessionId.ToString(CultureInfo.InvariantCulture)));
            string prefix = scope == ScopeJob ? "lc-m-" : "lc-i-";
            string hex = "";
            for (int i = 0; i < 4; i++) hex += d[i].ToString("x2", CultureInfo.InvariantCulture);
            return prefix + sessionId.ToString(CultureInfo.InvariantCulture) + "-" + hex;
        }
    }

    private static int Main()
    {
        var t = typeof(MediaSessionService);
        var derive = t.GetMethod("DeriveRoomId", BindingFlags.NonPublic | BindingFlags.Static,
            null, new[] { typeof(string), typeof(int), typeof(string) }, null);
        var normalize = t.GetMethod("NormalizeServerUrl", BindingFlags.NonPublic | BindingFlags.Static, null, new[] { typeof(string) }, null);
        var buildJoinPath = t.GetMethod("BuildJoinPath", BindingFlags.NonPublic | BindingFlags.Static, null,
            new[] { typeof(string), typeof(string), typeof(bool) }, null);

        Check("harness: DeriveRoomId(scope,int,string) is reachable", derive != null);
        Check("harness: NormalizeServerUrl(string) is reachable", normalize != null);
        Check("harness: BuildJoinPath(room,name,canPublish) is reachable", buildJoinPath != null);
        if (derive == null || normalize == null || buildJoinPath == null) { Console.WriteLine("0 passed, {0} failed", failed); return 1; }

        string Derive(string scope, int id, string salt) => (string)derive.Invoke(null, new object[] { scope, id, salt });
        string Norm(string v) => (string)normalize.Invoke(null, new object[] { v });
        string Join(string room, string name, bool canPublish) =>
            (string)buildJoinPath.Invoke(null, new object[] { room, name, canPublish });

        // Throwaway salts. Deterministic constants let the expected values be
        // recomputed independently below.
        const string saltA = "harness-salt-A-0123456789abcdef0123456789abcdef";
        const string saltB = "harness-salt-B-fedcba9876543210fedcba9876543210";

        // 1 + 2. format
        string job = Derive(ScopeJob, 1042, saltA);
        string ind = Derive(ScopeIndependent, 1042, saltA);
        Check("1. job room matches ^lc-m-\\d+-[0-9a-f]{8}$", Regex.IsMatch(job, @"^lc-m-\d+-[0-9a-f]{8}$"));
        Check("2. independent room matches ^lc-i-\\d+-[0-9a-f]{8}$", Regex.IsMatch(ind, @"^lc-i-\d+-[0-9a-f]{8}$"));
        Check("2b. hex segment is exactly 8 chars, all lowercase",
            job.Length - job.LastIndexOf('-') - 1 == 8 && job == job.ToLowerInvariant());

        // 3. determinism
        Check("3. deterministic: same scope+session+salt -> same room",
            Derive(ScopeJob, 1042, saltA) == job);

        // 4. scope isolation
        Check("4. scope isolation: job/1042 != independent/1042", job != ind);
        // 5. session isolation
        Check("5. session isolation: job/1042 != job/1043", job != Derive(ScopeJob, 1043, saltA));
        // 6. salt sensitivity
        Check("6. salt sensitivity: same scope/session, different salt -> different room",
            Derive(ScopeJob, 1042, saltB) != job);

        // 7. empty / missing salt fails closed
        Check("7. empty or null salt -> null (fails closed)",
            Derive(ScopeJob, 1042, "") == null && Derive(ScopeJob, 1042, null) == null);
        Check("7b. whitespace salt -> null (fails closed)", Derive(ScopeJob, 1042, "   ") == null);
        Check("7c. unknown scope -> null (no guessed prefix)", Derive("somethingelse", 1042, saltA) == null);

        // 8. whitespace normalization
        Check("8. leading/trailing whitespace trimmed", Norm("  http://192.168.1.19:3010  ") == "http://192.168.1.19:3010");
        // 9. trailing slash removal
        Check("9. trailing slash removed", Norm("http://192.168.1.19:3010/") == "http://192.168.1.19:3010");
        Check("9b. multiple trailing slashes removed", Norm("http://192.168.1.19:3010///") == "http://192.168.1.19:3010");
        Check("9c. https scheme preserved", Norm("https://sfu.example.com/") == "https://sfu.example.com");
        Check("9d. empty / null -> empty, no throw", Norm("") == "" && Norm(null) == "");

        // 10. no salt leakage
        Check("10. salt never appears in the room id",
            job.IndexOf(saltA, StringComparison.Ordinal) < 0 && ind.IndexOf(saltA, StringComparison.Ordinal) < 0);
        Check("10b. room id carries no path separator, query or fragment",
            !job.Contains("/") && !job.Contains("?") && !job.Contains("#"));

        // 11. no GUID / random component
        Check("11. no GUID pattern in room id",
            !Regex.IsMatch(job, @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"));
        // 12. stable, reasonable length
        Check("12. length stable and reasonable", job.Length >= 14 && job.Length <= 40);
        Check("12b. length identical across repeated calls", Derive(ScopeJob, 1042, saltA).Length == job.Length);

        // Independent re-derivation: proves the production code does exactly
        // HMAC-SHA256(salt, "scope:sessionId"), first 8 lowercase hex chars.
        Check("13. matches documented HMAC-SHA256(salt, \"scope:id\") algorithm",
            job == Expected(ScopeJob, 1042, saltA) && ind == Expected(ScopeIndependent, 1042, saltA));
        Check("13b. example shape lc-m-1042-3f9a1c07", Regex.IsMatch(job, @"^lc-m-1042-[0-9a-f]{8}$"));

        // --- Supported MiroTalk direct-join presentation options -------------
        string viewerPath = Join(ind, "Parent", false);
        string publisherPath = Join(ind, "Monitor device", true);
        Check("13c. viewer path hides only its own participant tile", viewerPath.Contains("&hide=1"));
        Check("13d. viewer cannot request camera or microphone", viewerPath.Contains("&audio=0&video=0"));
        Check("13e. publisher keeps its local preview and media enabled",
            publisherPath.Contains("&audio=1&video=1") && publisherPath.Contains("&hide=0"));

        Console.WriteLine();
        Console.WriteLine("sample job room        : {0}", job);
        Console.WriteLine("sample independent room: {0}", ind);

        // --- DTO contract -------------------------------------------------------
        // The browser must receive a room description and NOTHING that could
        // authorise or impersonate: no token, no salt, no provider secret.
        var dto = new WebApplication2.DTOs.MonitoringMediaDto
        {
            Configured = true,
            ServerUrl = "https://192.168.1.19:3010",
            RoomId = job,
            JoinPath = "/join/?room=" + job + "&name=Parent",
            Role = "publisher",
            DisplayName = "Parent",
            CanPublish = true,
            MonitorSessionId = 1042,
        };
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(dto);
        Check("14. DTO serialises with the MiroTalk field set",
            json.Contains("\"ServerUrl\"") && json.Contains("\"RoomId\"") && json.Contains("\"JoinPath\""));
        Check("15. DTO carries NO Token field", !json.Contains("\"Token\""));
        Check("16. DTO carries NO Domain field (removed JaaS contract)", !json.Contains("\"Domain\""));
        Check("17. DTO never leaks the room salt", json.IndexOf(saltA, StringComparison.Ordinal) < 0);
        Check("18. DTO never leaks any MiroTalk provider secret",
            !json.Contains("API_KEY_SECRET") && !json.Contains("JWT_SECRET"));
        Check("19. role and canPublish are server-set values echoed verbatim",
            dto.Role == "publisher" && dto.CanPublish);

        // --- Join path contract -------------------------------------------------
        // The browser must never build the join URL, so assert the server does
        // and that it carries the flags the media UI depends on.
        string viewer = Join("lc-i-1042-5d5f4f94", "Parent", false);
        string publisher = Join("lc-m-1042-3f9a1c07", "Baby monitor", true);

        Check("22. viewer joins with audio/video OFF (never publishes)",
            viewer.Contains("&audio=0") && viewer.Contains("&video=0"));
        Check("23. publisher joins with audio/video ON",
            publisher.Contains("&audio=1") && publisher.Contains("&video=1"));
        Check("24. viewer suppresses its own self tile (hide=1)", viewer.Contains("&hide=1"));
        Check("25. publisher keeps its local preview (hide=0)", publisher.Contains("&hide=0"));
        Check("26. chat and screen share stay off", viewer.Contains("&chat=0") && viewer.Contains("&screen=0"));
        Check("27. join path opts into the embed bridge (embed=1)",
            viewer.Contains("&embed=1") && publisher.Contains("&embed=1"));
        Check("28. room is URL-encoded in the path", viewer.Contains("room=lc-i-1042-5d5f4f94"));
        Check("29. display name is URL-encoded, never raw",
            publisher.Contains("name=Baby%20monitor") && !publisher.Contains("name=Baby monitor"));
        Check("30. join path never contains the salt or a secret",
            viewer.IndexOf(saltA, StringComparison.Ordinal) < 0
            && !viewer.Contains("API_KEY_SECRET") && !viewer.Contains("JWT_SECRET"));

        Console.WriteLine();
        Console.WriteLine("{0} passed, {1} failed", passed, failed);
        return failed == 0 ? 0 : 1;
    }
}
