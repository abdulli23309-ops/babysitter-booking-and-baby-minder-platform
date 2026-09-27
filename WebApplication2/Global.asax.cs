using System;
using System.Collections.Generic;
using System.Linq;
using System.Web;
using System.Web.Http;
using System.Web.Routing;

namespace WebApplication2
{
    public class WebApiApplication : System.Web.HttpApplication
    {
        protected void Application_Start()
        {
            GlobalConfiguration.Configure(WebApiConfig.Register);
            SwaggerConfig.Register();
        }
        protected void Application_BeginRequest()
        {
            // PHASE 1 FIX D — Swagger redirect gate:
            // Send the bare "/" path to /swagger ONLY while Swagger is enabled
            // (Web.config appSettings EnableSwagger). When Swagger is disabled
            // (the Release default), "/" falls through to the normal 404
            // instead of redirecting to a documentation page that no longer
            // exists. Everything else about the request pipeline is untouched.
            if (SwaggerConfig.IsEnabled() &&
                HttpContext.Current.Request.Url.AbsolutePath == "/")
            {
                HttpContext.Current.Response.Redirect("/swagger");
            }
        }
    }
}
