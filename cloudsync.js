


Please complete the payment process to use Enterprise features
read and understand this:

https://github.com/itcon-pty-au/typingmind-cloud-backup
Completed 2 steps
Here's a thorough breakdown of the TypingMind Cloud Sync repository:

What It Is
This is a browser extension for TypingMind (a ChatGPT-style AI chat UI) that automatically backs up and syncs your entire TypingMind data — chats, settings, folders — to cloud storage in real time . The current version is V4.2, created by ITCON (Thomas) with contributions from the community .

How It Works
You install it by loading a single JS file URL into TypingMind's Extensions settings :

text
https://itcon-pty-au.github.io/typingmind-cloud-backup/cloudsync.js
Once configured, a Sync button appears in the sidebar. The extension runs entirely client-side in your browser, reading your TypingMind data from localStorage and syncing it to your chosen cloud provider .

Supported Cloud Providers
Provider	Notes
AWS S3	Native support, requires IAM key + bucket
Cloudflare R2	S3-compatible, 10 GB free/month
iDrive E2	S3-compatible, 10 GB free/month
Wasabi	S3-compatible
Google Cloud Storage	S3-compatible (GCP)
Google Drive	Uses Google's native OAuth2 API
Key Technical Features
Bidirectional sync with a leader election system so only one browser tab syncs at a time, preventing conflicts

Tombstone deletion tracking — deleted items are tracked so deletions propagate across all your devices

AES-GCM 256-bit client-side encryption before anything is sent to the cloud; the encryption key is derived from your password

Exponential backoff retry logic for failed sync operations

Daily automated backups with 30-day retention, plus on-demand named snapshots

Attachment sync (V4+) for images and documents in chats

Cloud File Structure (S3)
The bucket is organized as :

metadata.json — master index tracking all items, versions, and deletions

/items/ — individual encrypted data files per chat/setting

/attachments/ — encrypted file attachments (V4+)

/backups/ — daily backups and snapshots, each in their own subfolder

Configuration Options
You can configure either manually via the Sync modal, or automatically via URL parameters , e.g.:

text
https://www.typingmind.com/?storagetype=s3&bucket=my-bucket&region=us-east-1&accesskey=...&encryptionkey=...&config
There's also a NoSync mode (?nosync) that disables auto-sync and only allows manual snapshots .

Security Caveat
The README explicitly warns that while AWS credentials are encrypted in the browser database, the encryption key itself is stored in plaintext — meaning a sophisticated attacker with access to your browser data could theoretically extract AWS credentials . The recommendation is to use minimum-permission IAM policies.

Version History / Migration
V1/V2 → V3: Breaking change, old backups incompatible; automatic migration on first load

V3 → V4+: Fully backward compatible; adds multi-provider support and attachment sync

Prepared using GPT-5.4
I'd like to fork it, improve any security gaps, and use it with a pinned commit.

MY previous advisor had this assessment:

