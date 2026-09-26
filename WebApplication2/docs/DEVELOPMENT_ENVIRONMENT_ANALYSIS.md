# Development Environment Analysis

Date: 2026-09-08

## Executive Summary

All three backends are traditional ASP.NET Web Application projects targeting .NET Framework 4.7.2. They are not SDK-style projects and are not ASP.NET Core applications. They use `System.Web`, `Global.asax`, `App_Start`, `Web.config`, classic Web API hosting, Entity Framework 6 or 5, and `packages.config`.

The C# Dev Kit errors are expected: C# Dev Kit does not load this legacy project format. The projects should not be converted just to remove the warning. Use Visual Studio with the ASP.NET/.NET Framework workload for the smoothest development and debugging experience, or use VS Code as an editor with the full MSBuild/NuGet/IIS Express toolchain installed.

No `.csproj`, target framework, package version, or application code was changed during this analysis.

## 1. Project Comparison

| Project | Format | Target | ASP.NET type | `System.Web` | NuGet | Entity Framework | Web host |
|---|---|---|---|---|---|---|---|
| `WebApplication2/WebApplication2.csproj` | Legacy MSBuild, non-SDK | .NET Framework 4.7.2 | ASP.NET Web API/Web Application | Yes | `packages.config` | 6.5.1 | ASP.NET/IIS, Web API 2 |
| `Final_year_1_project_Api/Final_year_1_project_Api/Final_year_1_project_Api.csproj` | Legacy MSBuild, non-SDK | .NET Framework 4.7.2 | ASP.NET MVC + Web API Web Application | Yes | `packages.config` | 6.4.4 | ASP.NET/IIS, Web API 2 |
| `Final_year_1_project_Api_zain/Final_year_1_project_Api/Final_year_1_project_Api.csproj` | Legacy MSBuild, non-SDK | .NET Framework 4.7.2 | ASP.NET MVC + Web API Web Application | Yes | `packages.config` | 5.0.0 | ASP.NET/IIS, Web API 2 |

Evidence found in each project includes:

- No `<Project Sdk=...>` attribute.
- Classic MSBuild namespace and explicit `Compile`/`Content` items.
- ASP.NET Web Application project type GUID.
- `Microsoft.WebApplication.targets` import.
- `Global.asax`, `App_Start`, and `Web.config`.
- References to `System.Web`, `System.Web.Http`, and related framework assemblies.
- `packages.config` with `net472` package targets.

The zain directory is a separate copy of the API, not a project reference from the other two projects. Its Entity Framework version is older than the other copies, so the three projects should be treated as independent applications unless their code and database compatibility are deliberately reconciled.

## 2. Solutions and Workspace Layout

Each project already has a solution file, but it is the newer `.slnx` format rather than the traditional `.sln` format:

- `WebApplication2/WebApplication2.slnx`
- `Final_year_1_project_Api/Final_year_1_project_Api.slnx`
- `Final_year_1_project_Api_zain/Final_year_1_project_Api.slnx`

Each `.slnx` contains only its local project. No combined solution exists, and no traditional `.sln` file was created. A Visual Studio solution can reference these projects, but combining independent application copies into one solution is optional and may make startup-project and configuration management less clear.

Recommended layout is to keep the current directories stable and use the workspace root for documentation and editor configuration:

```text
Unified Backend Workspace/
  WebApplication2/
    WebApplication2.slnx
    WebApplication2.csproj
  Final_year_1_project_Api/
    Final_year_1_project_Api.slnx
    Final_year_1_project_Api/Final_year_1_project_Api.csproj
  Final_year_1_project_Api_zain/
    Final_year_1_project_Api.slnx
    Final_year_1_project_Api/Final_year_1_project_Api.csproj
  docs/
  .vscode/
```

Do not move these directories unless all relative package paths, solution paths, project settings, launch URLs, and database/configuration assumptions are tested afterward.

## 3. Correct Build Workflow

`dotnet build` should not be treated as the build command for these projects. The `dotnet` CLI is for SDK-style projects and does not provide the classic ASP.NET Web Application targets required here.

Run commands from the directory containing the selected project or solution. The commands below require Visual Studio MSBuild and NuGet CLI:

### WebApplication2

```powershell
nuget restore .\WebApplication2.slnx
msbuild .\WebApplication2.csproj /t:Build /p:Configuration=Debug
msbuild .\WebApplication2.csproj /t:Clean
```

### Final_year_1_project_Api

```powershell
nuget restore .\Final_year_1_project_Api.slnx
msbuild .\Final_year_1_project_Api\Final_year_1_project_Api.csproj /t:Build /p:Configuration=Debug
msbuild .\Final_year_1_project_Api\Final_year_1_project_Api.csproj /t:Clean
```

### Final_year_1_project_Api_zain

```powershell
nuget restore .\Final_year_1_project_Api.slnx
msbuild .\Final_year_1_project_Api\Final_year_1_project_Api.csproj /t:Build /p:Configuration=Debug
msbuild .\Final_year_1_project_Api\Final_year_1_project_Api.csproj /t:Clean
```

