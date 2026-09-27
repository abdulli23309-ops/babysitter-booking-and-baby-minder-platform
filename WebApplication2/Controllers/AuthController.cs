using System;
using System.Linq;
using System.Net;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Models;

namespace WebApplication2.Controllers
{
    /// <summary>
    /// Provides authentication endpoints. Session-verification actions are
    /// protected by [SessionAuthorize]; requests without a valid Bearer
    /// session token receive 401. POST login is the single unified,
    /// anonymous sign-in action and auto-detects the account role, so the
    /// client never has to choose or send a role.
    /// </summary>
    [SessionAuthorize]
    [RoutePrefix("api/auth")]
    // CORS (Phase 1 Fix C): intentionally NO per-controller [EnableCors] here.
    // A per-controller attribute would override the single global config-driven
    // policy in WebApiConfig.Register (Web.config key "AllowedCorsOrigins") —
    // that is exactly how wildcard ("*","*","*") CORS survived before Phase 1.
    public class AuthController : ApiController
    {
        /// <summary>
        /// Returns the authenticated principal's context. Used to verify the
        /// session authentication foundation and by the frontend to hydrate session state.
        /// </summary>
        /// <response code="200">Authenticated user context.</response>
        /// <response code="401">Missing/invalid/expired token.</response>
        [HttpGet]
        [Route("me")]
        public IHttpActionResult Me()
        {
            if (!ClaimsPrincipalHelper.IsAuthenticated())
            {
                return Unauthorized();
            }

            return Ok(new
            {
                userId = ClaimsPrincipalHelper.GetUserId(),
                role = ClaimsPrincipalHelper.GetRole(),
                name = ClaimsPrincipalHelper.GetName()
            });
        }

        /// <summary>
        /// API PURPOSE:
        /// Revokes the caller's server-side session (the UserSessions row behind
        /// the Bearer token) so the token dies immediately instead of staying
        /// valid for its full configured SessionExpiryDays lifetime.
        ///
        /// AUTHORIZATION:
        /// [SessionAuthorize] on the controller — only a holder of a valid token
        /// can revoke it; the token read here is the one from the request's
        /// Authorization header (never a client-supplied body field).
        ///
        /// LOGOUT FLOW:
        /// React logout action (AuthContext.logout)
        ///     ↓
        /// DELETE /api/auth/logout  (Bearer token attached by apiClient)
        ///     ↓
        /// Server deletes the UserSessions row → session revoked
        ///     ↓
        /// Frontend clears local authentication state (always, even on failure)
        ///     ↓
        /// User returned to /login
        ///
        /// SIDE EFFECT:
        /// Deleting the row makes every subsequent request with this token fail
        /// SessionAuthorize with 401, which is exactly the intent.
        ///
        /// FAILURE:
        /// Returns 200 even when no token was supplied (nothing to revoke) so
        /// the client can always complete its local cleanup.
        /// </summary>
        [HttpDelete]
        [Route("logout")]
        public IHttpActionResult Logout()
        {
            string token = null;
            var auth = Request.Headers.Authorization;
            if (auth != null && string.Equals(auth.Scheme, "Bearer", System.StringComparison.OrdinalIgnoreCase))
            {
                token = auth.Parameter;
            }

            if (!string.IsNullOrWhiteSpace(token))
            {
                using (var db = new Models.BabySitterBooking_and_BabyMinderEntities())
                {
                    db.Database.ExecuteSqlCommand("DELETE FROM UserSessions WHERE Token = @p0", token.Trim());
                }
            }

            return Ok(new { message = "Logged out successfully." });
        }

        /// <summary>
        /// Unified, anonymous sign-in. Locates the submitted username in the
        /// Parent table first, then the Babysitter table, verifies the password
        /// and returns the detected role together with a fresh session token.
        /// No Role field is required in the request body.
        /// </summary>
        /// <response code="200">Authenticated user context including detected role and token.</response>
        /// <response code="400">Username or password missing.</response>
        /// <response code="401">Unknown username, wrong password, or deactivated account.</response>
        [HttpPost]
        [AllowAnonymous]
        [Route("login")]
        public IHttpActionResult Login(WebApplication2.DTOs.LoginDTO dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Username)
                            || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest("Username and password are required.");

