@echo off
REM syncSkills.bat - Sync skills from .agents/skills to AI tool directories
REM Run this script to create skills links in .claude, .codex, etc.

cd /d "%~dp0.."
set "SKILLS_SRC=%~dp0skills"

echo ================================================
echo ReUI Skills Sync Tool
echo ================================================
echo.

REM Check if skills source exists
if not exist "%SKILLS_SRC%\" (
    echo [ERROR] Skills source directory not found:
    echo         %SKILLS_SRC%
    echo.
    echo Please create skills in the above directory first.
    echo Each skill should be a subdirectory with SKILL.md
    echo.
    pause
    exit /b 1
)

echo [INFO] Project root: %CD%
echo [INFO] Skills source: %SKILLS_SRC%
echo.

REM Sync to each AI tool directory
call :sync_to_dir ".claude"
call :sync_to_dir ".codex"
call :sync_to_dir ".cursor"
call :sync_to_dir ".windsurf"
call :sync_to_dir ".aider"
call :sync_to_dir ".codebuddy"
call :sync_to_dir ".github"

echo ================================================
echo [DONE] Skills synced to all AI tool directories
echo ================================================
echo.
pause
exit /b 0

:sync_to_dir
set "DIR_NAME=%~1"
echo [PROC] Processing: %DIR_NAME%

REM Create AI tool directory if it doesn't exist
if not exist "%DIR_NAME%\" (
    mkdir "%DIR_NAME%"
    echo        Created directory: %DIR_NAME%
)

REM Create skills junction if it doesn't exist
if not exist "%DIR_NAME%\skills" (
    mklink /J "%DIR_NAME%\skills" "%SKILLS_SRC%"
    echo        Created skills link: %DIR_NAME%\skills
) else (
    echo        Skip: %DIR_NAME%\skills already exists
)
echo.
exit /b 0