If the installed MSBuild version does not support `.slnx`, restore the project using NuGet and build the `.csproj` directly, or use Visual Studio's solution loader. Do not change project XML solely to accommodate the CLI.

The current machine check found `dotnet`, but did not find `msbuild`, `nuget`, `devenv`, `iisexpress`, or `vswhere` on PATH or in the standard VS 2022 locations. Therefore these commands cannot be executed successfully until the required tooling is installed.

## 4. Run and Debug

These are hosted web applications, not console applications. The normal run/debug path is:

1. Open the individual project or `.slnx` in Visual Studio Community.
2. Restore NuGet packages.
3. Select IIS Express or the configured IIS profile.
4. Set the application as the startup project.
5. Start with F5.

VS Code can edit the files and can invoke MSBuild through tasks after the tools are installed. It cannot make C# Dev Kit load these projects, and an ordinary `launch.json` does not replace IIS/IIS Express hosting for classic ASP.NET. No misleading debugger profile was created.

## 5. VS Code Configuration

The workspace `.vscode/settings.json` selects OmniSharp for legacy C# support:

```json
{
  "dotnet.server.useOmnisharp": true,
  "omnisharp.useModernNet": false
}
```

This is an editor-language-service fallback, not C# Dev Kit support. Disable C# Dev Kit for this workspace and reload VS Code. OmniSharp still needs compatible Windows .NET Framework/MSBuild tooling for complete project resolution.

The workspace `.vscode/tasks.json` provides build, restore, and clean commands for each project. Tasks intentionally call `msbuild` and `nuget`; they will report a missing-command error until those tools are installed and available on PATH.

## 6. Required Tools

Recommended installation:

- Visual Studio Community 2022 with **ASP.NET and web development**.
- **.NET Framework 4.7.2 Developer Pack/Targeting Pack**.
- MSBuild, supplied by Visual Studio or Visual Studio Build Tools.
- NuGet CLI, or Visual Studio's NuGet restore support.
- IIS Express, normally installed with Visual Studio's ASP.NET workload.
- SQL Server/LocalDB or the database service required by each application's connection string.

Visual Studio Community is the recommended option because it supplies the project system, classic ASP.NET web tooling, IIS Express integration, debugging, and MSBuild in one supported environment. Build Tools plus VS Code is possible for build automation, but it is less complete for design-time web debugging.

## 7. Why C# Dev Kit Fails

C# Dev Kit reports unsupported format because these projects are classic .NET Framework web projects. They rely on the Visual Studio web project system and `Microsoft.WebApplication.targets`, while C# Dev Kit primarily expects supported SDK-style project systems. The warning does not mean the project files are corrupt, nor does it mean the applications must become ASP.NET Core applications.

## 8. SDK Conversion Risk

| Project | Classification | Reason |
|---|---|---|
| `WebApplication2` | Not recommended | Uses `System.Web`, Global.asax, Web API 2, EDMX/T4 generated Entity Framework models, classic web targets, and packages.config. |
| `Final_year_1_project_Api` | Not recommended | Uses classic MVC/Web API, System.Web, Global.asax, Web.config transforms, EDMX/T4 models, and packages.config. |
| `Final_year_1_project_Api_zain` | Not recommended | Same legacy hosting model, plus an older Entity Framework 5 dependency that increases compatibility risk. |

SDK-style conversion is technically possible only as a deliberate migration project, not as a mechanical format edit. It would require validating assembly references, web build targets, content/transforms, Razor/MVC behavior, EDMX/T4 generation, package references, deployment, authentication, and IIS hosting. Migration to ASP.NET Core would be a separate application rewrite involving `System.Web` replacement, middleware/routing changes, configuration changes, hosting changes, and likely ORM/API compatibility work.

## 9. Recommended Workflow

**Recommended:** use Visual Studio Community for restore, build, IIS Express, debugging, and classic ASP.NET project management. Use VS Code at the workspace root for editing, documentation, search, and AI-assisted work. Disable C# Dev Kit for this workspace and keep the OmniSharp settings enabled if VS Code language services are needed.

**Alternative:** install Visual Studio Build Tools, NuGet CLI, the .NET Framework 4.7.2 Developer Pack, and IIS Express. Use the supplied VS Code tasks for restore/build/clean, and launch/debug through IIS Express or Visual Studio. This is viable for builds but has weaker design-time and debugging support than Visual Studio.

## 10. Future Migration Path

Keep the current applications unchanged while stabilizing functionality and deployment. If a future migration is required, choose one application as a pilot, inventory endpoints and authentication, add API integration tests, document database/EF behavior, create an ASP.NET Core replacement beside the legacy application, and migrate incrementally. Do not change the target framework or package format as a workaround for the current C# Dev Kit warning.

## Conclusions

- The projects are valid legacy ASP.NET Framework projects, not SDK-style projects.
- All target .NET Framework 4.7.2.
- No framework, project file, package, or application code was modified.
- The correct fix is installing and using legacy-compatible tooling, not converting the projects.
- C# Dev Kit will remain unable to load them; OmniSharp or Visual Studio should be used instead.
