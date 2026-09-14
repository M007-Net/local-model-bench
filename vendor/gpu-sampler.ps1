# Emits one compact JSON line per tick describing every GPU the sensor library reports.
# Values that a card does not expose stay null; the benchmark records them as unavailable.
param([Parameter(Mandatory=$true)][string]$Dll,[int]$IntervalMs=1000,[double]$MaxMinutes=720)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
function Emit([string]$line){[Console]::Out.WriteLine($line);[Console]::Out.Flush()}
function Esc([string]$text){return ($text -replace '\\','\\\\' -replace '"','\"')}
function Num($value){if($null -eq $value){return 'null'};$d=[double]$value;if([double]::IsNaN($d) -or [double]::IsInfinity($d)){return 'null'};return $d.ToString('0.###',[Globalization.CultureInfo]::InvariantCulture)}
function Fail([string]$message){Emit ('{"error":"'+(Esc $message)+'"}');exit 1}
try{Add-Type -Path $Dll}catch{Fail ('Sensor library could not be loaded: '+$_.Exception.Message)}
try{$computer=New-Object LibreHardwareMonitor.Hardware.Computer;$computer.IsGpuEnabled=$true;$computer.Open()}catch{Fail ('Sensor library could not open hardware: '+$_.Exception.Message)}
$gpus=@($computer.Hardware|Where-Object{$_.HardwareType -like 'Gpu*'})
if($gpus.Count -eq 0){try{$computer.Close()}catch{};Fail 'No GPU was reported by the sensor library.'}
function Sensor($hardware,$type,$names){foreach($name in $names){$sensor=$hardware.Sensors|Where-Object{$_.SensorType -eq $type -and $_.Name -eq $name}|Select-Object -First 1;if($sensor -and $null -ne $sensor.Value){return $sensor.Value}}return $null}
Emit ('{"ready":true,"devices":['+(($gpus|ForEach-Object{'"'+(Esc $_.Name)+'"'}) -join ',')+']}')
$deadline=(Get-Date).AddMinutes($MaxMinutes)
try{
 while((Get-Date) -lt $deadline){
  $parts=@()
  foreach($hardware in $gpus){
   try{$hardware.Update()}catch{}
   $parts+='{"n":"'+(Esc $hardware.Name)+
    '","tc":'+(Num (Sensor $hardware 'Temperature' @('GPU Core')))+
    ',"th":'+(Num (Sensor $hardware 'Temperature' @('GPU Hot Spot')))+
    ',"tm":'+(Num (Sensor $hardware 'Temperature' @('GPU Memory')))+
    ',"p":'+(Num (Sensor $hardware 'Power' @('GPU Package','GPU Core')))+
    ',"l":'+(Num (Sensor $hardware 'Load' @('GPU Core')))+
    ',"ck":'+(Num (Sensor $hardware 'Clock' @('GPU Core')))+
    ',"f":'+(Num (Sensor $hardware 'Fan' @('GPU Fan')))+
    ',"mu":'+(Num (Sensor $hardware 'SmallData' @('GPU Memory Used','D3D Dedicated Memory Used')))+
    ',"mt":'+(Num (Sensor $hardware 'SmallData' @('GPU Memory Total','D3D Dedicated Memory Total')))+'}'
  }
  Emit ('{"t":'+[long][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+',"g":['+($parts -join ',')+']}')
  Start-Sleep -Milliseconds $IntervalMs
 }
}finally{try{$computer.Close()}catch{}}
