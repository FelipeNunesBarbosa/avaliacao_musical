param([switch]$NoBrowser)

# Servidor local para os módulos JavaScript e o modelo da ficha.
# Usa apenas PowerShell/.NET, sem instalação de pacotes.
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 8765)
$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.jpg'  = 'image/jpeg'
}

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$content) {
    $reason = if ($status -eq 200) { 'OK' } elseif ($status -eq 403) { 'Forbidden' } else { 'Not Found' }
    $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($content.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($content.Length) { $stream.Write($content, 0, $content.Length) }
}

try {
    $server.Start()
    if (-not $NoBrowser) { Start-Process 'http://localhost:8765/' }
    Write-Host 'Site disponível em http://localhost:8765/ . Pressione Ctrl+C para encerrar.'
    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $requestBytes = [System.Collections.Generic.List[byte]]::new()
            while ($requestBytes.Count -lt 8192) {
                $nextByte = $stream.ReadByte()
                if ($nextByte -lt 0) { break }
                $requestBytes.Add([byte]$nextByte)
                $count = $requestBytes.Count
                if ($count -ge 4 -and $requestBytes[$count-4] -eq 13 -and $requestBytes[$count-3] -eq 10 -and $requestBytes[$count-2] -eq 13 -and $requestBytes[$count-1] -eq 10) { break }
            }
            $request = [System.Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
            if ($request -notmatch '^GET\s+([^\s?]+)') {
                Send-Response $stream 404 'text/plain' ([byte[]]@())
                continue
            }
            $relativePath = [Uri]::UnescapeDataString($Matches[1].TrimStart('/'))
            if ([string]::IsNullOrEmpty($relativePath)) { $relativePath = 'index.html' }
            $requestedPath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relativePath))
            $rootPrefix = $projectRoot.TrimEnd('\') + '\'
            if (-not $requestedPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not [System.IO.File]::Exists($requestedPath)) {
                Send-Response $stream 404 'text/plain' ([byte[]]@())
                continue
            }
            $extension = [System.IO.Path]::GetExtension($requestedPath).ToLowerInvariant()
            if (-not $mimeTypes.ContainsKey($extension)) {
                Send-Response $stream 403 'text/plain' ([byte[]]@())
                continue
            }
            Send-Response $stream 200 $mimeTypes[$extension] ([System.IO.File]::ReadAllBytes($requestedPath))
        } finally { $client.Close() }
    }
} finally { $server.Stop() }
