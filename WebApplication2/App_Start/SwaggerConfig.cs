using System.Web.Http;
using WebActivatorEx;
using WebApplication2;
using Swashbuckle.Application;



namespace WebApplication2
{
    public class SwaggerConfig
    {
        public static void Register()
        {
            GlobalConfiguration.Configuration
       .EnableSwagger(c =>
       {
           c.SingleApiVersion("v1", "My API");
       })
       .EnableSwaggerUi();
        }
    }
}
