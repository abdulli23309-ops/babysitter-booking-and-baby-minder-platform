using System.Configuration;
using System.Web.Http;
using WebActivatorEx;
using WebApplication2;
using Swashbuckle.Application;



namespace WebApplication2
{
    public class SwaggerConfig
    {
        /// <summary>
        /// Registers the Swagger (Swashbuckle) API documentation UI.
        /// </summary>
        /// <remarks>
        /// PHASE 1 FIX D — PRODUCTION SAFETY:
        /// Swagger is gated by the Web.config appSettings key "EnableSwagger".
        /// Development keeps it ON ("true" in Web.config) so /swagger stays
        /// usable while working locally. Web.Release.config publishes with
        /// "false", so production does not expose an interactive API catalog
        /// to the public. IsEnabled() FAILS CLOSED: a missing or malformed key
        /// means Swagger is off — exposure must be an explicit decision.
        ///
        /// WHO USES IT: developers (API exploration) and the "/" redirect in
        /// Global.asax (which is also gated on IsEnabled()).
        /// </remarks>
        public static void Register()
        {
            if (!IsEnabled())
            {
                // Intentionally silent at startup: with Swagger disabled the
                // endpoint routes simply do not exist (no config registered).
                return;
            }

            GlobalConfiguration.Configuration
       .EnableSwagger(c =>
       {
           c.SingleApiVersion("v1", "My API");
       })
       .EnableSwaggerUi();
        }

        /// <summary>
        /// Reads the Web.config appSettings key "EnableSwagger" ("true"/"false").
        /// </summary>
        /// <remarks>
        /// SECURITY: FAILS CLOSED. If the key is missing, blank or not a real
        /// boolean, Swagger stays disabled — exposing API documentation must
        /// always be an explicit configuration decision, never an accident of
        /// a deleted line. Development (Web.config) sets "true"; the Release
        /// publish transform (Web.Release.config) forces "false".
        /// </remarks>
        public static bool IsEnabled()
        {
            string configuredValue = ConfigurationManager.AppSettings["EnableSwagger"];
            bool isEnabled;
            return bool.TryParse(configuredValue, out isEnabled) && isEnabled;
        }
    }
}
