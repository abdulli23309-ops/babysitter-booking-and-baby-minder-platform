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
using WebApplication2.Models;
using WebApplication2.Services.Implementations;
using WebApplication2.Services.Interfaces;

namespace WebApplication2.Controllers
{
    [RoutePrefix("api/babysitter")]
    [EnableCors(origins: "*", headers: "*", methods: "*")]
    [SessionAuthorize(Roles = "Sitter")] // B5: sitter-exclusive controller; login/register are [AllowAnonymous] below
    public class BabysitterController : ApiController
    {
        private readonly IAccountService _accountService;

        public BabysitterController() : this(new AccountService())
        {
        }

        public BabysitterController(IAccountService accountService)
        {
            _accountService = accountService ?? throw new ArgumentNullException(nameof(accountService));
        }
        // ---------------- REGISTER (multipart, stores filename only) ----------------
        [HttpPost]
        [AllowAnonymous] // B5: registration remains public
        [Route("register")]
        public IHttpActionResult RegisterBabysitter()
        {
            try
            {
                var httpRequest = HttpContext.Current.Request;

                string fullName = httpRequest.Form["FullName"];
                string email = httpRequest.Form["EmailAddress"];
                string username = httpRequest.Form["Username"];
                string password = httpRequest.Form["Password"];
                string phone = httpRequest.Form["PhoneNumber"];
                string dobStr = httpRequest.Form["DOB"];
                string expStr = httpRequest.Form["ExperienceYears"];
                string rateStr = httpRequest.Form["HourlyRate"];
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

                DateTime dob;
                if (!DateTime.TryParse(dobStr, out dob))
                    dob = new DateTime(2000, 1, 1);

                int exp = int.TryParse(expStr, out int e) ? e : 0;
                // HourlyRate is optional at signup: absent/empty => NULL, and the
                // sitter sets their real rate later via /set-availability.
                decimal? rate = null;
                if (!string.IsNullOrWhiteSpace(rateStr))
                {
                    if (!decimal.TryParse(rateStr, out decimal r))
                        return BadRequest("HourlyRate must be a valid number.");
                    if (r < 0) return BadRequest("HourlyRate cannot be negative.");
                    rate = r;
                }
                if (exp < 0) return BadRequest("ExperienceYears cannot be negative.");

                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    if (db.Babysitters.Any(b => b.EmailAddress == email || b.Username == username))
                        return BadRequest("A user with this Email or Username already exists.");

                    // Handle image
                    string fileName;
                    if (useDefault || httpRequest.Files.Count == 0)
                    {
                        fileName = "Sitters/default_sitter.jpg"; 
                    }
                    else
                    {
                        var postedFile = httpRequest.Files[0];
                        if (postedFile != null && postedFile.ContentLength > 0)
                        {
                            string ext = Path.GetExtension(postedFile.FileName).ToLower();
                            if (ext != ".jpg" && ext != ".jpeg" && ext != ".png")
                                return BadRequest("Only JPG/PNG images are allowed.");

                            fileName = Guid.NewGuid().ToString() + ext;
                            string folderPath = HttpContext.Current.Server.MapPath("~/Images/Sitters/");
                            if (!Directory.Exists(folderPath))
                                Directory.CreateDirectory(folderPath);

                            string fullPath = Path.Combine(folderPath, fileName);
                            postedFile.SaveAs(fullPath);
                        }
                        else
                        {
                            fileName = "default_sitter.jpg";
                        }
                    }

                    var sitter = new Babysitter
                    {
                        FullName = fullName,
                        EmailAddress = email,
                        Username = username,
                        Password = PasswordHasher.HashPassword(password), // B4: hashed at rest
                        PhoneNumber = phone,
                        DOB = dob,
                        ExperienceYears = exp,
                        HourlyRate = rate,
                        PictureAddress = "Sitters/" + fileName,
                        AvailabilityStatus = "Available",
                        CreatedAt = DateTime.Now
                    };

                    db.Babysitters.Add(sitter);
                    db.SaveChanges();

                    return Ok(new { message = "Sitter Registered Successfully" });
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Registration Error: " + ex.Message);
            }
        }
        [HttpGet]
        [Route("earnings/{sitterId}")]
        public IHttpActionResult GetEarnings(int sitterId)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            // B5 IDOR: a Sitter may only view their own earnings.
            if (ClaimsPrincipalHelper.GetRole() != UserRole.Sitter.ToDisplayString() || ClaimsPrincipalHelper.GetUserId() != sitterId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only view your own earnings.");

            try
            {
                var result = _accountService.GetSitterEarnings(sitterId);
                return Ok(result);
            }
            catch (Exception ex)
            {
                return BadRequest("Error: " + ex.Message);
            }
        }

