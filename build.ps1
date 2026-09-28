# Baut aus src/ und vendor/ die eigenständige Datei "Bohrpfahl-Verwaltung.html".
# Aufruf:  powershell -ExecutionPolicy Bypass -File build.ps1
$root = $PSScriptRoot
$html = [IO.File]::ReadAllText("$root\src\index.html", [Text.Encoding]::UTF8)

$inline = [System.Text.RegularExpressions.MatchEvaluator] {
    param($m)
    $js = [IO.File]::ReadAllText((Join-Path $root $m.Groups[1].Value), [Text.Encoding]::UTF8)
    $js -replace '</script', '<\/script'
}
$html = [regex]::Replace($html, '<!--INLINE:(.+?)-->', $inline)

$out = Join-Path $root 'Bohrpfahl-Verwaltung.html'
[IO.File]::WriteAllText($out, $html, (New-Object Text.UTF8Encoding($false)))
"{0} ({1:N0} KB)" -f $out, ((Get-Item $out).Length / 1KB)
