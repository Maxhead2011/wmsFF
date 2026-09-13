# FIX: Windows PowerShell 5 must send UTF-8 bytes, not an implicitly ANSI-encoded JSON string.
function Read-Config {
  if ($null -ne $script:setupConfig) { return $script:setupConfig }
  Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Invoke-WmsJson($method, $uri, $body, $headers = @{}) {
  $request = @{ Method = $method; Uri = $uri; Headers = $headers; ContentType = 'application/json; charset=utf-8'; TimeoutSec = 30 }
  if ($null -ne $body) { $request.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10)) }
  Invoke-RestMethod @request
}
function Invoke-WmsApi($method, $path, $body = $null) {
  $cfg = Read-Config
  # One expired-token retry only; a bad login must never cause an infinite recursion.
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    if (-not $script:token) {
      $auth = Invoke-WmsJson Post "$($cfg.server)/api/v1/auth/login" @{ email = $cfg.login; password = $cfg.password }
      $script:token = $auth.accessToken
      if (-not $script:token) { throw 'WMS did not return an access token.' }
    }
    try { return Invoke-WmsJson $method "$($cfg.server)/api/v1$path" $body @{ Authorization = "Bearer $script:token" } }
    catch {
      if ($attempt -eq 0 -and $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401) { $script:token = $null; continue }
      throw
    }
  }
}
