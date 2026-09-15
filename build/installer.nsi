Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "WinVer.nsh"
!include "StdUtils.nsh"
Name "Alder ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Alder"
InstallDirRegKey HKCU "Software\Alder\Installer" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
BrandingText "Alder"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "Alder"
VIAddVersionKey /LANG=1033 "FileDescription" "Alder Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright (c) 6AE slayer"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Var testMode

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Alder requires 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Alder requires Windows 10 or later." /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $testMode "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/TEST" $R1
  ${IfNot} ${Errors}
    StrCpy $testMode "1"
  ${EndIf}
FunctionEnd

Function CheckInstallDirectory
  ReadINIStr $R0 "$INSTDIR\.alder-install.ini" "Alder" "Product"
  ${If} $R0 == "org.alder.language"
    Return
  ${EndIf}
  FindFirst $R0 $R1 "$INSTDIR\*"
  loop:
    StrCmp $R1 "" done
    StrCmp $R1 "." next
    StrCmp $R1 ".." next
    FindClose $R0
    MessageBox MB_OK|MB_ICONSTOP "Choose an empty folder for Alder." /SD IDOK
    Abort
  next:
    FindNext $R0 $R1
    Goto loop
  done:
    FindClose $R0
FunctionEnd

Section "Alder" Main
  AddSize ${INSTALL_SIZE_KB}
  Call CheckInstallDirectory
  IfFileExists "$INSTDIR\Alder.exe" 0 unlocked
  ClearErrors
  FileOpen $0 "$INSTDIR\Alder.exe" a
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Close Alder before installing this version." /SD IDOK
    SetErrorLevel 4
    Abort
  ${EndIf}
  FileClose $0
  unlocked:
  DetailPrint "Verifying Alder installation data..."
  ${StdUtils.HashFile} $0 "SHA2-256" "$EXEDIR\${PAYLOAD}"
  ${If} $0 != "${PAYLOAD_HASH}"
    MessageBox MB_OK|MB_ICONSTOP "The Alder data file is missing or damaged. Keep ${PAYLOAD} beside this installer and try again." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=7za.exe "${SEVENZIP}"
  DetailPrint "Installing Alder and its offline speech resources..."
  nsExec::ExecToLog '"$PLUGINSDIR\7za.exe" x "$EXEDIR\${PAYLOAD}" "-o$INSTDIR" -y -bsp0'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Alder could not finish extracting its files. Check free disk space and try again." /SD IDOK
    SetErrorLevel 3
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  WriteINIStr "$INSTDIR\.alder-install.ini" "Alder" "Product" "org.alder.language"
  WriteINIStr "$INSTDIR\.alder-install.ini" "Alder" "TestMode" "$testMode"
  File /oname=Installer-Third-Party-Notices.txt "${NOTICES}"
  WriteUninstaller "$INSTDIR\Uninstall Alder.exe"
  ${If} $testMode != "1"
    CreateDirectory "$SMPROGRAMS\Alder"
    CreateShortcut "$SMPROGRAMS\Alder\Alder.lnk" "$INSTDIR\Alder.exe"
    WriteRegStr HKCU "Software\Alder\Installer" "InstallDir" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "DisplayName" "Alder"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "Publisher" "Alder"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "UninstallString" '$\"$INSTDIR\Uninstall Alder.exe$\"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "QuietUninstallString" '$\"$INSTDIR\Uninstall Alder.exe$\" /S'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "DisplayIcon" "$INSTDIR\Alder.exe,0"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "InstallLocation" "$INSTDIR"
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "EstimatedSize" ${INSTALL_SIZE_KB}
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder" "NoRepair" 1
  ${EndIf}
SectionEnd

Function un.onInit
  SetRegView 64
  ReadINIStr $0 "$INSTDIR\.alder-install.ini" "Alder" "Product"
  ${If} $0 != "org.alder.language"
    MessageBox MB_OK|MB_ICONSTOP "Alder's installation marker is missing. Uninstall has stopped." /SD IDOK
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\Alder.exe" 0 unlocked
  ClearErrors
  FileOpen $0 "$INSTDIR\Alder.exe" a
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Close Alder before uninstalling it." /SD IDOK
    Abort
  ${EndIf}
  FileClose $0
  unlocked:
  ReadINIStr $testMode "$INSTDIR\.alder-install.ini" "Alder" "TestMode"
FunctionEnd

Section "Uninstall"
  !include "${FILE_MANIFEST}"
  Delete "$INSTDIR\Installer-Third-Party-Notices.txt"
  Delete "$INSTDIR\.alder-install.ini"
  Delete "$INSTDIR\Uninstall Alder.exe"
  RMDir "$INSTDIR"
  ${If} $testMode != "1"
    ReadRegStr $0 HKCU "Software\Alder\Installer" "InstallDir"
    ${If} $0 == $INSTDIR
      Delete "$SMPROGRAMS\Alder\Alder.lnk"
      RMDir "$SMPROGRAMS\Alder"
      DeleteRegKey HKCU "Software\Alder\Installer"
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Alder"
    ${EndIf}
  ${EndIf}
SectionEnd