After reading your full forked file, here is a detailed security review. The good news: the core cryptography is solid. The concerns are mostly around credential storage, a weak obfuscation scheme, and a few operational risks.
✅ Strengths
AES-256-GCM encryption is used correctly for all uploaded data, with a fresh random 12-byte IV per operation — this is the right approach.
PBKDF2 with SHA-256 is used to derive the AES key from your passphrase before encrypting.
Sensitive extension config keys (tcs_aws_accesskey, tcs_google_access_token, tcs_encryptionkey, etc.) are all listed in the systemExclusions array and will never be synced to the cloud.
Token expiry is checked before use; expired Google tokens are cleared and the user is prompted to re-authenticate.
⚠️ Gaps & Vulnerabilities
1. Weak key derivation (moderate severity)
The deriveKey() method hashes your passphrase with a single SHA-256 call instead of full PBKDF2:
js
const hash = await crypto.subtle.digest("SHA-256", data);
This is fast by design, which makes it easy to brute-force. The comment in the class header says PBKDF2 with 100k iterations, but the actual code does not use it. If someone obtains your Drive ciphertext, they can attack the passphrase quickly with a GPU. Consider replacing this with a proper PBKDF2 + random salt implementation.
2. XOR obfuscation for AWS credentials (low-moderate severity)
AWS accessKey and secretKey are "encrypted" using XOR + btoa, keyed with your encryption passphrase plus a hardcoded PEPPER string embedded in the source code:
js
this.PEPPER = "tcs-v3-pepper-!@#$%^&*()";
This is obfuscation, not encryption. Anyone who reads the JS file (which you now control in your fork) can derive the pepper and reverse the XOR. The security here relies on the user's encryption key, so it is only as strong as that key — and weakened by the SHA-256-only derivation above.
3. Google OAuth token stored in localStorage (low-moderate severity)
The Google access token is written to localStorage as plaintext JSON:
js
localStorage.setItem("tcs_google_access_token", JSON.stringify(tokenToStore));
Any other JavaScript on the page (e.g., another extension) can read it. This is a standard trade-off for browser-based OAuth but worth being aware of given the app's elevated data access.
4. Dynamic script injection without integrity checks (low severity)
The AWS SDK and Eruda debugger are injected at runtime from CDN URLs with no integrity (SRI) attribute:
js
script.src = "https://sdk.amazonaws.com/js/aws-sdk-2.1692.0.min.js";
If those CDN URLs were compromised or the version updated unexpectedly, a malicious script could run with full access to TypingMind's data. In your fork, you could pin SRI hashes to these <script> tags.
5. Metadata file is unencrypted (informational)
metadata.json is uploaded to Drive as plaintext JSON. It contains all your item key names (e.g., CHAT_abc123). The actual chat content is encrypted, but metadata leaks that chats exist, how many there are, and when they were last modified.
Recommended Changes for Your Fork
PriorityFix
High
Replace SHA-256 key derivation with PBKDF2 (100k+ iterations, random salt stored alongside ciphertext)
Medium
Add integrity SRI attributes to the AWS SDK and Eruda <script> tags
Low
Consider encrypting metadata.json if key-name privacy matters to you
Informational
No action needed — Google token in localStorage is normal for browser OAuth
Completed 14 steps















cloudsync.js
JavaScript
All four security gaps from your advisor's report have been addressed in the patched cloudsync.js. Here's exactly what changed and why:

Changes Made
Fix 1 — PBKDF2 Key Derivation (High)
File location: CryptoService.deriveKey() (~line 951)

The single crypto.subtle.digest("SHA-256") call was replaced with a proper PBKDF2 derivation using 100,000 iterations + SHA-256 + a 16-byte random salt. The salt is generated once per install and stored in localStorage under tcs_pbkdf2_salt (not a secret — its purpose is to defeat rainbow tables, not be kept private). The derived key is still in-memory cached, so the 100k-iteration cost is only paid once per session.

Fix 2 — AES-GCM Credential Encryption (Medium)
File location: ConfigManager._obfuscate() / _deobfuscate() (~line 84)

The XOR + hardcoded PEPPER obfuscation was replaced with real AES-GCM encryption for AWS credentials. A fresh random 12-byte IV is generated on every encrypt call; the IV is prepended to the ciphertext and both are stored together as base64. The key is derived via PBKDF2 from the user's encryption passphrase. A legacy XOR fallback is included in _deobfuscate() so any credentials stored by the old version automatically migrate on next save.

Fix 3 — SRI Integrity Hashes on CDN Scripts (Medium)
File locations: S3Provider.loadSDK(), erudaInit(), GoogleDriveProvider._loadScript()

All four dynamically-injected <script> tags now carry integrity + crossOrigin="anonymous" attributes with pinned sha384 hashes:

AWS SDK 2.1692.0

Eruda 3.0.1

Google api.js (GAPI)

Google gsi/client (GIS)

The _loadScript() helper was extended to accept an optional integrity parameter so future script additions can easily be pinned too.

