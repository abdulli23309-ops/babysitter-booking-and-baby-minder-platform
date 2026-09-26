using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/images")]
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    public class ImageController : ApiController
    {
        private readonly IImageService _imageService;

        public ImageController() : this(new ImageService())
        {
        }

        public ImageController(IImageService imageService)
        {
            _imageService = imageService ?? throw new ArgumentNullException(nameof(imageService));
        }

        [HttpGet]
        [Route("{type}/{filename}")]
        [Route("default/{type}/{filename}")]
        public HttpResponseMessage GetImage(string type, string filename)
        {
            var result = _imageService.ResolveImage(type, filename);
            if (!result.IsValid)
            {
                return new HttpResponseMessage(HttpStatusCode.BadRequest);
            }

            if (!result.Exists || string.IsNullOrEmpty(result.FilePath) || !File.Exists(result.FilePath))
            {
                return new HttpResponseMessage(HttpStatusCode.NotFound);
            }

            var response = new HttpResponseMessage(HttpStatusCode.OK);
            var stream = new FileStream(result.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            response.Content = new StreamContent(stream);
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(result.MimeType);
            return response;
        }

        [HttpGet]
        [Route("{filename}")]
        [Route("default/{filename}")]
        public HttpResponseMessage GetRootImage(string filename)
        {
            return GetImage("default", filename);
        }
    }
}
