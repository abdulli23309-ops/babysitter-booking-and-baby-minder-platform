using System;
using System.Collections.Generic;
using System.Linq;
using System.Web.Http;
using System.Web.Http.Cors;


namespace WebApplication2
{
    public static class WebApiConfig
    {
        public static void Register(HttpConfiguration config)
        {
            var cors = new EnableCorsAttribute("*", "*", "*");
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
    }
}