        // ---------------- LOGIN (unchanged from ParentController pattern) ----------------
        [HttpPost]
        [AllowAnonymous] // B5: login remains public
        [Route("login")]
        public IHttpActionResult LoginBabysitter(WebApplication2.DTOs.LoginDTO login)
        {
            // B7: Null body guard
            if (login == null)
                return BadRequest("Login details are required.");

            // B7: Validate input using centralized helper
            var inputValidation = ValidationHelper.ValidateLoginInput(login.Username, login.Password, login.Role, UserRole.Sitter.ToDisplayString());
            if (!inputValidation.IsValid)
                return BadRequest(inputValidation.ErrorMessage);

            try
            {
                using (var db = new BabySitterBooking_and_BabyMinderEntities())
                {
                    var sitter = db.Babysitters.FirstOrDefault(s => s.Username == login.Username);

                    if (sitter == null)
                        return Content(HttpStatusCode.Unauthorized, "User not found");

                    // B6: Reject soft-deleted accounts at login.
                    if (sitter.IsDeleted)
                        return Content(HttpStatusCode.Unauthorized, "Account has been deactivated.");

                    // B4: BCrypt-first password verification with legacy SHA256/plaintext fallback
                    var verifyResult = PasswordHasher.VerifyPassword(login.Password ?? string.Empty, sitter.Password);
                    if (!verifyResult.IsValid)
                        return Content(HttpStatusCode.Unauthorized, "Wrong password");

                    if (verifyResult.NeedsUpgrade)
                    {
                        string newHash = PasswordHasher.HashPassword(login.Password ?? string.Empty);
                        PasswordHasher.UpgradePassword(db, sitter.Sitter_ID, UserRole.Sitter.ToDisplayString(), newHash);
                    }

                    // Issue an opaque session token backed by the UserSessions table.
                    var token = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
                    var sessionCreated = DateTime.UtcNow;
                    var sessionExpires = sessionCreated.AddDays(7);
                    db.Database.ExecuteSqlCommand(
                        "INSERT INTO UserSessions (Token, UserId, Role, CreatedAt, ExpiresAt) VALUES (@p0, @p1, @p2, @p3, @p4)",
                        token, sitter.Sitter_ID, UserRole.Sitter.ToDisplayString(), sessionCreated, sessionExpires);

                    return Ok(new
                    {
                        message = "Login Successful",
                        userId = sitter.Sitter_ID,
                        name = sitter.FullName,
                        role = UserRole.Sitter.ToDisplayString(),
                        token = token,
                        expiresAt = sessionExpires.ToString("o")
                        // you can add more fields if needed (e.g., hourly rate)
                    });
                }
            }
            catch (Exception ex)
            {
                return BadRequest("Login Error: " + ex.Message);
            }
        }

        [HttpPost]
        [HttpDelete]
        [SessionAuthorize(Roles = "Sitter")]
        [Route("deactivate/{id:int?}")]
        public IHttpActionResult DeactivateSitterAccount(int? id = null)
        {
            if (id.HasValue && id.Value <= 0)
                return BadRequest("Sitter ID must be a positive integer.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            // B6 IDOR: cross-account deactivation is strictly forbidden
            if (id.HasValue && id.Value != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only deactivate your own account.");

            try
            {
                _accountService.DeactivateSitter(currentUserId);
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

        // ---------------- ADDITIVE: SITTER SELF-UPDATE ----------------
        // PUT api/babysitter/update/{sitterId}
        // Allows a sitter to update their OWN existing profile columns. Additive only:
        // no existing route is changed. Password / IsDeleted / Sitter_ID are not editable here.
        [HttpPut]
        [SessionAuthorize(Roles = "Sitter")]
        [Route("update/{sitterId}")]
        public IHttpActionResult UpdateSitter(int sitterId, [FromBody] UpdateSitterDto dto)
        {
            if (sitterId <= 0)
                return BadRequest("Sitter ID must be a positive integer.");
            if (dto == null)
                return BadRequest("Update data is required.");

            int currentUserId = ClaimsPrincipalHelper.GetUserId();
            if (currentUserId <= 0)
                return Content(HttpStatusCode.Unauthorized, "Not authenticated.");

            // B5 IDOR: a Sitter may only update their own profile.
            if (sitterId != currentUserId)
                return Content(HttpStatusCode.Forbidden, "Access denied: you may only update your own profile.");

            try
            {
                _accountService.UpdateSitter(currentUserId, dto);
                return Ok(new { message = "Profile updated." });
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                return BadRequest("Update Error: " + ex.Message);
            }
        }

    }
}