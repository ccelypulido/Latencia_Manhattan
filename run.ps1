# Manhattan Latency Analyzer - Windows PowerShell Launcher
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "  Manhattan Latency Analyzer - PowerShell Launcher" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host ""

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($null -eq $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}

if ($null -ne $pythonCmd) {
    Write-Host "🚀 Iniciando aplicacion web..." -ForegroundColor Green
    & $pythonCmd.Name app.py
} else {
    Write-Host "❌ Error: Python no se encuentra instalado en el sistema." -ForegroundColor Red
    Write-Host "Por favor instala Python desde https://www.python.org/" -ForegroundColor Yellow
}