            using (var db = new Models.BabySitterBooking_and_BabyMinderEntities())
            {
                // 1. Try Parent first
                var parent = db.Parents.FirstOrDefault(p =>
                    p.Username == dto.Username);
                if (parent != null)
                {
                    if (parent.IsDeleted)
                        return Content(HttpStatusCode.Unauthorized,
                            "Account has been deactivated.");

                    var verify = PasswordHasher.VerifyPassword(
                        dto.Password, parent.Password);
                    if (!verify.IsValid)
                        return Content(HttpStatusCode.Unauthorized,
                            "Invalid credentials.");

                    if (verify.NeedsUpgrade)
                    {
                        string newHash = PasswordHasher.HashPassword(dto.Password);
                        PasswordHasher.UpgradePassword(db, parent.Parent_ID,
                            UserRole.Parent.ToDisplayString(), newHash);
                    }

                    var token = Guid.NewGuid().ToString("N")
                              + Guid.NewGuid().ToString("N");
                    var now = DateTime.UtcNow;
                    // SESSION EXPIRY (Phase 1 Fix F): session lifetime comes from
                    // the configured SessionExpiryDays (Web.config appSettings) via
                    // Infrastructure/SessionSettings.cs — never a hardcoded number.
                    // BUSINESS RULE: ExpiresAt = CreatedAt + configured days, and
                    // SessionAuthorizeAttribute rejects the token once ExpiresAt <= UtcNow.
                    int sessionExpiryDays = SessionSettings.GetSessionExpiryDays();
                    var exp = now.AddDays(sessionExpiryDays);
                    db.Database.ExecuteSqlCommand(
                        "INSERT INTO UserSessions " +
                        "(Token, UserId, Role, CreatedAt, ExpiresAt) " +
                        "VALUES (@p0, @p1, @p2, @p3, @p4)",
                        token, parent.Parent_ID,
                        UserRole.Parent.ToDisplayString(), now, exp);

                    return Ok(new
                    {
                        message = "Login Successful",
                        userId = parent.Parent_ID,
                        name = parent.FullName,
                        role = UserRole.Parent.ToDisplayString(),
                        address = parent.Address,
                        pictureAddress = parent.PictureAddress,
                        token = token,
                        expiresAt = exp.ToString("o")
                    });
                }

                // 2. Try Babysitter
                var sitter = db.Babysitters.FirstOrDefault(s =>
                    s.Username == dto.Username);
                if (sitter != null)
                {
                    if (sitter.IsDeleted)
                        return Content(HttpStatusCode.Unauthorized,
                            "Account has been deactivated.");

                    var verify = PasswordHasher.VerifyPassword(
                        dto.Password, sitter.Password);
                    if (!verify.IsValid)
                        return Content(HttpStatusCode.Unauthorized,
                            "Invalid credentials.");

                    if (verify.NeedsUpgrade)
                    {
                        string newHash = PasswordHasher.HashPassword(dto.Password);
                        PasswordHasher.UpgradePassword(db, sitter.Sitter_ID,
                            UserRole.Sitter.ToDisplayString(), newHash);
                    }

                    var token = Guid.NewGuid().ToString("N")
                              + Guid.NewGuid().ToString("N");
                    var now = DateTime.UtcNow;
                    // SESSION EXPIRY (Phase 1 Fix F): same configured lifetime as
                    // the parent login above — single source of truth in
                    // Infrastructure/SessionSettings.cs (Web.config SessionExpiryDays).
                    int sessionExpiryDays = SessionSettings.GetSessionExpiryDays();
                    var exp = now.AddDays(sessionExpiryDays);
                    db.Database.ExecuteSqlCommand(
                        "INSERT INTO UserSessions " +
                        "(Token, UserId, Role, CreatedAt, ExpiresAt) " +
                        "VALUES (@p0, @p1, @p2, @p3, @p4)",
                        token, sitter.Sitter_ID,
                        UserRole.Sitter.ToDisplayString(), now, exp);

                    return Ok(new
                    {
                        message = "Login Successful",
                        userId = sitter.Sitter_ID,
                        name = sitter.FullName,
                        role = UserRole.Sitter.ToDisplayString(),
                        token = token,
                        expiresAt = exp.ToString("o")
                    });
                }

                // 3. Not found in either table
                return Content(HttpStatusCode.Unauthorized,
                    "Invalid credentials.");
            }
        }
    }
}