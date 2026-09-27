using System;
using System.Collections.Generic;
using System.Configuration;
using System.Diagnostics;
using System.Linq;
using System.Web.Http;
using System.Web.Http.Cors;


namespace WebApplication2
{
    public static class WebApiConfig
    {
        /// <summary>
        /// Registers the Web API pipeline: CORS policy, dependency resolver and
        /// routes. Called once at application start (Global.asax Application_Start).
        /// </summary>
        /// <remarks>
        /// CORS (Phase 1 Fix C):
        /// Browser cross-origin access is governed by exactly ONE policy, built
        /// from the Web.config appSettings key "AllowedCorsOrigins" (comma
        /// separated origins, e.g. "https://app.example.com,https://admin.example.com").
        ///
        /// The old configuration was ("*", "*", "*") which allowed ANY website
        /// to call this API from a visitor's browser. Origins are now taken from
        /// configuration; headers and methods remain wildcarded because they do
        /// not decide WHO may call the API — the origin list does, and API
        /// endpoints independently enforce authentication via SessionAuthorize.
        ///
        /// Production note:
        /// The real production frontend origin was NOT known while developing
        /// this code and was deliberately not invented. Whoever deploys must set
        /// "AllowedCorsOrigins" to the real origin(s). When the key is missing,
        /// only the local Vite dev origins are allowed (never "*").
        ///
        /// There is intentionally no [EnableCors] attribute on individual
        /// controllers: a per-controller attribute would silently REPLACE this
        /// global policy, which is how the wildcard survived before Phase 1.
        /// </remarks>
        public static void Register(HttpConfiguration config)
        {
            string allowedOrigins = GetAllowedCorsOrigins();
            var cors = new EnableCorsAttribute(allowedOrigins, "*", "*");
            config.EnableCors(cors);

            // Lightweight DI resolver for controllers and services
            config.DependencyResolver = new Infrastructure.SimpleDependencyResolver();

            // Authentication is enforced per-endpoint via [SessionAuthorize], which
            // validates the Bearer session token against the UserSessions table and
            // establishes the ClaimsPrincipal before authorization. Login/register
            // endpoints remain [AllowAnonymous].
            config.MapHttpAttributeRoutes();

            config.Routes.MapHttpRoute(
                name: "DefaultApi",
                routeTemplate: "api/{controller}/{id}",
                defaults: new { id = RouteParameter.Optional }
            );
        }

        /// <summary>
        /// Resolves the allowed browser origins for CORS from Web.config.
        /// </summary>
        /// <remarks>
        /// SECURITY RULE:
        /// This function must never return "*" as an accidental fallback.
        /// "*" would let any website drive this API with a logged-in user's
        /// browser. If configuration is absent, only the local development
        /// origins of the React app (Vite dev server, default port 5173) are
        /// allowed, so local development keeps working while production stays
        /// locked until an operator supplies the real origin(s).
        ///
        /// CONFIGURATION:
        /// Web.config &lt;appSettings&gt; key "AllowedCorsOrigins", comma separated.
        /// A value of "*" there is honoured but logged as a warning, because it
        /// is unsafe outside a throwaway demo.
        /// </remarks>
        private static string GetAllowedCorsOrigins()
        {
            // Vite dev server origins (babysitter-app/vite.config.js uses the
            // default port 5173; both "localhost" and "127.0.0.1" spellings
            // count as different browser origins).
            const string localDevelopmentOrigins = "http://localhost:5173,http://127.0.0.1:5173";

            string configuredOrigins = ConfigurationManager.AppSettings["AllowedCorsOrigins"];

            if (string.IsNullOrWhiteSpace(configuredOrigins))
            {
                Trace.TraceWarning(
                    "WebApiConfig: appSettings key 'AllowedCorsOrigins' is missing or empty. " +
                    "Allowing local development origins only. Production deployments MUST set this key " +
                    "to the real frontend origin(s).");
                return localDevelopmentOrigins;
            }

            if (configuredOrigins.Trim() == "*")
            {
                Trace.TraceWarning(
                    "WebApiConfig: 'AllowedCorsOrigins' is set to '*' — every website may call this API " +
                    "from a browser. This is acceptable only for local demos, never for production.");
            }

            return configuredOrigins.Trim();
        }
    }
}
