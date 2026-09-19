; Compile using the release builder; it supplies the exact payload and file manifest.
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef PAYLOAD
  !error "PAYLOAD must name the Windows release staging directory"
!endif
!ifndef VERSION
  !define VERSION "1.0.9"
!endif
!ifndef EDITION
  !define EDITION "minimal"
!endif
!ifndef OUTFILE
  !error "OUTFILE must name the installer .exe"
!endif
!ifndef UNINSTALL_MANIFEST
  !error "Generate UNINSTALL_MANIFEST with create-uninstall-manifest.py"
!endif
!include "${UNINSTALL_MANIFEST}"

!define APPKEY "Software\AidotLink\aidot-mini"
!define UNINSTALLKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\aidot-mini"
!define PRODUCT "aidot-mini"

Name "aidot-mini ${VERSION} (${EDITION})"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\aidot-mini"
InstallDirRegKey HKCU "${APPKEY}" "InstallLocation"
BrandingText "aidot-mini | minimal aidot-express-compatible runtime"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductName" "aidot-mini"
VIAddVersionKey /LANG=1033 "CompanyName" "Aidot Link Co., Ltd."
VIAddVersionKey /LANG=1033 "FileDescription" "aidot-mini per-user setup (${EDITION})"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Aidot Link Co., Ltd."
ShowInstDetails show
ShowUninstDetails show

Var StateDir
Var PreviousInstall
Var Port
Var Database
Var WorkspaceProfile
Var Params
Var Options
Var Result
Var Output
Var Dialog
Var PortInput
Var DatabaseInput
Var WorkspaceProfileInput
Var PurgeInput
Var Purge
Var LogHandle

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "aidot-mini ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Install the ${EDITION} runtime for this Windows user.$\r$\n$\r$\nNo administrator account, separate Node.js installation or database server is required.$\r$\n$\r$\nApplication code and your writable data are stored separately under your local AppData folder."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\app\LICENSE"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateInstallDirectory
!insertmacro MUI_PAGE_DIRECTORY
Page custom SettingsPage SettingsLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "aidot-mini is installed.$\r$\n$\r$\nUse the Start menu shortcut to start the local API. Setup does not enable automatic startup or open the firewall.$\r$\n$\r$\nUse Configure aidot-mini to view or change settings. Databases, workspaces, uploads and logs stay in your data folder."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_WELCOME
UninstPage custom un.DataPage un.DataLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "This release requires 64-bit Windows." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\setup\runtime"
  File /oname=node.exe "${PAYLOAD}\runtime\node.exe"
  SetOutPath "$PLUGINSDIR\setup\app\deploy\installed"
  File /oname=lifecycle.mjs "${PAYLOAD}\app\deploy\installed\lifecycle.mjs"
  SetOutPath "$PLUGINSDIR\setup\app\deploy\windows"
  File /oname=setup-helper.mjs "${PAYLOAD}\app\deploy\windows\setup-helper.mjs"
  StrCpy $Port "8901"
  StrCpy $Database "app.db"
  StrCpy $WorkspaceProfile "note"
  StrCpy $StateDir "$LOCALAPPDATA\aidot-mini"
  ReadRegStr $PreviousInstall HKCU "${APPKEY}" "InstallLocation"
  ReadRegStr $0 HKCU "${APPKEY}" "StateDir"
  ${If} $0 != ""
    StrCpy $StateDir $0
  ${EndIf}
  ${GetParameters} $Params
  ClearErrors
  ${GetOptions} $Params "/STATE_DIR=" $0
  ${IfNot} ${Errors}
    ${If} $PreviousInstall != ""
    ${AndIf} $0 != $StateDir
      MessageBox MB_ICONSTOP "An upgrade cannot move the existing data folder. Uninstall while keeping data, then reinstall with the intended folder." /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    StrCpy $StateDir $0
  ${EndIf}
  ; Read the real configuration, including edits made after the last installation.
  IfFileExists "$StateDir\.aidot-mini-owned.json" 0 config_read_done
    nsExec::ExecToStack /TIMEOUT=30000 '"$PLUGINSDIR\setup\runtime\node.exe" "$PLUGINSDIR\setup\app\deploy\windows\setup-helper.mjs" config-ini --data-dir "$StateDir" --output "$PLUGINSDIR\settings.ini"' 
    Pop $Result
    Pop $Output
    ${If} $Result != "0"
      Goto config_read_failed
    ${EndIf}
    ReadINIStr $Port "$PLUGINSDIR\settings.ini" "aidot-mini" "port"
    ReadINIStr $Database "$PLUGINSDIR\settings.ini" "aidot-mini" "database"
    ReadINIStr $WorkspaceProfile "$PLUGINSDIR\settings.ini" "aidot-mini" "profile"
  Goto config_read_done
