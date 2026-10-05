# Starts the gemini-web-to-api bridge with YOUR Gemini cookie, then checks that it really works.
# The cookie is typed into this prompt only (hidden); it is never saved to the project or printed.
#
# Get the cookie: Chrome -> https://gemini.google.com (signed in) -> F12 -> Network -> reload ->
# click the first request -> Request Headers -> copy the whole value of "cookie".
$secure = Read-Host "Paste the full Cookie header value (input is hidden)" -AsSecureString
$cookie = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim().Trim('"')
if ($cookie.Length -lt 200 -or $cookie -notmatch '__Secure-1PSID') {
  Write-Host "That does not look like a full Google cookie header ($($cookie.Length) characters, no __Secure-1PSID)." -ForegroundColor Red
  Write-Host "Copy the whole 'cookie' request header from a gemini.google.com request, not a single cookie."
  exit 1
}
docker rm -f gemini-web-to-api 2>$null | Out-Null
docker run -d --name gemini-web-to-api --restart unless-stopped -p 127.0.0.1:4981:4981 -e "GEMINI_COOKIES=$cookie" ghcr.io/ntthanh2603/gemini-web-to-api:latest | Out-Null
$cookie = $null
Write-Host "Waiting for the bridge to sign in..."
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 3
  try {
    $models = Invoke-RestMethod -Uri http://127.0.0.1:4981/openai/v1/models -TimeoutSec 5
    if ($models.data -and $models.data.Count -gt 0) {
      Write-Host "Gemini Web bridge is working. Models: $(($models.data | ForEach-Object { $_.id }) -join ', ')" -ForegroundColor Green
      exit 0
    }
  } catch { }
}
Write-Host "The bridge started but is not signed in. Last log lines:" -ForegroundColor Yellow
docker logs --tail 6 gemini-web-to-api
Write-Host "If it says the cookie is invalid or expired, copy a fresh cookie header and run this script again."
exit 1
