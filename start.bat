@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 (
  echo Failed to open the project folder.
  pause
  exit /b 1
)

node --version >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22 LTS and run this file again.
  pause
  exit /b 1
)

node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit((major===20&&minor>=19)||(major===22&&minor>=12)||major>22?0:1)" >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19+ or 22.12+ is required.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  if exist package-lock.json (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting PNGTuber Studio at http://127.0.0.1:5173/talk.html
call npm run dev -- --host 127.0.0.1 --open /talk.html

popd
endlocal
