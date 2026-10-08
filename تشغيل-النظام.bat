@echo off
chcp 65001 >nul
setlocal
title نظام المبيعات - خادم محلي

cd /d "%~dp0"

set PORT=8000
set URL=http://localhost:%PORT%

echo.
echo   ================================================
echo     نظام المبيعات - تشغيل الخادم المحلي
echo   ================================================
echo.

rem ابحث عن مشغّل متاح بالترتيب: Python launcher، ثم python، ثم node، ثم php
where py >nul 2>&1
if %errorlevel%==0 (
    set "RUNCMD=py -3 -m http.server %PORT% --bind 127.0.0.1"
    goto :found
)

where python >nul 2>&1
if %errorlevel%==0 (
    set "RUNCMD=python -m http.server %PORT% --bind 127.0.0.1"
    goto :found
)

where node >nul 2>&1
if %errorlevel%==0 (
    set "RUNCMD=npx --yes serve . -l %PORT%"
    goto :found
)

where php >nul 2>&1
if %errorlevel%==0 (
    set "RUNCMD=php -S 127.0.0.1:%PORT%"
    goto :found
)

echo   [خطأ] لم يُعثر على Python أو Node.js أو PHP على هذا الجهاز.
echo.
echo   ثبّت أحدها ثم أعد المحاولة:
echo     Python : https://www.python.org/downloads/
echo     Node.js: https://nodejs.org/
echo.
pause
exit /b 1

:found
echo   الخادم: %RUNCMD%
echo   العنوان: %URL%
echo.
echo   سيُفتح المتصفح تلقائياً خلال ثانيتين.
echo   لإيقاف الخادم: أغلق هذه النافذة أو اضغط Ctrl+C
echo.

start "" /b cmd /c "timeout /t 2 /nobreak >nul & start """" ""%URL%"""

%RUNCMD%

echo.
echo   توقّف الخادم.
pause
