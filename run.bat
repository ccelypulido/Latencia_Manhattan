@echo off
title Manhattan Latency Analyzer
echo ======================================================
echo   Manhattan Latency Analyzer - Windows Launcher
echo ======================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Iniciando Manhattan Latency Analyzer...
    python app.py
) else (
    where py >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        echo Iniciando Manhattan Latency Analyzer con py launcher...
        py app.py
    ) else (
        echo [ERROR] Python no esta instalado o no se encuentra en el PATH.
        echo Por favor instala Python de https://www.python.org/
        pause
    )
)
pause
