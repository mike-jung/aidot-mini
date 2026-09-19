param(
  [Parameter(Mandatory=$true)][string]$MinimalInstaller,
  [Parameter(Mandatory=$true)][string]$FullInstaller,
  [string]$Phase = 'all'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AidotQaWindows {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$Work = Join-Path $env:LOCALAPPDATA 'aidot-mini-release-work'
$Unicode = [string][char]0xAC80 + [string][char]0xC99D
$Install = Join-Path $Work ('program ' + $Unicode)
$State = Join-Path $Work ('data ' + $Unicode)
$Evidence = Join-Path $Work 'windows-qa-evidence'
$AppKey = 'HKCU:\Software\AidotLink\aidot-mini'
$UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\aidot-mini'
$Node = Join-Path $Install 'runtime\node.exe'
$Launcher = Join-Path $Install 'app\deploy\installed\launch.mjs'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'aidot-mini\aidot-mini.lnk'
$Port = 23981
$Origin = 'http://127.0.0.1:' + $Port
New-Item -ItemType Directory -Path $Evidence -Force | Out-Null
$Results = [System.Collections.Generic.List[object]]::new()
function Record([string]$Name, $Details = $true) {
  $entry = [ordered]@{test=$Name; passed=$true; details=$Details; time=[DateTime]::UtcNow.ToString('o')}
  $Results.Add($entry)
  $entry | ConvertTo-Json -Depth 6 -Compress | Add-Content -LiteralPath (Join-Path $Evidence 'results.jsonl') -Encoding UTF8
  Write-Output ('PASS ' + $Name)
}
function Assert($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Native([string]$File, [string[]]$Arguments, [string]$InputText = '') {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName=$File; $start.Arguments=($Arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -join ' '
  $start.UseShellExecute=$false; $start.CreateNoWindow=$true
  $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true; $start.RedirectStandardInput=$true
  $process=[Diagnostics.Process]::new(); $process.StartInfo=$start; [void]$process.Start()
  if ($InputText) { $process.StandardInput.Write($InputText) }; $process.StandardInput.Close()
  $stdoutTask=$process.StandardOutput.ReadToEndAsync(); $stderrTask=$process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(120000)) { throw "Native process timeout: $File (PID $($process.Id))" }
  $stdout=$stdoutTask.Result; $stderr=$stderrTask.Result
  if ($process.ExitCode -ne 0) { throw "Native command failed ($($process.ExitCode)): $stdout $stderr" }
  return $stdout
}
function ActiveProcess($Process) {
  if ($script:InstallerParent -eq $Process.Id -and $script:InstallerChild) { return $script:InstallerChild }
  $Process.Refresh()
  if ($Process.HasExited) {
    $children=Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $Process.Id)
    foreach($child in $children) {
      $candidate=Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
      if($candidate -and $candidate.MainWindowTitle -like '*aidot-mini*') {
        $script:InstallerParent=$Process.Id; $script:InstallerChild=$candidate; return $candidate
      }
    }
  }
  return $Process
}
function Window($Process) {
  $Process=ActiveProcess $Process
  for ($i=0; $i -lt 100; $i++) {
    $Process=ActiveProcess $Process
    $Process.Refresh()
    if ($Process.HasExited) { throw "Installer exited early: $($Process.ExitCode)" }
    if ($Process.MainWindowHandle -ne 0) { return [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle) }
    Start-Sleep -Milliseconds 200
  }
  throw 'Installer window was not available'
}
function Controls($Window, [Windows.Automation.ControlType]$Type) {
  $class=switch($Type.ProgrammaticName){
    'ControlType.Button' {'Button'}
    'ControlType.CheckBox' {'Button'}
    'ControlType.Edit' {'Edit'}
    'ControlType.ComboBox' {'ComboBox'}
    default {''}
  }
  return @($Window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) | Where-Object {$_.Current.ClassName -eq $class})
}
function Click($Element) {
  $handle=[IntPtr]$Element.Current.NativeWindowHandle
  $parent=[AidotQaWindows]::GetParent($handle)
  [void][AidotQaWindows]::PostMessage($parent,0x111,[IntPtr][int]$Element.Current.AutomationId,$handle)
}
function Next($Process) {
  for($attempt=0;$attempt -lt 100;$attempt++) {
    $window=Window $Process
    $button=(Controls $window ([Windows.Automation.ControlType]::Button) | Where-Object { $_.Current.AutomationId -eq '1' -and $_.Current.IsEnabled } | Select-Object -First 1)
    if($button){ Click $button; Start-Sleep -Milliseconds 350; return }
    Start-Sleep -Milliseconds 100
  }
  throw 'Installer next button was not available'
}
function Screenshot($Process, [string]$Name) {
  $window=Window $Process; $handle=[IntPtr]$window.Current.NativeWindowHandle
  $rect=[AidotQaWindows+RECT]::new(); [void][AidotQaWindows]::GetWindowRect($handle,[ref]$rect)
  $bitmap=[Drawing.Bitmap]::new(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
  $graphics=[Drawing.Graphics]::FromImage($bitmap); $dc=$graphics.GetHdc()
  try { [void][AidotQaWindows]::PrintWindow($handle,$dc,2) } finally { $graphics.ReleaseHdc($dc) }
  $bitmap.Save((Join-Path $Evidence ($Name+'.png')),[Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
  $window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) |
    ForEach-Object { [pscustomobject]@{name=$_.Current.Name; id=$_.Current.AutomationId; type=$_.Current.ControlType.ProgrammaticName} } |
    ConvertTo-Json -Depth 3 | Set-Content (Join-Path $Evidence ($Name+'.ui.json')) -Encoding UTF8
}
function WaitInstalled($Process) {
  for ($i=0;$i -lt 600;$i++) {
    $Process=ActiveProcess $Process
    $Process.Refresh()
    if ($Process.HasExited) { if($null -ne $Process.ExitCode){Assert ($Process.ExitCode -eq 0) 'Installer failed'}; return }
    $window=Window $Process
    $finish=(Controls $window ([Windows.Automation.ControlType]::Button) | Where-Object { $_.Current.Name -match 'Finish|Close' -and $_.Current.IsEnabled } | Select-Object -First 1)
    if ($finish) { Screenshot $Process 'install-completed'; Click $finish; [void]$Process.WaitForExit(10000); if($null -ne $Process.ExitCode){Assert ($Process.ExitCode -eq 0) 'Installer did not exit successfully'}; return }
    Start-Sleep -Milliseconds 200
  }
  throw 'Installer completion timeout'
}
function SilentInstall([string]$Exe) {
  $process=Start-Process -FilePath $Exe -ArgumentList ('/S /STATE_DIR="'+$State+'" /D='+$Install) -PassThru
  Assert ($process.WaitForExit(180000)) 'Silent installer timed out'
  Assert ($process.ExitCode -eq 0) ('Silent installer failed with exit '+$process.ExitCode)
}
function Config { return Get-Content -LiteralPath (Join-Path $State 'config\installation.json') -Raw | ConvertFrom-Json }
function WaitApi {
  for ($i=0; $i -lt 180; $i++) {
    try { $result=Invoke-RestMethod ($Origin+'/api/product/paged?perPage=1') -TimeoutSec 2; if ($result.code -eq 200) { return $result } } catch {}
    Start-Sleep -Milliseconds 300
  }
  throw 'Installed API did not become ready'
}
function StopApi { [void](Native $Node @($Launcher,'stop','--data-dir',$State)) }
function GuiInstall {
  Assert (-not(Test-Path $AppKey)) 'An existing aidot-mini registration must not be changed by this test'
  Assert (-not(Test-Path $UninstallKey)) 'An existing aidot-mini uninstaller must not be changed by this test'
  Assert (-not(Test-Path $Install)) 'Test application path must be absent'
  Assert (-not(Test-Path $State)) 'Test data path must be absent'
  $invalid=Start-Process -FilePath $MinimalInstaller -ArgumentList ('/S /PORT=0 /STATE_DIR="'+$State+'" /D='+$Install) -PassThru
  Assert ($invalid.WaitForExit(60000)) 'Invalid-port silent installer blocked'
  Assert ($invalid.ExitCode -eq 2) 'Invalid port was not rejected'
  Assert (-not(Test-Path $State) -and -not(Test-Path $Install)) 'Invalid configuration modified data or application folders'
  Record 'Silent invalid port rejected before installation without blocking dialog'
  $process=Start-Process -FilePath $MinimalInstaller -ArgumentList ('/STATE_DIR="'+$State+'" /D='+$Install) -PassThru
  [void](Window $process); Next $process; Next $process; Next $process
  $window=Window $process
  $edits=Controls $window ([Windows.Automation.ControlType]::Edit)
  Assert ($edits.Count -eq 2) 'Configuration page must contain exactly port and database inputs'
  [void][AidotQaWindows]::SendMessage([IntPtr]$edits[0].Current.NativeWindowHandle,0xC,[IntPtr]0,[string]$Port)
  [void][AidotQaWindows]::SendMessage([IntPtr]$edits[1].Current.NativeWindowHandle,0xC,[IntPtr]0,'windows-qa.sqlite')
  $combo=(Controls $window ([Windows.Automation.ControlType]::ComboBox))[0]
  [void][AidotQaWindows]::SendMessage([IntPtr]$combo.Current.NativeWindowHandle,0x14E,[IntPtr]1,[IntPtr]0)
  Screenshot $process 'initial-configuration'
  Next $process; WaitInstalled $process
  $config=Config
  Assert ($config.port -eq $Port -and $config.database -eq 'windows-qa.sqlite' -and $config.profile -eq 'product') 'Wizard settings were not saved correctly'
  Assert (Test-Path $Shortcut) 'Start menu shortcut missing'
  $link=(New-Object -ComObject WScript.Shell).CreateShortcut($Shortcut)
  Assert ($link.WorkingDirectory -eq $Install) 'Shortcut points at a temporary working directory'
  $configureLink=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'aidot-mini\Configure aidot-mini.lnk'))
  Assert ($configureLink.TargetPath -like '*\cmd.exe' -and $configureLink.Arguments -match '^/K call ') 'Configure shortcut must retain the settings terminal'
  Assert ((Get-ItemProperty $AppKey).StateDir -eq $State) 'Registered data directory differs'
  Record 'GUI initial port/database/profile; Unicode application and data paths' @{port=$config.port; database=$config.database; profile=$config.profile; app=$Install; data=$State}
}
function Runtime {
  StopApi
  $credentials=@{username='windows-qa-admin'; password=('Qa!'+[Guid]::NewGuid().ToString('N'))}
  [void](Native $Node @($Launcher,'account','--stdin','--reset','--data-dir',$State) ($credentials|ConvertTo-Json -Compress))
  $before=@{}; Get-ChildItem -LiteralPath $Install -File -Recurse | ForEach-Object { $before[$_.FullName]=(Get-FileHash $_.FullName -Algorithm SHA256).Hash; $_.IsReadOnly=$true }
  Start-Process -FilePath $Shortcut | Out-Null
  [void](WaitApi)
  $unauthorized=0
  try { Invoke-RestMethod ($Origin+'/api/product') -Method Post -ContentType 'application/json' -Body '{"name":"unauthorized","price":10}' | Out-Null } catch { $unauthorized=[int]$_.Exception.Response.StatusCode }
  Assert ($unauthorized -eq 401) 'Anonymous Product write was not rejected'
  $login=Invoke-RestMethod ($Origin+'/admin/login') -Method Post -ContentType 'application/json' -Body ($credentials|ConvertTo-Json -Compress) -SessionVariable apiSession
  Assert ($login.data.csrfToken) 'Admin login did not issue session/CSRF credentials'
  $headers=@{'X-CSRF-Token'=$login.data.csrfToken}
  $created=Invoke-RestMethod ($Origin+'/api/product') -Method Post -ContentType 'application/json' -Headers $headers -WebSession $apiSession -Body '{"name":"Windows QA","price":1234,"memo":"native installed execution"}'
  $id=$created.data.insertId; Assert ($id -gt 0) 'Product insert failed'
  $item=Invoke-RestMethod ($Origin+'/api/product/'+$id); Assert ($item.data.name -eq 'Windows QA') 'Product read failed'
  $updated=Invoke-RestMethod ($Origin+'/api/product/'+$id) -Method Put -ContentType 'application/json' -Headers $headers -WebSession $apiSession -Body '{"name":"Windows QA updated","price":2345,"memo":"updated"}'
  $item=Invoke-RestMethod ($Origin+'/api/product/'+$id); Assert ($item.data.price -eq 2345) 'Product update failed'
  [void](Invoke-RestMethod ($Origin+'/api/product/'+$id) -Method Delete -Headers $headers -WebSession $apiSession)
  $missing=0; try { Invoke-RestMethod ($Origin+'/api/product/'+$id)|Out-Null } catch { $missing=[int]$_.Exception.Response.StatusCode }
  Assert ($missing -eq 404) 'Product delete failed'
  StopApi
  Get-ChildItem -LiteralPath $Install -File -Recurse | ForEach-Object { Assert ($before[$_.FullName] -eq (Get-FileHash $_.FullName -Algorithm SHA256).Hash) ('Runtime changed installed code: '+$_.Name); $_.IsReadOnly=$false }
  Assert (Test-Path (Join-Path $State 'db\windows-qa.sqlite')) 'Database was not written in AppData state'
  Assert ((Get-ChildItem (Join-Path $State 'cache') -Recurse -File).Count -gt 0) 'Compilation cache not in state folder'
  Assert (@(Get-ChildItem (Join-Path $State 'logs') -File | Where-Object {$_.Name -ne 'installer.log'}).Count -gt 0) 'Runtime log files were not stored in AppData'
  Set-Content (Join-Path $State 'workspaces\product\qa-preserve.txt') 'user workspace edit' -Encoding UTF8
  Record 'Actual shortcut launch with read-only code; AppData DB/cache/log writes; login and Product CRUD' @{requests=8; anonymousWrite=401; deletedRead=404}
}
function Upgrade {
  $before=Config; $dbHash=(Get-FileHash (Join-Path $State 'db\windows-qa.sqlite')).Hash
  SilentInstall $FullInstaller
  $after=Config
  Assert ($after.port -eq $before.port -and $after.database -eq $before.database -and $after.profile -eq $before.profile -and $after.installationId -eq $before.installationId) 'Upgrade changed existing configuration'
  Assert ((Get-Content (Join-Path $State 'workspaces\product\qa-preserve.txt') -Raw).Trim() -eq 'user workspace edit') 'Upgrade overwrote user source'
  Assert ((Get-FileHash (Join-Path $State 'db\windows-qa.sqlite')).Hash -eq $dbHash) 'Upgrade changed database bytes'
  Start-Process -FilePath $Shortcut | Out-Null; [void](WaitApi)
  $console=Invoke-WebRequest $Origin -UseBasicParsing; Assert ($console.StatusCode -eq 200 -and $console.Content -match '<html') 'Minimal-to-Full upgrade did not install the console'
  StopApi
  Record 'Full upgrade preserves configuration, DB and workspace; console becomes available'
}
function Uninstall([bool]$PurgeData) {
  $uninstaller=Join-Path $Install 'uninstall.exe'
  $argument=''
  if(-not $PurgeData){Set-Content (Join-Path $Install 'qa-unrelated.keep') 'unrelated QA fixture' -Encoding UTF8}
  if($argument){$process=Start-Process -FilePath $uninstaller -ArgumentList $argument -PassThru}
  else {$process=Start-Process -FilePath $uninstaller -PassThru}
  Start-Sleep -Milliseconds 400
  [void](Window $process); Next $process
  $window=Window $process; $check=(Controls $window ([Windows.Automation.ControlType]::CheckBox) | Where-Object {$_.Current.Name -like 'Remove all*'} | Select-Object -First 1)
  $checked=[AidotQaWindows]::SendMessage([IntPtr]$check.Current.NativeWindowHandle,0xF0,[IntPtr]0,[IntPtr]0).ToInt32()
  if($PurgeData){ if($checked -ne 1){[void][AidotQaWindows]::SendMessage([IntPtr]$check.Current.NativeWindowHandle,0xF1,[IntPtr]1,[IntPtr]0)} }
  else { Assert ($checked -eq 0) 'Default uninstall unexpectedly removes data' }
  Screenshot $process $(if($PurgeData){'uninstall-purge'}else{'uninstall-keep-data'})
  Next $process; WaitInstalled $process
  for($i=0;$i -lt 50 -and (Test-Path $uninstaller);$i++){Start-Sleep -Milliseconds 100}
  Assert (-not(Test-Path $AppKey) -and -not(Test-Path $UninstallKey)) 'Uninstall left application registry keys'
  Assert (-not(Test-Path $Shortcut)) 'Uninstall left a Start menu shortcut'
  Assert (-not(Test-Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'aidot-mini.lnk'))) 'Uninstall left a desktop shortcut'
  Assert (-not(Test-Path (Join-Path $Install 'runtime\node.exe'))) 'Uninstall left runtime files'
  if($PurgeData){ Assert (-not(Test-Path $State)) 'Purge left application state'; Assert (-not(Test-Path $Install)) 'Purge left installation files'; Record 'GUI explicit purge removes every owned data/application folder, shortcut and registry key' }
  else {
    Assert (Test-Path (Join-Path $State 'db\windows-qa.sqlite')) 'Default uninstall removed the DB'
    Assert (Test-Path (Join-Path $Install 'qa-unrelated.keep')) 'Uninstall removed an unrelated application-folder file'
    Remove-Item -LiteralPath (Join-Path $Install 'qa-unrelated.keep')
    Remove-Item -LiteralPath $Install
    Record 'GUI default uninstall retains application data and unrelated files'
  }
}
try {
  if($Phase -in @('all','install')){GuiInstall}
  if($Phase -in @('all','runtime')){Runtime}
  if($Phase -in @('all','upgrade')){Upgrade}
  if($Phase -in @('all','keep')){Uninstall $false}
  if($Phase -in @('all','reinstall')){
    SilentInstall $FullInstaller
    Assert ((Config).port -eq $Port -and (Config).profile -eq 'product') 'Reinstall did not recover retained settings'
    Assert (Test-Path (Join-Path $State 'workspaces\product\qa-preserve.txt')) 'Reinstall removed retained workspace edit'
    Record 'Reinstall recognizes retained configuration and workspace'
  }
  if($Phase -in @('all','purge')){Uninstall $true}
  $Results | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $Evidence ('summary-'+$Phase+'.json')) -Encoding UTF8
  if($Phase -ne 'resume' -and $Phase -ne 'inspect'){Write-Output 'WINDOWS_QA_PASS'}
} catch {
  [pscustomobject]@{passed=$false; error=$_.Exception.Message; stack=$_.ScriptStackTrace; time=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $Evidence 'failure.json') -Encoding UTF8
  Write-Error $_
  exit 1
}
