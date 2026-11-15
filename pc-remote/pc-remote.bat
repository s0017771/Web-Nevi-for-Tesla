@echo off
chcp 65001 >nul
title 브로가드 PC 리모컨
cd /d "%~dp0"

REM ============================================================
REM  폰에서 볼 폴더 (원하면 아래 한 줄만 바꾸세요)
REM  예)  set "ROOT=D:\공유폴더"
REM ============================================================
set "ROOT=%USERPROFILE%\Desktop"

REM ============================================================
REM  PIN 고정 (매번 바뀌는 게 싫으면 여기에 원하는 숫자를 넣으세요)
REM  예)  set "PIN=2580"   (비워두면 실행할 때마다 랜덤)
REM ============================================================
set "PIN="

echo.
echo ============================================
echo    브로가드 PC 리모컨
echo ============================================
echo.

REM 파이썬 찾기 (python 우선, 없으면 py 런처)
set "PY=python"
where python >nul 2>&1 || set "PY=py"
%PY% --version >nul 2>&1
if errorlevel 1 (
  echo [!] 파이썬을 찾지 못했어요.
  echo     https://www.python.org/downloads/ 에서 설치하세요.
  echo     설치할 때 "Add Python to PATH" 를 꼭 체크하세요!
  echo.
  pause
  exit /b
)

echo 필요한 구성요소를 확인/설치합니다. (처음 한 번만 조금 걸려요)
%PY% -m pip install --quiet --upgrade mss pillow pyautogui
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
if defined PIN (set "PINARG=--pin %PIN%") else (set "PINARG=")
%PY% "%~dp0pc_remote.py" --root "%ROOT%" %PINARG%

echo.
pause
