using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Threading;
using System.Web;
using System.Web.Http;
using System.Web.Http.Controllers;
using WebApplication2.Enums;
using WebApplication2.Models;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Database-backed opaque token authorization filter.
    /// Validates the Authorization: Bearer {token} header against the UserSessions table,
    /// verifies that the session has not expired (ExpiresAt > DateTime.UtcNow),
    /// and establishes a ClaimsPrincipal across HttpContext, Thread, and RequestContext.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, Inherited = true, AllowMultiple = true)]
    public class SessionAuthorizeAttribute : AuthorizeAttribute
    {
        public new string Roles { get; set; }

        public override void OnAuthorization(HttpActionContext actionContext)
        {
            if (actionContext == null)
            {
                throw new ArgumentNullException(nameof(actionContext));
            }

            // Honor [AllowAnonymous] on either action or controller
            if (actionContext.ActionDescriptor.GetCustomAttributes<AllowAnonymousAttribute>().Any() ||
                actionContext.ControllerContext.ControllerDescriptor.GetCustomAttributes<AllowAnonymousAttribute>().Any())
            {
                return;
            }

            var authHeader = actionContext.Request.Headers.Authorization;
            if (authHeader == null ||
                !string.Equals(authHeader.Scheme, "Bearer", StringComparison.OrdinalIgnoreCase) ||
                string.IsNullOrWhiteSpace(authHeader.Parameter))
            {
                actionContext.Response = actionContext.Request.CreateResponse(
                    HttpStatusCode.Unauthorized,
                    new { message = "Missing or invalid Authorization header." });
                return;
            }

            string token = authHeader.Parameter.Trim();

            try
            {
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    var now = DateTime.UtcNow;
                    var session = db.Database.SqlQuery<UserSession>(
                        "SELECT Token, UserId, Role, CreatedAt, ExpiresAt FROM UserSessions WHERE Token = @p0",
                        token
                    ).FirstOrDefault();

                    if (session == null || session.ExpiresAt <= now)
                    {
                        actionContext.Response = CreateJsonResponse(
                            actionContext.Request,
                            HttpStatusCode.Unauthorized,
                            new { message = "Invalid or expired session token." });
                        return;
                    }

                    // B6: Verify associated account still exists and IsDeleted == false
                    bool isAccountActive = false;
                    if (string.Equals(session.Role, UserRole.Parent.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                    {
                        isAccountActive = db.Parents.Any(p => p.Parent_ID == session.UserId && !p.IsDeleted);
                    }
                    else if (string.Equals(session.Role, UserRole.Sitter.ToDisplayString(), StringComparison.OrdinalIgnoreCase))
                    {
                        isAccountActive = db.Babysitters.Any(b => b.Sitter_ID == session.UserId && !b.IsDeleted);
                    }

                    if (!isAccountActive)
                    {
                        // Clean up stale session for deleted/deactivated account
                        db.Database.ExecuteSqlCommand(
                            "DELETE FROM UserSessions WHERE Token = @p0 OR (UserId = @p1 AND Role = @p2)",
                            token, session.UserId, session.Role);

                        actionContext.Response = CreateJsonResponse(
                            actionContext.Request,
                            HttpStatusCode.Unauthorized,
                            new { message = "Account has been deactivated or deleted." });
                        return;
                    }

                    // Enforce role restriction if specified
                    if (!string.IsNullOrWhiteSpace(Roles))
                    {
                        var allowedRoles = Roles.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                                                .Select(r => r.Trim())
                                                .ToList();
                        if (!allowedRoles.Any(r => string.Equals(r, session.Role, StringComparison.OrdinalIgnoreCase)))
                        {
                            actionContext.Response = CreateJsonResponse(
                                actionContext.Request,
                                HttpStatusCode.Forbidden,
                                new { message = "Access denied: insufficient role privileges." });
                            return;
                        }
                    }

                    // Populate ClaimsPrincipal
                    var claims = new[]
                    {
                        new Claim(ClaimTypes.NameIdentifier, session.UserId.ToString()),
                        new Claim(ClaimTypes.Role, session.Role),
                        new Claim("Token", session.Token)
                    };

                    var identity = new ClaimsIdentity(claims, "Session");
                    var principal = new ClaimsPrincipal(identity);

                    if (HttpContext.Current != null)
                    {
                        HttpContext.Current.User = principal;
                    }
                    Thread.CurrentPrincipal = principal;

                    if (actionContext.RequestContext != null)
                    {
                        actionContext.RequestContext.Principal = principal;
                    }

                    // Custom context on Request.Properties to prevent IDOR in controllers
                    actionContext.Request.Properties["UserSession"] = session;
                    actionContext.Request.Properties["UserId"] = session.UserId;
                    actionContext.Request.Properties["Role"] = session.Role;
                    actionContext.Request.Properties["MS_UserPrincipal"] = principal;
                }
            }
            catch (Exception ex)
            {
                actionContext.Response = CreateJsonResponse(
                    actionContext.Request,
                    HttpStatusCode.InternalServerError,
                    new { message = "Session validation failed: " + ex.Message });
            }
        }

        private static HttpResponseMessage CreateJsonResponse(HttpRequestMessage request, HttpStatusCode statusCode, object data)
        {
            var config = request.GetConfiguration();
            if (config != null)
            {
                return request.CreateResponse(statusCode, data);
            }
            return new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(
                    Newtonsoft.Json.JsonConvert.SerializeObject(data),
                    System.Text.Encoding.UTF8,
                    "application/json"
                )
            };
        }
    }
}