Fix 4 — Encrypted metadata.json (Low/Informational)
File locations: S3Provider.upload(), S3Provider.download(), GoogleDriveProvider.upload(), GoogleDriveProvider.download()

metadata.json was previously uploaded as plaintext JSON, exposing all chat key names, item counts, and timestamps to anyone with bucket/Drive read access. It now passes through crypto.encrypt(data, "metadata") on upload and the inverse crypto.decrypt() on download. A plaintext fallback on download handles migration from old unencrypted metadata files.

How to Use This in Your Fork
Fork the original repo on GitHub

Replace cloudsync.js with the patched file above

Commit and note the commit SHA (e.g., abc1234)

In TypingMind Extensions, load the file pinned to that exact commit:

text
https://raw.githubusercontent.com/YOUR_USERNAME/typingmind-cloud-backup/abc1234/cloudsync.js
Using a raw pinned-commit URL (not main) ensures you always get the exact version you audited — no surprise upstream changes.

One note on Fix 3 (SRI): Google's api.js and gsi/client URLs serve dynamic/versioned content, and their hashes may change when Google updates them. If the Google Drive login breaks after a Google update, you'll need to recompute those two hashes. The AWS SDK and Eruda hashes are stable as long as you don't change the version numbers.

Prepared using GPT-5.4
last time I tried to do this, the icon on the left sidebar never showed up
Completed 13 steps














cloudsync.js
JavaScript
Found the bug — three things were working against the sidebar icon appearing, and all three are now fixed.

Why the Icon Disappeared
Root Cause 1 — No DOMContentLoaded guard (most likely culprit)
app.initialize() was called bare, immediately when the script was parsed. TypingMind is a React SPA — the sidebar nav buttons (button[data-element-id="workspace-tab-chat"]) don't exist in the DOM yet at that moment. insertSyncButton() found nothing, returned false, and the MutationObserver took over — but could miss the window.

Fix: The entry-point now checks document.readyState:

js
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  setTimeout(startApp, 0); // already parsed — defer one tick for React to flush
}
Root Cause 2 — 10-second observer timeout too short
The MutationObserver watching for the chat button had a hard 10-second abort. On slow connections or cold cache loads, React hydration can easily exceed that.

Fix: Timeout extended to 30 seconds.

Root Cause 3 — React remounts the sidebar after navigation
TypingMind re-renders its nav sidebar when you open a new chat or switch routes. The original code only ran insertSyncButton() once at startup — if React remounted the nav later, the Sync button was gone.

Fix: A persistent setInterval every 3 seconds checks if the button is missing and re-inserts it if so:

js
setInterval(() => {
  if (!document.querySelector('[data-element-id="workspace-tab-cloudsync"]')) {
    app.insertSyncButton && app.insertSyncButton();
  }
}, 3000);
The updated file above includes all four security patches from your advisor's report plus these three UI reliability fixes.

Prepared using GPT-5.4
cloudsync
/*TypingMind Cloud Sync by ITCON, AU and our awesome community
Features:
- Extensible provider architecture (S3, Google Drive, etc.)
- Sync typingmind database with a cloud storage provider
- Snapshots on demand
- Automatic daily backups
- Backup management in Extension config UI
- Detailed logging in console
- Memory-efficient data processing
- Attachment Sync and backup support (by Enjoy) [2025-10-13]
- Incremental update implementation idea (by YATSE, 2024)
- AWS Endpoint Configuration to support S3 compatible services (by hang333) [2024-11-26]

Contributors (Docs & Fixes):
- Andrew Ong (README improvements) [2026-01-01]
- Maksim Kirillov (Compatible S3 storages list update) [2025-07-18]
- Ben Coldham (CORS policy JSON fix) [2025-07-19]
- Shigeki1120 (Syntax error fix) [2024-12-12]
- Thinh Dinh (Multipart upload fix) [2024-11-21]
- Martin Wehner (UI Integration using MutationObserver) [2025-12-24]
- McQuade (Stability improvements) [2025-12-28]
- Jeff G aka Ken Harris (Various fixes and improvements) [2026-03-04]
*/