config_read_failed:
  MessageBox MB_ICONSTOP "The existing configuration could not be read. Setup has not changed it.$\r$\n$Output" /SD IDOK
  SetErrorLevel 2
  Quit
config_read_done:
  ClearErrors
  ${GetOptions} $Params "/PORT=" $0
  ${IfNot} ${Errors}
    StrCpy $Port $0
  ${EndIf}
  ClearErrors
  ${GetOptions} $Params "/DATABASE=" $0
  ${IfNot} ${Errors}
    StrCpy $Database $0
  ${EndIf}
  ClearErrors
  ${GetOptions} $Params "/PROFILE=" $0
  ${IfNot} ${Errors}
    StrCpy $WorkspaceProfile $0
  ${EndIf}
FunctionEnd

Function ValidateInstallDirectory
  ${If} $PreviousInstall != ""
  ${AndIf} $PreviousInstall != $INSTDIR
    MessageBox MB_ICONSTOP "Upgrade the existing installation at:$\r$\n$PreviousInstall$\r$\n$\r$\nUninstall it first to choose a different application folder." /SD IDOK
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\install-state.ini" existing_install
  FindFirst $0 $1 "$INSTDIR\*"
directory_loop:
  ${If} $1 == ""
    Goto directory_done
  ${EndIf}
  ${If} $1 != "."
  ${AndIf} $1 != ".."
    FindClose $0
    MessageBox MB_ICONSTOP "Choose an empty application folder. Setup will not overwrite an unrelated folder." /SD IDOK
    Abort
  ${EndIf}
  FindNext $0 $1
  Goto directory_loop
directory_done:
  FindClose $0
  Return
existing_install:
  ReadINIStr $0 "$INSTDIR\install-state.ini" "aidot-mini" "product"
  ${If} $0 != "${PRODUCT}"
    MessageBox MB_ICONSTOP "This folder is not an aidot-mini installation." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

Function SettingsPage
  !insertmacro MUI_HEADER_TEXT "Initial configuration" "Local API and SQLite settings; existing workspace files are preserved."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 12u "API port (1-65535; localhost / 127.0.0.1):"
  Pop $0
  ${NSD_CreateNumber} 0 14u 85u 13u "$Port"
  Pop $PortInput
  ${NSD_Edit_SetTextLimit} $PortInput 5
  ${NSD_CreateLabel} 0 35u 100% 12u "SQLite database filename (stored inside the data folder):"
  Pop $0
  ${NSD_CreateText} 0 49u 100% 13u "$Database"
  Pop $DatabaseInput
  ${NSD_Edit_SetTextLimit} $DatabaseInput 100
  ${NSD_CreateLabel} 0 70u 95u 12u "Initial workspace:"
  Pop $0
  ${NSD_CreateDropList} 99u 68u 120u 45u ""
  Pop $WorkspaceProfileInput
  ${NSD_CB_AddString} $WorkspaceProfileInput "note"
  ${NSD_CB_AddString} $WorkspaceProfileInput "product"
  ${NSD_CB_SelectString} $WorkspaceProfileInput "$WorkspaceProfile"
  ${NSD_CreateLabel} 0 92u 100% 32u "Writable data:$\r$\n$StateDir"
  Pop $0
  ${NSD_CreateLabel} 0 126u 100% 12u "LAN access requires separate TLS/security configuration."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ValidateSettings
  StrLen $0 $Port
  ${If} $0 == 0
    Goto bad_port
  ${EndIf}
  ${If} $0 > 5
    Goto bad_port
  ${EndIf}
  StrCpy $1 0
port_loop:
  StrCpy $2 $Port 1 $1
  ${If} $2 == ""
    Goto port_range
  ${EndIf}
  StrCmp $2 "0" port_next
  StrCmp $2 "1" port_next
  StrCmp $2 "2" port_next
  StrCmp $2 "3" port_next
  StrCmp $2 "4" port_next
  StrCmp $2 "5" port_next
  StrCmp $2 "6" port_next
  StrCmp $2 "7" port_next
  StrCmp $2 "8" port_next
  StrCmp $2 "9" port_next bad_port
port_next:
  IntOp $1 $1 + 1
  Goto port_loop
port_range:
  ; Decimal normalization is delegated to the Node validator as well.
  ${If} $Port < 1
  ${OrIf} $Port > 65535
    Goto bad_port
  ${EndIf}
  ${If} $Database == ""
    MessageBox MB_ICONSTOP "Enter a SQLite database filename." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${If} $WorkspaceProfile != "note"
  ${AndIf} $WorkspaceProfile != "product"
    MessageBox MB_ICONSTOP "Choose note or product as the workspace profile." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  Return
