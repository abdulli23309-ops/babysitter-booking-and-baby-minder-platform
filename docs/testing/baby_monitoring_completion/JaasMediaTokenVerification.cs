// Offline regression for the JaaS signer and PEM readers. It generates only
// throwaway keys and never reads or prints the developer's configured key.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Diagnostics;
using Newtonsoft.Json.Linq;
using WebApplication2.Services.Implementations;

internal static class JaasMediaTokenVerification
{
    private static int passed;
    private static int failed;
    private const string AppId = "vpaas-magic-cookie-a60732c436244ceb82319194c84f2443";
    private const string Kid = AppId + "/d2feb3";

    private static void Check(string name, bool result)
    {
        if (result) passed++; else failed++;
        Console.WriteLine("{0} {1}", result ? "PASS" : "FAIL", name);
    }

    private static byte[] Tlv(byte tag, byte[] content)
    {
        var result = new List<byte> { tag };
        int length = content.Length;
        if (length < 128) result.Add((byte)length);
        else
        {
            var bytes = new List<byte>();
            while (length > 0) { bytes.Insert(0, (byte)(length & 255)); length >>= 8; }
            result.Add((byte)(0x80 | bytes.Count)); result.AddRange(bytes);
        }
        result.AddRange(content);
        return result.ToArray();
    }

    private static byte[] Integer(byte[] value)
    {
        int first = 0;
        while (first < value.Length - 1 && value[first] == 0) first++;
        var unsigned = value.Skip(first).ToArray();
        if ((unsigned[0] & 0x80) != 0) unsigned = new byte[] { 0 }.Concat(unsigned).ToArray();
        return Tlv(0x02, unsigned);
    }

    private static byte[] Sequence(params byte[][] values)
    {
        return Tlv(0x30, values.SelectMany(x => x).ToArray());
    }

    private static byte[] Pkcs1(RSAParameters p)
    {
        return Sequence(Integer(new byte[] { 0 }), Integer(p.Modulus), Integer(p.Exponent),
            Integer(p.D), Integer(p.P), Integer(p.Q), Integer(p.DP), Integer(p.DQ), Integer(p.InverseQ));
    }

    private static string Pem(string label, byte[] der)
    {
        string base64 = Convert.ToBase64String(der);
        var lines = Enumerable.Range(0, (base64.Length + 63) / 64)
            .Select(i => base64.Substring(i * 64, Math.Min(64, base64.Length - i * 64)));
        return "-----BEGIN " + label + "-----\n" + string.Join("\n", lines) +
            "\n-----END " + label + "-----";
    }

    private static byte[] FromBase64Url(string text)
    {
        string padded = text.Replace('-', '+').Replace('_', '/');
        while (padded.Length % 4 != 0) padded += "=";
        return Convert.FromBase64String(padded);
    }

