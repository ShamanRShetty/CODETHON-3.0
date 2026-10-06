/**
 * MoVo Public Recipient Page Script - Archive Register Design
 * Strict security: Generic error messages only ("This link is unavailable"), blob save, no leaks.
 */

let currentToken = '';
let currentEmail = '';

document.addEventListener('DOMContentLoaded', () => {
  currentToken = getShareToken();
  initFlow();
  initOtpBoxes();
});

function getShareToken() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 's') {
    return parts[1];
  }
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('token') || parts[parts.length - 1] || '';
}

function initOtpBoxes() {
  const otpInputs = document.querySelectorAll('.otp-digit');
  const inputCodeHidden = document.getElementById('input-code');

  otpInputs.forEach((input, index) => {
    // Handle typing and auto focus next
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val ? val.slice(-1) : '';

      if (e.target.value && index < otpInputs.length - 1) {
        otpInputs[index + 1].focus();
        otpInputs[index + 1].select();
      }
      syncOtpCode();
    });

    // Handle backspace
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        otpInputs[index - 1].focus();
        otpInputs[index - 1].value = '';
        syncOtpCode();
      }
    });

    // Handle Paste on any box
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const digits = (pasteData || '').replace(/[^0-9]/g, '').slice(0, 6);
      if (!digits) return;

      digits.split('').forEach((char, i) => {
        if (otpInputs[i]) {
          otpInputs[i].value = char;
        }
      });

      const nextFocus = Math.min(digits.length, otpInputs.length - 1);
      otpInputs[nextFocus].focus();
      syncOtpCode();
    });
  });

  function syncOtpCode() {
    let fullCode = '';
    otpInputs.forEach((i) => {
      fullCode += i.value || '';
    });
    if (inputCodeHidden) {
      inputCodeHidden.value = fullCode;
    }
  }
}

function getOtpValue() {
  const otpInputs = document.querySelectorAll('.otp-digit');
  if (otpInputs && otpInputs.length === 6) {
    let code = '';
    otpInputs.forEach((i) => {
      code += i.value || '';
    });
    if (code.length === 6) return code;
  }
  const hidden = document.getElementById('input-code');
  return hidden ? hidden.value.trim() : '';
}

function initFlow() {
  const btnInitialContinue = document.getElementById('btn-initial-continue');
  const formEmail = document.getElementById('form-email');
  const formOtp = document.getElementById('form-otp');
  const formPassword = document.getElementById('form-password');
  const btnResendOtp = document.getElementById('btn-resend-otp');
  const btnDownloadAgain = document.getElementById('btn-download-again');

  if (btnInitialContinue) {
    btnInitialContinue.addEventListener('click', async () => {
      clearMessages();
      setButtonLoading(btnInitialContinue, true, 'Verifying...');
      const success = await attemptDownload();
      setButtonLoading(btnInitialContinue, false, 'Proceed to Verification →');
      if (!success) {
        // Open share check failed -> move to email verification
        showStep('step-email');
      }
    });
  }

  if (formEmail) {
    formEmail.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();
      const inputEmail = document.getElementById('input-email');
      currentEmail = (inputEmail ? inputEmail.value : '').trim().toLowerCase();

      if (!currentEmail) return;

      const btn = document.getElementById('btn-request-otp');
      setButtonLoading(btn, true, 'Dispatching Code...');

      try {
        await fetch(`/s/${currentToken}/otp/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail }),
        });

        // Always show identical info message
        showInfo('If this email is on the access list, a 6-digit verification code was dispatched.');
        showStep('step-otp');
        setTimeout(() => {
          const firstDigit = document.querySelector('.otp-digit');
          if (firstDigit) firstDigit.focus();
        }, 100);
      } catch (err) {
        showError();
      } finally {
        setButtonLoading(btn, false, 'Dispatch Access Code');
      }
    });
  }

  if (formOtp) {
    formOtp.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();
      const code = getOtpValue();

      if (!code || code.length < 6) {
        showError('Please enter the full 6-digit code');
        return;
      }

      const btn = document.getElementById('btn-verify-otp');
      setButtonLoading(btn, true, 'Verifying...');

      try {
        const verifyRes = await fetch(`/s/${currentToken}/otp/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: currentEmail, code }),
        });

        if (!verifyRes.ok) {
          showError();
          return;
        }

        // OTP verified successfully (cookie is set), attempt download now
        const success = await attemptDownload();
        if (!success) {
          // Might need password
          showStep('step-password');
        }
      } catch (err) {
        showError();
      } finally {
        setButtonLoading(btn, false, 'Verify & Download');
      }
    });
  }

  if (btnResendOtp) {
    btnResendOtp.addEventListener('click', () => {
      clearMessages();
      showStep('step-email');
    });
  }

  if (formPassword) {
    formPassword.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMessages();
      const inputPassword = document.getElementById('input-password');
      const password = inputPassword ? inputPassword.value : '';

      const btn = document.getElementById('btn-submit-password');
      setButtonLoading(btn, true, 'Decrypting...');

      const success = await attemptDownload(password);
      setButtonLoading(btn, false, 'Decrypt & Download');

      if (!success) {
        showError();
      }
    });
  }

  if (btnDownloadAgain) {
    btnDownloadAgain.addEventListener('click', () => {
      clearMessages();
      showStep('step-initial');
    });
  }
}

