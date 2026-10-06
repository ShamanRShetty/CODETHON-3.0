# VaultLink 3-Minute Live Demo Script

> Step-by-step speaker script, browser cues, and terminal checks for demonstrating VaultLink.

---

## Pre-Demo Preparation & Setup Checklist (Rule 06)

Before presenting, complete this checklist 10 minutes prior to the demo:

- [ ] **Clean Environment:** Reset database with `npm run seed`.
- [ ] **Server Active:** Start server with `npm run dev` (running in terminal where console output is visible).
- [ ] **Browser Profiles Prepared:**
  - **Window 1 (Sender):** Chrome profile logged in as `alice@example.com` / `Password123!`.
  - **Window 2 (Recipient/Stranger):** Private / Incognito window or second browser profile ready for public link access.
- [ ] **Sample Files Ready:** Prepare a small PDF (e.g., `Financial_Q4_Report.pdf`) and a 20+ MB test file on desktop.
- [ ] **Terminal Visible:** Position the server terminal adjacent to the browser so the live `[VaultLink Mailer - Console Mode]` OTP output and server logs can be seen when requested.

---

## 3-Minute Live Demo Flow

### Minute 1: Upload, Encryption & Restricted Sharing

**Speaker Cue:**
> *"Today we're demonstrating VaultLink—a secure file sharing platform where files are encrypted at rest with AES-256-GCM, access is restricted to verified email recipients via one-time passcodes, and links are instantly revocable."*

1. **Step 1: Upload a File**
   - In **Window 1 (Alice)**, navigate to `http://localhost:3000/files.html`.
   - Click **Upload New File**, select `Financial_Q4_Report.pdf`, and submit.
   - Show that the file is uploaded.
2. **Step 2: Show Encrypted Storage at Rest**
   - Open terminal or file explorer to the `storage/` directory.
   - Show that the stored file is a random hexadecimal `.bin` file (e.g. `a3f890...bin`).
   - Run `head -c 50 storage/*.bin` or open in text editor to prove it contains unreadable encrypted ciphertext and authentication tags.
3. **Step 3: Create a Restricted Share**
   - In Alice's browser, click **Share** on `Financial_Q4_Report.pdf`.
   - Configure:
     - **Expiry:** 2 minutes (or 1 hour)
     - **Share Type:** Restricted
     - **Recipient Email:** `bob@example.com`
     - **Max Downloads:** `1`
   - Click **Create Share Link**.
   - Copy the generated one-time share link URL (e.g. `http://localhost:3000/s/TOKEN`).

---

### Minute 2: Unauthorized Access Blocked & OTP Verification

**Speaker Cue:**
> *"Now let's see what happens if someone who isn't on the recipient list tries to access or download the file."*

4. **Step 4: Unauthorized Stranger Blocked**
   - In **Window 2 (Incognito / Stranger)**, paste and open the share link (`http://localhost:3000/s/TOKEN`).
   - Note the neutral privacy-preserving interface: no file metadata, sender name, or recipient list is leaked.
   - Click **Continue to File**.
   - Enter `stranger@example.com` and click **Send Verification Code**.
   - The UI shows the neutral message *"If this email is allowed, a code was sent"*.
   - In the terminal, show that NO code was generated for `stranger@example.com`.
   - In **Window 1 (Alice)**, open `http://localhost:3000/timeline.html?share=ID` (or go to History $\rightarrow$ View Timeline).
   - Point out the red **BLOCKED** audit trail entry with the timestamp and IP address.

**Speaker Cue:**
> *"Now let's switch to the legitimate recipient, Bob."*

5. **Step 5: Legitimate Recipient OTP Verification & Download**
   - In **Window 2**, enter `bob@example.com` and click **Send Verification Code**.
   - Switch to the server terminal and show the formatted console email:
     ```text
     ========================================
     [VaultLink Mailer - Console Mode]
     To: bob@example.com
     Subject: Your VaultLink verification code
     Body: Your VaultLink verification code is: 492817
     ========================================
     ```
   - Enter the 6-digit code in Window 2 and click **Verify & Download**.
   - The file decrypts on the server on the fly and downloads immediately as `Financial_Q4_Report.pdf`.
   - Open the downloaded file to verify byte-for-byte fidelity.

---

### Minute 3: Download Limits, Instant Revocation & Audit Dashboard

**Speaker Cue:**
> *"Our share had a limit of 1 download. Let's see what happens if Bob or an attacker tries to download it again."*

6. **Step 6: Second Download Blocked (Limit Reached)**
   - Refresh Window 2 or attempt another download request.
   - Access is immediately denied with generic *"This link is unavailable"*.
   - Refresh Alice's History table: share status has automatically transitioned to `LIMIT_REACHED`.

7. **Step 7: Instant Live Revocation**
   - In Alice's files view, create a quick second share link with unlimited downloads.
   - Open the link in Window 2 to verify it opens the download prompt.
   - In Alice's History view, click the red **Revoke** button on that share and confirm.
   - Immediately refresh Window 2: the link is dead instantly (`REVOKED`), with zero reliance on background cleanup jobs.

8. **Step 8: Audit Timeline & Dashboard**
   - In Alice's account, navigate to `http://localhost:3000/dashboard.html`.
   - Highlight:
     - Total encrypted storage and file count metrics.
     - The 4 status summary cards (`ACTIVE`, `EXPIRED`, `REVOKED`, `LIMIT_REACHED`).
     - Real-time recent activity log containing every successful download and blocked attempt.
     - The notification bell with unread alert badges.

---

## Key Talking Points & Architectural Highlights

| Feature | What to Emphasize |
| :--- | :--- |
| **Envelope Encryption** | AES-256-GCM with per-file keys wrapped under server master key; storage contains ciphertext only. |
| **Dynamic Status** | Status is computed in SQL/code at evaluation time—never statically stored or dependent on cron jobs. |
| **Privacy by Design** | Public links never disclose filenames, owners, or allowed recipient lists before authentication. |
| **Auditability** | Complete visibility for data owners into who accessed their files and who was rejected. |
