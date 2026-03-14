@echo off
echo ========================================
echo   Instrument Tiles - Windows Installer
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [1/3] Installing Node.js...
    echo.
    echo Downloading Node.js installer...
    
    :: Use PowerShell to download Node.js LTS
    powershell -Command "& {Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi' -OutFile '%TEMP%\nodejs.msi'}"
    
    echo Installing Node.js (this may take a minute)...
    msiexec /i "%TEMP%\nodejs.msi" /qn /norestart
    
    :: Refresh environment variables
    refreshenv >nul 2>nul
    call "%ProgramFiles%\nodejs\nodevars.bat"
    
    echo Node.js installed!
) else (
    echo [1/3] Node.js already installed - skipping...
    node --version
)

echo.
echo [2/3] Installing dependencies...
call npm install

echo.
echo [3/3] Starting Instrument Tiles...
echo.
echo ========================================
echo   Server starting...
echo   Open http://localhost:3000 in browser
echo ========================================
echo.
call npm start
