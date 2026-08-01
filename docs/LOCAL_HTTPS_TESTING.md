# Local HTTPS Testing (Mobile Camera / QR Scanner)

Mobile browsers only allow camera access (`getUserMedia`) in a **secure context**:
`https://` or `localhost`. Opening the app on your phone via
`http://<your-LAN-IP>:5001` is *not* a secure context, so the QR scanner cannot
start. This guide makes the dev server speak HTTPS with a locally-trusted
certificate so the camera works on any phone on your Wi-Fi.

## How it works

`server.production.js` serves HTTPS (instead of HTTP) when two environment
variables are set:

| Variable    | Meaning                              |
|-------------|--------------------------------------|
| `HTTPS_KEY` | Path to the TLS private key (PEM)    |
| `HTTPS_CERT`| Path to the TLS certificate (PEM)    |
| `HTTPS_CA`  | Optional CA chain file (PEM)         |

If either file is missing, the server refuses to boot (fail-closed). If the
variables are unset, the server runs plain HTTP exactly as before — nothing
changes for existing dev/CI/Docker setups. WebSocket attaches to the same
server instance either way.

We use [mkcert](https://github.com/FiloSottile/mkcert): it creates a local
certificate authority (CA) that your devices trust, so you get a green padlock
instead of browser warnings.

## One-time setup (Mac)

```bash
brew install mkcert nss
mkcert -install            # creates + trusts a local CA on your Mac
```

## Create a cert for your LAN IP

Find your Mac's LAN IP (`ipconfig getifaddr en0`), then in the repo:

```bash
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem \
  10.94.164.185 localhost 127.0.0.1   # replace with YOUR LAN IP
```

`certs/` is for local development only — **never commit real certificates**
(add it to `.gitignore` if it isn't already).

## Trust the CA on your phone (one time per device)

The phone must trust mkcert's root CA. Locate it:

```bash
mkcert -CAROOT    # e.g. ~/Library/Application Support/mkcert
```

Send `rootCA.pem` from that folder to the phone (AirDrop, email, etc.), then:

- **Android:** rename to `rootCA.crt`, open the file, or
  Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate. Chrome on Android trusts user CAs by default.
- **iOS:** open the file → Settings → Profile Downloaded → Install, then
  Settings → General → About → Certificate Trust Settings → enable full trust
  for the mkcert root.

## Run

```bash
NODE_ENV=development \
HTTPS_KEY=certs/key.pem HTTPS_CERT=certs/cert.pem \
npm start
```

You should see `CryptoPay server running (HTTPS) on 0.0.0.0:5001` in the log.

Open `https://10.94.164.185:5001` on the phone (your IP), unlock/create a
wallet, and the QR scanner camera will now start. Plain `http://` on the same
port will no longer respond while HTTPS is enabled — use `https://` everywhere,
including on the Mac itself.

## Alternatives (no certs)

- **Android Chrome flag:** `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
  → add `http://<LAN-IP>:5001` → Enabled → relaunch. Quick dev hack.
- **USB:** `adb reverse tcp:5001 tcp:5001`, then open `http://localhost:5001`
  on the phone (localhost is a secure context). Android only.

## Production note

This opt-in HTTPS is for **local/LAN testing**. Real deployments should
terminate TLS at a reverse proxy (the repo's `nginx.conf`) or a platform load
balancer, not in the Node process.