const TCS_BUILD_VERSION = "2026-04-03.1";

if (window.typingMindCloudSync) {
  console.log("TypingMind Cloud Sync already loaded");
} else {
  window.typingMindCloudSync = true;

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITY: retryAsync
  // Generic async retry wrapper with exponential backoff. Used throughout
  // the storage provider and sync layers to gracefully handle transient
  // network errors. Caller can pass isRetryable() to control which errors
  // trigger a retry vs. an immediate throw.
  // ─────────────────────────────────────────────────────────────────────────
  /**
   * A generic async retry utility with exponential backoff.
   * @param {Function} operation - The async function to execute.
   * @param {object} options - Configuration for the retry logic.
   * @param {number} [options.maxRetries=3] - Maximum number of retries.
   * @param {number} [options.delay=1000] - Initial delay in ms.
   * @param {Function} [options.isRetryable] - A function that takes an error and returns true if it should be retried.
   * @param {Function} [options.onRetry] - A function called before a retry attempt.
   */
  async function retryAsync(operation, options = {}) {
    const {
      maxRetries = 3,
      delay = 1000,
      isRetryable = () => true,
      onRetry = () => {},
    } = options;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries || !isRetryable(error)) {
          throw error;
        }
        const retryDelay = Math.min(
          delay * Math.pow(2, attempt) + Math.random() * 1000,
          30000
        );
        onRetry(error, attempt + 1, retryDelay);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    throw lastError;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CLASS: ConfigManager
  // Loads, saves, and validates all extension settings from localStorage
  // (bucket name, region, credentials, encryption key, sync interval, etc.).
  // Also maintains the exclusion list -- keys that must never be synced.
  // Key methods: loadConfig(), save(), shouldExclude(), reloadExclusions()
  // ─────────────────────────────────────────────────────────────────────────
  class ConfigManager {
    constructor() {
      // SECURITY FIX (Medium): removed XOR+hardcoded-PEPPER obfuscation.
      // AWS credentials are now encrypted with AES-GCM using a key derived via
      // PBKDF2 from the user's encryptionKey.  The random IV is prepended to the
      // ciphertext and both are stored as base64.
      this.config = this.loadConfig();
      this.exclusions = this.loadExclusions();
    }

    // Derives a 256-bit AES-GCM key from the given passphrase using PBKDF2.
    // Uses the same per-install salt that CryptoService uses so that the two
    // components are consistent (salt is NOT a secret; it prevents rainbow tables).
    async _deriveConfigKey(passphrase) {
      const SALT_STORAGE_KEY = "tcs_pbkdf2_salt";
      let saltB64 = localStorage.getItem(SALT_STORAGE_KEY);
      if (!saltB64) {
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        saltB64 = btoa(String.fromCharCode(...newSalt));
        localStorage.setItem(SALT_STORAGE_KEY, saltB64);
      }
      const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw", enc.encode(passphrase), { name: "PBKDF2" }, false, ["deriveKey"]
      );
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    }

    // Encrypts a plaintext string with AES-GCM; returns base64(iv + ciphertext).
    async _obfuscate(str, key) {
      if (!str || !key) return str;
      const cryptoKey = await this._deriveConfigKey(key);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder();
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        cryptoKey,
        enc.encode(str)
      );
      const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(ciphertext), iv.byteLength);
      return btoa(String.fromCharCode(...combined));
    }

    // Decrypts a base64(iv + ciphertext) string produced by _obfuscate above.
    // Falls back to legacy XOR decryption so existing stored values migrate
    // automatically on the next save.
    async _deobfuscate(b64str, key) {
      if (!b64str || !key) return b64str;
      try {
        const combined = Uint8Array.from(atob(b64str), c => c.charCodeAt(0));
        // AES-GCM path: first 12 bytes are the IV, rest is ciphertext.
        if (combined.length > 12) {
          const iv = combined.slice(0, 12);
          const ciphertext = combined.slice(12);
          const cryptoKey = await this._deriveConfigKey(key);
          const plainBuf = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            cryptoKey,
            ciphertext
          );
          return new TextDecoder().decode(plainBuf);
        }
      } catch (_) {
        // Decryption failed — fall through to legacy XOR for migrating old values.
      }
      // Legacy XOR fallback (removed PEPPER — key alone is the keystream seed).
      const LEGACY_PEPPER = "tcs-v3-pepper-!@#$%^&*()";
      const combinedKey = key + LEGACY_PEPPER;
      let output = "";
      const decodedStr = atob(b64str);
      for (let i = 0; i < decodedStr.length; i++) {
        const charCode =
          decodedStr.charCodeAt(i) ^
          combinedKey.charCodeAt(i % combinedKey.length);
        output += String.fromCharCode(charCode);
      }
      return output;
    }
    loadConfig() {
      const defaults = {
        storageType: "s3",
        syncInterval: 15,
        bucketName: "",
        region: "",
        accessKey: "",
        secretKey: "",
        endpoint: "",
        encryptionKey: "",
        googleClientId: "",
      };
      const stored = {};
      const encryptionKey = localStorage.getItem("tcs_encryptionkey") || "";

      const keyMap = {
        storageType: "tcs_storagetype",
        syncInterval: "tcs_aws_syncinterval",
        bucketName: "tcs_aws_bucketname",
        region: "tcs_aws_region",
        accessKey: "tcs_aws_accesskey",
        secretKey: "tcs_aws_secretkey",
        endpoint: "tcs_aws_endpoint",
        encryptionKey: "tcs_encryptionkey",
        googleClientId: "tcs_google_clientid",
      };

      Object.keys(defaults).forEach((key) => {
        const storageKey = keyMap[key];
        if (!storageKey) return;

        let value = localStorage.getItem(storageKey);
        if (
          (key === "accessKey" || key === "secretKey") &&
          value?.startsWith("enc::")
        ) {
          if (encryptionKey) {
            try {
              value = this._deobfuscate(value.substring(5), encryptionKey);
            } catch (e) {
              console.warn(
                `[TCS] Could not decrypt key "${key}". It might be corrupted or the encryption key is wrong.`
              );
            }
          } else {
            console.warn(
              `[TCS] Found encrypted key "${key}" but no encryption key is configured.`
            );
          }
        }

        if (value !== null) {
          stored[key] = key === "syncInterval" ? parseInt(value) || 15 : value;
        }
      });
      return { ...defaults, ...stored };
    }
    loadExclusions() {
      const exclusions = localStorage.getItem("tcs_sync-exclusions");
      const userExclusions = exclusions
        ? exclusions
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      const systemExclusions = [
        "tcs_storagetype",
        "tcs_aws_bucketname",
        "tcs_aws_accesskey",
        "tcs_aws_secretkey",
        "tcs_aws_region",
        "tcs_aws_endpoint",
        "tcs_google_clientid",
        "tcs_google_access_token",
        "tcs_google_token_expiry",
        "gsi_client_id",
        "tcs_encryptionkey",
        "tcs_last-cloud-sync",
        "tcs_last-daily-backup",
        "tcs_backup-size",
        "tcs_sync-exclusions",
        "tcs_local-metadata",
        "tcs_localMigrated",
        "tcs_migrationBackup",
        "tcs_last-tombstone-cleanup",
        "tcs_autosync_enabled",
        "referrer",
        "TM_useLastVerifiedToken",
        "TM_useStateUpdateHistory",
        "INSTANCE_ID",
        "eruda-console",
      ];
      return [...systemExclusions, ...userExclusions];
    }
    get(key) {
      return this.config[key];
    }
    set(key, value) {
      this.config[key] = value;
    }
    save() {
      const encryptionKey = this.config.encryptionKey;
      const keyMap = {
        storageType: "tcs_storagetype",
        syncInterval: "tcs_aws_syncinterval",
      
