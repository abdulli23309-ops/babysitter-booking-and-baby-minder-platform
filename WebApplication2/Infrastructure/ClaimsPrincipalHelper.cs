using System;
using System.Security.Claims;

namespace WebApplication2.Infrastructure
{
    /// <summary>
    /// Helper to extract authenticated user claims from the current principal.
    /// </summary>
    public static class ClaimsPrincipalHelper
    {
        public static int GetUserId()
        {
            var identity = GetIdentity();
            if (identity == null) return 0;
            var claim = identity.FindFirst(ClaimTypes.NameIdentifier);
            if (claim == null) return 0;
            return int.Parse(claim.Value);
        }

        public static string GetRole()
        {
            var identity = GetIdentity();
            if (identity == null) return null;
            return identity.FindFirst(ClaimTypes.Role)?.Value;
        }

        public static string GetName()
        {
            var identity = GetIdentity();
            if (identity == null) return null;
            return identity.FindFirst(ClaimTypes.Name)?.Value;
        }

        public static bool IsAuthenticated()
        {
            var identity = GetIdentity();
            return identity != null && identity.IsAuthenticated;
        }

        private static ClaimsIdentity GetIdentity()
        {
            var principal = System.Threading.Thread.CurrentPrincipal as ClaimsPrincipal;
            if (principal == null && System.Web.HttpContext.Current != null)
                principal = System.Web.HttpContext.Current.User as ClaimsPrincipal;
            return principal?.Identity as ClaimsIdentity;
        }
    }
}
