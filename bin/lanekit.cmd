@echo off
rem lanekit on Windows: runs the script next to this file with node. cmd.exe and PowerShell cannot start a file by its shebang line.
node "%~dp0lanekit" %*
