@echo off
chcp 65001 >nul
title 브로가드 PC 리모컨
cd /d "%~dp0"

REM ============================================================
REM  파일로 열어줄 폴더 (폰에서 볼 폴더). 원하면 아래 한 줄만 바꾸세요.
REM  예)  set "ROOT=D:\공유폴더"
REM ============================================================
set "ROOT=%USERPROFILE%\Desktop"

echo.
echo ============================================
echo    브로가드 PC 리모컨
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [!] 파이썬이 설치되어 있지 않아요.
  echo     https://www.python.org/downloads/  에서 설치하세요.
  echo     설치할 때 "Add Python to PATH" 를 꼭 체크하세요!
  echo.
  pause
  exit /b
)

echo 필요한 구성요소를 확인/설치합니다. (처음 한 번만 조금 걸려요)
python -m pip install --quiet --upgrade mss pillow pyautogui
if errorlevel 1 (
  echo.
  echo [!] 설치 중 문제가 생겼어요. 인터넷 연결을 확인하고 다시 실행해 주세요.
  echo.
  pause
  exit /b
)

echo.
echo 리모컨을 시작합니다.
echo  * 방화벽 창이 뜨면 "액세스 허용"(개인 네트워크)을 눌러주세요.
echo  * 종료하려면 이 창에서  Ctrl + C  를 누르세요.
echo.
python "%~dp0pc_remote.py" --root "%ROOT%"

echo.
pause