    private static void VerifyKeyAndToken(string label, string key, RSAParameters publicKey)
    {
        var parse = typeof(MediaSessionService).GetMethod("TryReadPrivateKey", BindingFlags.NonPublic | BindingFlags.Static);
        object[] args = { key, null };
        bool parsed = (bool)parse.Invoke(null, args);
        Check(label + " PEM parses", parsed);
        if (!parsed) return;

        var getLogicalRoom = typeof(MediaSessionService).GetMethod("GetLogicalRoomName", BindingFlags.NonPublic | BindingFlags.Static);
        string logicalRoom = (string)getLogicalRoom.Invoke(null, new object[] { AppId + "/lc-monitor-42" });
        Check(label + " logical room excludes AppID and remains single-level",
            logicalRoom == "lc-monitor-42" && !logicalRoom.Contains("/"));

        var build = typeof(MediaSessionService).GetMethod("BuildToken", BindingFlags.NonPublic | BindingFlags.Static);
        string token = (string)build.Invoke(null, new object[] {
            logicalRoom, "Parent \"One\"", true, 123, AppId, Kid, key });
        Check(label + " produces a token", !String.IsNullOrWhiteSpace(token));
        if (String.IsNullOrWhiteSpace(token)) return;

        string[] pieces = token.Split('.');
        var header = JObject.Parse(Encoding.UTF8.GetString(FromBase64Url(pieces[0])));
        var payload = JObject.Parse(Encoding.UTF8.GetString(FromBase64Url(pieces[1])));
        using (var rsa = new RSACryptoServiceProvider())
        {
            rsa.ImportParameters(publicKey);
            bool validSignature = rsa.VerifyData(Encoding.UTF8.GetBytes(pieces[0] + "." + pieces[1]),
                CryptoConfig.MapNameToOID("SHA256"), FromBase64Url(pieces[2]));
            Check(label + " signature verifies as RSA SHA-256", validSignature);
        }
        Check(label + " JaaS header alg/typ/kid", (string)header["alg"] == "RS256" &&
            (string)header["typ"] == "JWT" && (string)header["kid"] == Kid);
        Check(label + " JaaS claims and logical room", (string)payload["aud"] == "jitsi" &&
            (string)payload["iss"] == "chat" && (string)payload["sub"] == AppId &&
            (string)payload["room"] == logicalRoom);
        Check(label + " stable identity, escaped display name, and moderator role",
            (string)payload["context"]["user"]["id"] == "123" &&
            (string)payload["context"]["user"]["name"] == "Parent \"One\"" &&
            (string)payload["context"]["user"]["moderator"] == "true");
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        Check(label + " nbf and one-hour expiry", (long)payload["nbf"] <= now &&
            (long)payload["exp"] > now && (long)payload["exp"] - (long)payload["nbf"] == 3600);

        string viewerToken = (string)build.Invoke(null, new object[] {
            logicalRoom, "Babysitter", false, 456, AppId, Kid, key });
        var viewerPayload = JObject.Parse(Encoding.UTF8.GetString(FromBase64Url(viewerToken.Split('.')[1])));
        Check(label + " sitter token has same room and moderator disabled",
            (string)viewerPayload["room"] == (string)payload["room"] &&
            (string)viewerPayload["context"]["user"]["moderator"] == "false" &&
            (string)viewerPayload["context"]["user"]["id"] == "456");
    }

    public static int Main()
    {
        Trace.Listeners.Add(new TextWriterTraceListener(Console.Out));
        Trace.AutoFlush = true;
        using (var rsa = new RSACryptoServiceProvider(2048))
        {
            RSAParameters parameters = rsa.ExportParameters(true);
            byte[] pkcs1 = Pkcs1(parameters);
            byte[] algorithm = Sequence(Tlv(0x06, new byte[] { 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01 }), Tlv(0x05, new byte[0]));
            byte[] pkcs8 = Sequence(Integer(new byte[] { 0 }), algorithm, Tlv(0x04, pkcs1));
            VerifyKeyAndToken("PKCS#1", Pem("RSA PRIVATE KEY", pkcs1), rsa.ExportParameters(false));
            VerifyKeyAndToken("PKCS#8", Pem("PRIVATE KEY", pkcs8), rsa.ExportParameters(false));
            var parse = typeof(MediaSessionService).GetMethod("TryReadPrivateKey", BindingFlags.NonPublic | BindingFlags.Static);
            object[] invalid = { "not-a-private-key", null };
            Check("invalid key fails closed", !(bool)parse.Invoke(null, invalid));
            var build = typeof(MediaSessionService).GetMethod("BuildToken", BindingFlags.NonPublic | BindingFlags.Static);
            Check("invalid key issues no token", build.Invoke(null, new object[] {
                AppId + "/lc-monitor-42", "Parent", true, 123, AppId, Kid, "not-a-private-key" }) == null);
        }
        Console.WriteLine("RESULT: {0} passed, {1} failed", passed, failed);
        return failed == 0 ? 0 : 1;
    }
}