bad_port:
  MessageBox MB_ICONSTOP "API port must be a whole number from 1 to 65535." /SD IDOK
  SetErrorLevel 2
  Abort
FunctionEnd

Function SettingsLeave
  ${NSD_GetText} $PortInput $Port
  ${NSD_GetText} $DatabaseInput $Database
  ${NSD_GetText} $WorkspaceProfileInput $WorkspaceProfile
  Call ValidateSettings
FunctionEnd

Section "aidot-mini" MainSection
  Call ValidateInstallDirectory
  Call ValidateSettings
  ; Stage the payload first. Validation occurs before modifying an installed copy.
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD}\*"
  nsExec::ExecToStack /TIMEOUT=60000 '"$PLUGINSDIR\payload\runtime\node.exe" "$PLUGINSDIR\payload\app\deploy\windows\setup-helper.mjs" preflight --install-dir "$INSTDIR" --data-dir "$StateDir" --port "$Port" --database "$Database" --profile "$WorkspaceProfile"'
  Pop $Result
  Pop $Output
  DetailPrint "$Output"
  ${If} $Result != "0"
    MessageBox MB_ICONSTOP "Configuration validation failed. Existing files and settings have not been changed.$\r$\n$Output" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${If} $PreviousInstall != ""
    nsExec::ExecToStack /TIMEOUT=60000 '"$PreviousInstall\runtime\node.exe" "$PreviousInstall\app\deploy\installed\launch.mjs" stop --data-dir "$StateDir"'
    Pop $Result
    Pop $Output
    DetailPrint "$Output"
    ${If} $Result != "0"
      MessageBox MB_ICONSTOP "The existing server could not be stopped safely. Setup has not replaced it.$\r$\n$Output" /SD IDOK
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
  nsExec::ExecToStack /TIMEOUT=120000 '"$PLUGINSDIR\payload\runtime\node.exe" "$PLUGINSDIR\payload\app\deploy\windows\setup-helper.mjs" install --install-dir "$INSTDIR" --data-dir "$StateDir" --port "$Port" --database "$Database" --profile "$WorkspaceProfile"'
  Pop $Result
  Pop $Output
  DetailPrint "$Output"
  ${If} $Result != "0"
    MessageBox MB_ICONSTOP "Configuration could not be saved. Setup did not report success.$\r$\n$Output" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  WriteINIStr "$INSTDIR\install-state.ini" "aidot-mini" "product" "${PRODUCT}"
  WriteINIStr "$INSTDIR\install-state.ini" "aidot-mini" "version" "${VERSION}"
  WriteINIStr "$INSTDIR\install-state.ini" "aidot-mini" "edition" "${EDITION}"
  WriteINIStr "$INSTDIR\install-state.ini" "aidot-mini" "stateDir" "$StateDir"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateDirectory "$SMPROGRAMS\aidot-mini"
  CreateShortcut "$SMPROGRAMS\aidot-mini\aidot-mini.lnk" "$INSTDIR\runtime\node.exe" '$\"$INSTDIR\app\deploy\installed\launch.mjs$\" start --data-dir $\"$StateDir$\"'
  CreateShortcut "$SMPROGRAMS\aidot-mini\Configure aidot-mini.lnk" "$SYSDIR\cmd.exe" '/K call $\"$INSTDIR\configure.cmd$\" --data-dir $\"$StateDir$\"'
  CreateShortcut "$SMPROGRAMS\aidot-mini\Stop aidot-mini.lnk" "$INSTDIR\runtime\node.exe" '$\"$INSTDIR\app\deploy\installed\launch.mjs$\" stop --data-dir $\"$StateDir$\"'
  CreateShortcut "$SMPROGRAMS\aidot-mini\Uninstall aidot-mini.lnk" "$INSTDIR\uninstall.exe"
  CreateShortcut "$DESKTOP\aidot-mini.lnk" "$INSTDIR\runtime\node.exe" '$\"$INSTDIR\app\deploy\installed\launch.mjs$\" start --data-dir $\"$StateDir$\"'
  WriteRegStr HKCU "${APPKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APPKEY}" "StateDir" "$StateDir"
  WriteRegStr HKCU "${UNINSTALLKEY}" "DisplayName" "aidot-mini ${VERSION} (${EDITION})"
  WriteRegStr HKCU "${UNINSTALLKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALLKEY}" "Publisher" "Aidot Link Co., Ltd."
  WriteRegStr HKCU "${UNINSTALLKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALLKEY}" "UninstallString" '$\"$INSTDIR\uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALLKEY}" "QuietUninstallString" '$\"$INSTDIR\uninstall.exe$\" /S'
  WriteRegDWORD HKCU "${UNINSTALLKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALLKEY}" "NoRepair" 1
  CreateDirectory "$StateDir\logs"
  FileOpen $LogHandle "$StateDir\logs\installer.log" a
  FileWrite $LogHandle "Installed aidot-mini ${VERSION} (${EDITION})$\r$\nApplication: $INSTDIR$\r$\nData: $StateDir$\r$\nPort: $Port, database: $Database, profile: $WorkspaceProfile$\r$\n$Output$\r$\n"
  FileClose $LogHandle
  SetErrorLevel 0
SectionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
  StrCpy $Purge "0"
  ReadINIStr $0 "$INSTDIR\install-state.ini" "aidot-mini" "product"
  ${If} $0 != "${PRODUCT}"
    MessageBox MB_ICONSTOP "The installation marker is missing or invalid. No files were deleted." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ReadINIStr $StateDir "$INSTDIR\install-state.ini" "aidot-mini" "stateDir"
  ${If} $StateDir == ""
    MessageBox MB_ICONSTOP "The data folder is not recorded. No files were deleted." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${GetParameters} $Params
  ClearErrors
  ${GetOptions} $Params "/PURGE=" $0
  ${IfNot} ${Errors}
    ${If} $0 == "1"
      StrCpy $Purge "1"
    ${ElseIf} $0 != "0"
      MessageBox MB_ICONSTOP "Use /PURGE=1 to explicitly remove all aidot-mini data, or /PURGE=0 to keep it." /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
  ${EndIf}
FunctionEnd

Function un.DataPage
  !insertmacro MUI_HEADER_TEXT "Keep or remove your data" "The application and its shortcuts will be removed."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 34u "By default, your data is kept for a later reinstall.$\r$\n$\r$\nData folder: $StateDir"
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 32u "Remove all my settings, databases, workspaces, uploads and logs"
  Pop $PurgeInput
  ${If} $Purge == "1"
    ${NSD_Check} $PurgeInput
  ${EndIf}
  ${NSD_CreateLabel} 0 94u 100% 32u "Data deletion cannot be undone. Only this aidot-mini data folder and the exact installed application files are removed. Unrelated files and external folders are preserved."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function un.DataLeave
  ${NSD_GetState} $PurgeInput $0
  StrCpy $Purge "0"
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Purge "1"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  nsExec::ExecToStack /TIMEOUT=30000 '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\deploy\windows\setup-helper.mjs" validate-paths --install-dir "$INSTDIR" --data-dir "$StateDir"'
  Pop $Result
  Pop $Output
  ${If} $Result != "0"
    MessageBox MB_ICONSTOP "The application or data paths are unsafe. No files were deleted.$\r$\n$Output" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  StrCpy $Options ""
  ${If} $Purge == "1"
    StrCpy $Options "--purge"
  ${EndIf}
  IfFileExists "$StateDir\." state_present payload_cleanup
state_present:
  nsExec::ExecToStack /TIMEOUT=60000 '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\deploy\installed\launch.mjs" uninstall --data-dir "$StateDir" $Options'
  Pop $Result
  Pop $Output
  DetailPrint "$Output"
  ${If} $Result != "0"
    MessageBox MB_ICONSTOP "The server could not be stopped or data cleanup was refused. Application files have been kept so you can correct the problem.$\r$\n$Output" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
payload_cleanup:
  SetOutPath "$TEMP"
  !insertmacro RemoveInstalledPayload
  Delete "$INSTDIR\installation-files.json"
  Delete "$INSTDIR\install-state.ini"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\aidot-mini.lnk"
  Delete "$SMPROGRAMS\aidot-mini\aidot-mini.lnk"
  Delete "$SMPROGRAMS\aidot-mini\Configure aidot-mini.lnk"
  Delete "$SMPROGRAMS\aidot-mini\Stop aidot-mini.lnk"
  Delete "$SMPROGRAMS\aidot-mini\Uninstall aidot-mini.lnk"
  RMDir "$SMPROGRAMS\aidot-mini"
  ReadRegStr $0 HKCU "${APPKEY}" "InstallLocation"
  ${If} $0 == $INSTDIR
    DeleteRegKey HKCU "${UNINSTALLKEY}"
    DeleteRegKey HKCU "${APPKEY}"
  ${EndIf}
  SetErrorLevel 0
SectionEnd
