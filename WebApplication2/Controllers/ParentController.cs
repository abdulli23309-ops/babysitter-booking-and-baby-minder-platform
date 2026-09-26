using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Web;
using System.Web.Http;
using System.Web.Http.Cors;
using WebApplication2.DTOs;
using WebApplication2.Enums;
using WebApplication2.Infrastructure;
using WebApplication2.Services.Implementations;

using WebApplication2.Models;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/parent")]
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [SessionAuthorize(Roles = "Parent")] // B5: parent-exclusive controller; login/register are [AllowAnonymous] below
    public class ParentController : ApiController
    {
        private readonly IAccountService _accountService;
        private readonly IChildService _childService;
        private readonly IJobService _jobService;
        private readonly IJobInvitationService _invitationService;

        public ParentController() : this(new AccountService(), new ChildService(), new JobService())
        {
        }

        public ParentController(IAccountService accountService) : this(accountService, new ChildService(), new JobService())
        {
        }

        public ParentController(IAccountService accountService, IChildService childService) : this(accountService, childService, new JobService())
        {
        }

        public ParentController(IAccountService accountService, IChildService childService, IJobService jobService)
        {
            _accountService = accountService ?? throw new ArgumentNullException(nameof(accountService));
            _childService = childService ?? throw new ArgumentNullException(nameof(childService));
            _jobService = jobService ?? throw new ArgumentNullException(nameof(jobService));
            _invitationService = new JobInvitationService();
        }
        // ---------------- REGISTER (NOW MULTIPART) ----------------
        [HttpPost]
        [AllowAnonymous] // B5: registration remains public
        [Route("register")]
        public IHttpActionResult RegisterParent()
        {
            try
            {
                var httpRequest = HttpContext.Current.Request;

                string fullName = httpRequest.Form["FullName"];
                string email = httpRequest.Form["EmailAddress"];
                string username = httpRequest.Form["Username"];
                string password = httpRequest.Form["Password"];
                string phone = httpRequest.Form["PhoneNumber"];
                string address = httpRequest.Form["Address"] ?? "Not Provided";
                bool useDefault = httpRequest.Form["UseDefaultPicture"] == "true";

                if (string.IsNullOrWhiteSpace(fullName) ||
                    string.IsNullOrWhiteSpace(email) ||
                    string.IsNullOrWhiteSpace(username) ||
                    string.IsNullOrWhiteSpace(password))
                    return BadRequest("FullName, Email, Username and Password are required.");

                var emailErr = ValidationHelper.ValidateEmail(email);
                if (emailErr != null) return BadRequest("Email format is invalid.");

                var passErr = ValidationHelper.ValidatePassword(password);
                if (passErr != null) return BadRequest("Password must not exceed 256 characters.");

                // Use a fresh context to avoid concurrency exceptions
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    if (db.Parents.Any(p => p.EmailAddress == email || p.Username == username))
                        return BadRequest("A user with this Email or Username already exists.");

                    // Handle image file â€“ save to server, store filename only
                    string fileName = null;
                    if (useDefault || httpRequest.Files.Count == 0)
                    {
                        fileName = "default_parent.jpg"; // make sure this file exists in Images/Parents/
                    }
                    else
                    {
                        var postedFile = httpRequest.Files[0];
                        if (postedFile != null && postedFile.ContentLength > 0)
                        {
                            // Validate extension
                            string ext = Path.GetExtension(postedFile.FileName).ToLower();
                            if (ext != ".jpg" && ext != ".jpeg" && ext != ".png")
                                return BadRequest("Only JPG/PNG images are allowed.");

                            // Generate a unique filename to avoid collisions
                            fileName = Guid.NewGuid().ToString() + ext;

                            // Ensure the directory exists
                            string folderPath = HttpContext.Current.Server.MapPath("~/Images/Parents/");
                            if (!Directory.Exists(folderPath))
                                Directory.CreateDirectory(folderPath);

                            // Save the file
                            string fullPath = Path.Combine(folderPath, fileName);
                            postedFile.SaveAs(fullPath);
                        }
                        else
                        {
                            fileName = "default_parent.jpg";
                        }
                    }

                    var newParent = new Parent
                    {
                        FullName = fullName,
                        EmailAddress = email,
                        Username = username,
                        Password = PasswordHasher.HashPassword(password), // B4: hashed at rest
                        PhoneNumber = phone,
                        Address = address,
                        PictureAddress = "Parents/" + fileName, // filename only, no base64
                        CreatedAt = DateTime.Now     // fix NULL issue
                    };

                    db.Parents.Add(newParent);
                    db.SaveChanges();

                    return Ok(new { message = "Parent Registered Successfully" });
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Registration Error: " + ex.Message);
            }
        }

        // ---------------- LOGIN (unchanged â€“ uses JSON) ----------------
        [HttpPost]
        [AllowAnonymous] // B5: login remains public
        [Route("login")]
        public IHttpActionResult LoginParent(WebApplication2.DTOs.LoginDTO login)
        {
            // B7: Null body guard
            if (login == null)
                return BadRequest("Login details are required.");

            // B7: Validate input using centralized helper
            var inputValidation = ValidationHelper.ValidateLoginInput(login.Username, login.Password, login.Role, UserRole.Parent.ToDisplayString());
            if (!inputValidation.IsValid)
                return BadRequest(inputValidation.ErrorMessage);

            try
            {
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    var parent = db.Parents.FirstOrDefault(x => x.Username == login.Username);

                    // B3: Generic error to avoid username enumeration
                    if (parent == null)
                        return Content(HttpStatusCode.Unauthorized, "Invalid credentials.");

                    // B6: Reject soft-deleted accounts at login.
                    if (parent.IsDeleted)
                        return Content(HttpStatusCode.Unauthorized, "Account has been deactivated.");

                    // B4: BCrypt-first password verification with legacy SHA256/plaintext fallback
                    var verifyResult = PasswordHasher.VerifyPassword(login.Password ?? string.Empty, parent.Password);
                    if (!verifyResult.IsValid)
                        return Content(HttpStatusCode.Unauthorized, "Invalid credentials.");

                    if (verifyResult.NeedsUpgrade)
                    {
                        string newHash = PasswordHasher.HashPassword(login.Password ?? string.Empty);
                        PasswordHasher.UpgradePassword(db, parent.Parent_ID, UserRole.Parent.ToDisplayString(), newHash);
                    }

                    // Issue an opaque session token backed by the UserSessions table.
                    var token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
                    var sessionCreated = DateTime.UtcNow;
                    var sessionExpires = sessionCreated.AddDays(7);
                    db.Database.ExecuteSqlCommand(
                        "INSERT INTO UserSessions (Token, UserId, Role, CreatedAt, ExpiresAt) VALUES (@p0, @p1, @p2, @p3, @p4)",
                        token, parent.Parent_ID, UserRole.Parent.ToDisplayString(), sessionCreated, sessionExpires);

                    return Ok(new
                    {
                        message = "Login Successful",
                        userId = parent.Parent_ID,
                        name = parent.FullName,
                        role = UserRole.Parent.ToDisplayString(),
                        address = parent.Address,
                        pictureAddress = parent.PictureAddress,
                        token = token,
                        expiresAt = sessionExpires.ToString("o")
                    });
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Login Error: " + ex.Message);
            }
        }

        // ---------------- GET CHILDREN (B5: ownership enforced) ----------------
        [HttpGet]
        [Route("children/{parentId}")]
        public IHttpActionResult GetChildren(int parentId)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            // B5 IDOR: a Parent may only list their own children.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != parentId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own children.");

            try
            {
                var children = _childService.GetChildrenByParent(parentId);
                return Ok(children);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        // ---------------- CREATE CHILD (supports both multipart and JSON) ----------------
        [HttpPost]
        [Route("child")]
        public IHttpActionResult CreateChild()
        {
            try
            {
                var httpRequest = HttpContext.Current.Request;

                // Support JSON payload if Content-Type is application/json
                if (httpRequest != null && httpRequest.ContentType != null &&
                    httpRequest.ContentType.IndexOf("application/json", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    using (var reader = new StreamReader(httpRequest.InputStream))
                    {
                        httpRequest.InputStream.Position = 0;
                        string json = reader.ReadToEnd();
                        if (!string.IsNullOrWhiteSpace(json))
                        {
                            var dto = Newtonsoft.Json.JsonConvert.DeserializeObject<CreateChildDto>(json);
                            if (dto != null)
                            {
                                if (dto.ParentId <= 0)
                                    return BadRequest("Valid ParentId is required.");

                                if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != dto.ParentId)
                                    return Content(HttpStatusCode.Forbidden, "Access denied: you may only add children to your own profile.");

                                var jsonResult = _childService.CreateChild(dto, null, true);
                                return Ok(new { message = jsonResult.Message, childId = jsonResult.ChildId });
                            }
                        }
                    }
                }

                if (!int.TryParse(httpRequest.Form["ParentId"], out int parentId) || parentId <= 0)
                    return BadRequest("Valid ParentId is required.");

                // B5 IDOR: a Parent may only create children for themselves.
                if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != parentId)
                    return Content(HttpStatusCode.Forbidden, "Access denied: you may only add children to your own profile.");

                var result = _childService.CreateChild(httpRequest);
                return Ok(new { message = result.Message, childId = result.ChildId });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPost]
        [Route("child/json")]
        [Route("child/create")]
        public IHttpActionResult CreateChildJson([FromBody] CreateChildDto dto)
        {
            if (dto == null)
                return BadRequest("Child data is required.");

            if (dto.ParentId <= 0)
                return BadRequest("Valid ParentId is required.");

            if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != dto.ParentId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only add children to your own profile.");

            try
            {
                var result = _childService.CreateChild(dto, null, true);
                return Ok(new { message = result.Message, childId = result.ChildId });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        [HttpPut]
        [Route("child/{childId}")]
        public IHttpActionResult UpdateChild(int childId)
        {
            if (childId <= 0)
                return BadRequest("Valid Child ID is required.");

            try
            {
                int currentUserId = ClaimsPrincipalHelper.GetUserId();
                var result = _childService.UpdateChild(childId, HttpContext.Current.Request, currentUserId);
                return Ok(new { message = "Child profile updated successfully", childId = result.ChildId });
            }
            catch (KeyNotFoundException)
            {
                return Content(HttpStatusCode.NotFound, "Child not found.");
            }
            catch (UnauthorizedAccessException ex)
            {
                return Content(HttpStatusCode.Forbidden, ex.Message);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error updating child: " + ex.Message);
            }
        }


        [HttpPost]
        [Route("create-job")]
        public IHttpActionResult CreateJobForSitter([FromBody] CreateJobDto dto)
        {
            if (dto == null)
                return BadRequest("Job data is required.");
            if (dto.ParentId <= 0 || dto.SitterId <= 0)
                return BadRequest("Parent ID and Sitter ID must be positive integers.");

            // When IsForAllChildren is true, ChildId can be 0 (placeholder); AllChildIds carry the real children
            if (!dto.IsForAllChildren && dto.ChildId <= 0)
                return BadRequest("Child ID must be a positive integer.");

            // B5 IDOR: a Parent may only create jobs for themselves.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != dto.ParentId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only create jobs for your own account.");

            try
            {
                // 1 Job + N JobChildren rows — the service handles IsForAllChildren/AllChildIds
                // internally and creates exactly ONE Job regardless of child count.
                var result = _jobService.CreateJobForSitter(dto);

                // Auto-invite the target sitter so a JobInvitation row + notification
                // are created. A failed invite never fails the booking itself.
                var inviteFailed = false;
                try
                {
                    var invite = _invitationService.Invite(result.JobId, new InviteSittersDto
                    {
                        ParentId = dto.ParentId,
                        SitterIds = new List<int> { dto.SitterId }
                    });
                    inviteFailed = invite == null || !invite.Success;
                }
                catch
                {
                    inviteFailed = true;
                }

                var response = new
                {
                    message = result.Message,
                    jobId = result.JobId
                };
                if (inviteFailed)
                {
                    return Ok(new
                    {
                        response.message,
                        response.jobId,
                        invitationFailedJobIds = new List<int> { result.JobId }
                    });
                }
                return Ok(response);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error creating job: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("jobs/{parentId}")]
        public IHttpActionResult GetParentJobs(int parentId)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            // B5 IDOR: a Parent may only list their own jobs.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Parent.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != parentId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own jobs.");

            try
            {
                var jobs = _jobService.GetParentJobs(parentId);
                return Ok(jobs);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Error retrieving jobs: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("job/{jobId}")]
        public IHttpActionResult GetJobById(int jobId)
        {
            if (jobId <= 0)
                return BadRequest("Job ID must be a positive integer.");

            try
            {
                var job = _jobService.GetJobById(jobId);
                if (job == null)
                    return Content(HttpStatusCode.NotFound, "Job not found.");

                // B5 IDOR: a Parent may only view their own jobs.
                if (ClaimsPrincipalHelper.GetRole() == UserRole.Parent.ToDisplayString() && job.Parent_ID != ClaimsPrincipalHelper.GetUserId())
                    return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own bookings.");

                return Ok(job);
            }
            catch (Exception ex)
            {
                return BadRequest("Error retrieving job: " + ex.Message);
            }
        }

        // ---------------- B6: ACCOUNT DEACTIVATION ----------------
        [HttpPost]
        [HttpDelete]
        [SessionAuthorize(Roles = "Parent")]
        [Route("deactivate/{id:int?}")]
        public IHttpActionResult DeactivateParentAccount(int? id = null)
        {
            if (id.HasValue && id.Value <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            // B6 IDOR: cross-account deactivation is strictly forbidden
            if (id.HasValue && id.Value != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only deactivate your own account.");

            try
            {
                _accountService.DeactivateParent(currentUserId);
                return Ok(new { message = "Account deactivated successfully. All sessions revoked." });
            }
            catch (KeyNotFoundException ex)
            {
                return Content(HttpStatusCode.NotFound, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Deactivation Error: " + ex.Message);
            }
        }

        [HttpGet]
        [Route("{parentId}/profile")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult GetProfile(int parentId)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");

            var current = ClaimsPrincipalHelper.GetUserId();
            if (current != parentId)
                return StatusCode(HttpStatusCode.Forbidden);

            try
            {
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    var parent = db.Parents.FirstOrDefault(p => p.Parent_ID == parentId && !p.IsDeleted);
                    if (parent == null)
                        return Content(HttpStatusCode.NotFound, "Parent profile not found.");

                    var profile = new ParentProfileDto
                    {
                        Parent_ID = parent.Parent_ID,
                        FullName = parent.FullName,
                        EmailAddress = parent.EmailAddress,
                        Username = parent.Username,
                        PhoneNumber = parent.PhoneNumber,
                        PictureAddress = parent.PictureAddress,
                        Address = parent.Address
                    };

                    return Ok(profile);
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Error retrieving profile: " + ex.Message);
            }
        }

        [HttpPut]
        [Route("{parentId}/profile")]
        [SessionAuthorize(Roles = "Parent")]
        public IHttpActionResult UpdateProfile(int parentId, [FromBody] UpdateParentProfileDto dto)
        {
            if (parentId <= 0)
                return BadRequest("Parent ID must be a positive integer.");
            if (dto == null)
                return BadRequest("Update data is required.");

            var current = ClaimsPrincipalHelper.GetUserId();
            if (current != parentId)
                return StatusCode(HttpStatusCode.Forbidden);

            try
            {
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    var parent = db.Parents.FirstOrDefault(p => p.Parent_ID == parentId && !p.IsDeleted);
                    if (parent == null)
                        return Content(HttpStatusCode.NotFound, "Parent profile not found.");

                    if (dto.FullName != null)
                        parent.FullName = dto.FullName;
                    if (dto.PhoneNumber != null)
                        parent.PhoneNumber = dto.PhoneNumber;
                    if (dto.PictureAddress != null)
                        parent.PictureAddress = dto.PictureAddress;
                    if (dto.Address != null)
                        parent.Address = dto.Address;

                    db.SaveChanges();
                    return Ok(new { message = "Parent profile updated successfully." });
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Update Error: " + ex.Message);
            }
        }

    }
}