async function attemptDownload(password) {
  try {
    const payload = password ? { password } : {};
    const res = await fetch(`/s/${currentToken}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return false;
    }

    // Extract filename from Content-Disposition header
    const disposition = res.headers.get('content-disposition');
    let filename = 'downloaded_file.bin';
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1].trim();
      }
    }

    const blob = await res.blob();
    triggerBlobDownload(blob, filename);

    const successFilename = document.getElementById('success-filename');
    if (successFilename) {
      successFilename.textContent = `Downloaded: ${filename}`;
    }

    showStep('step-success');
    return true;
  } catch (err) {
    return false;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

function showStep(stepId) {
  const steps = ['step-initial', 'step-email', 'step-otp', 'step-password', 'step-success'];
  for (const s of steps) {
    const el = document.getElementById(s);
    if (el) {
      if (s === stepId) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }
  }

  // Update 3-step progress strip
  const s1 = document.getElementById('progress-step-1');
  const s2 = document.getElementById('progress-step-2');
  const s3 = document.getElementById('progress-step-3');

  if (s1 && s2 && s3) {
    s1.className = 'progress-strip-step';
    s2.className = 'progress-strip-step';
    s3.className = 'progress-strip-step';

    if (stepId === 'step-initial' || stepId === 'step-email') {
      s1.classList.add('active');
    } else if (stepId === 'step-otp') {
      s1.classList.add('completed');
      s2.classList.add('active');
    } else if (stepId === 'step-password' || stepId === 'step-success') {
      s1.classList.add('completed');
      s2.classList.add('completed');
      s3.classList.add(stepId === 'step-success' ? 'completed' : 'active');
    }
  }
}

function showError(msg = 'This link is unavailable') {
  const banner = document.getElementById('error-banner');
  const text = document.getElementById('error-banner-text');
  if (banner && text) {
    text.textContent = msg;
    banner.classList.remove('hidden');
  }
}

function showInfo(msg) {
  const banner = document.getElementById('info-banner');
  const text = document.getElementById('info-banner-text');
  if (banner && text) {
    text.textContent = msg;
    banner.classList.remove('hidden');
  }
}

function clearMessages() {
  const err = document.getElementById('error-banner');
  if (err) err.classList.add('hidden');
  const info = document.getElementById('info-banner');
  if (info) info.classList.add('hidden');
}

function setButtonLoading(btn, isLoading, defaultText) {
  if (!btn) return;
  btn.disabled = isLoading;
  if (isLoading) {
    btn.textContent = defaultText || 'Processing...';
  } else {
    btn.textContent = defaultText;
  }
}
