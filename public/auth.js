/* ==========================================================================
   Legally Unbullied — auth pages controller
   Sign in / sign up / email OTP / password reset, wired to Firebase Auth
   plus the server's /api/otp endpoints. Mirrors didit's flow energy:
   staggered view entrances, live validation, segmented OTP entry.
   ========================================================================== */

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

(function () {
  "use strict";

  /* ------------------------------ helpers ------------------------------ */

  const $ = (sel) => document.querySelector(sel);

  const params = new URLSearchParams(location.search);

  function safeNext() {
    const next = params.get("next") || "/";
    return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

  const pwRules = {
    length: (v) => v.length >= 8,
    number: (v) => /\d/.test(v),
    special: (v) => /[^A-Za-z0-9]/.test(v),
  };

  function friendlyAuthError(code) {
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "That email and password combination doesn't match our records.";
      case "auth/email-already-in-use":
        return "An account with this email already exists. Try signing in instead.";
      case "auth/weak-password":
        return "Choose a stronger password: 8+ characters with a number and a symbol.";
      case "auth/invalid-email":
        return "That email address doesn't look right.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a moment, then try again.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "The Google window was closed before finishing.";
      case "auth/network-request-failed":
        return "Network problem. Check your connection and try again.";
      default:
        return "Something went wrong. Try again.";
    }
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.hidden = !msg;
  }

  function setLoading(btn, loading, label) {
    if (loading) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = label || "One moment…";
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
    }
  }

  /* --------------------------- view switching --------------------------- */

  const titles = {
    signin: "Sign in · Legally Unbullied",
    signup: "Create an account · Legally Unbullied",
    otp: "Verify your email · Legally Unbullied",
    forgot: "Reset your password · Legally Unbullied",
    "forgot-sent": "Check your inbox · Legally Unbullied",
  };

  let resendTimer = null;

  function goto(view) {
    document.body.dataset.view = view;
    document.title = titles[view] || titles.signin;
    document.querySelectorAll(".auth-view").forEach((sec) => {
      sec.hidden = sec.dataset.view !== view;
    });
    if (view === "otp") {
      clearOtpBoxes();
      startResendCooldown();
      setTimeout(() => otpBoxes[0] && otpBoxes[0].focus(), 60);
    } else if (resendTimer) {
      clearInterval(resendTimer);
      resendTimer = null;
    }
  }

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-goto]");
    if (!trigger) return;
    e.preventDefault();
    goto(trigger.dataset.goto);
  });

  /* ---------------------------- eye toggles ----------------------------- */

  document.querySelectorAll(".field__eye").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.eye);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.style.color = show ? "var(--text)" : "";
    });
  });

  /* ------------------------------ sign in ------------------------------- */

  const signinEmail = $("#signin-email");
  const signinPassword = $("#signin-password");
  const signinSubmit = $("#signin-submit");
  const signinError = $("#signin-error");

  function refreshSignin() {
    signinSubmit.disabled = !(emailOk(signinEmail.value) && signinPassword.value.length > 0);
  }
  signinEmail.addEventListener("input", () => { showError(signinError, ""); refreshSignin(); });
  signinPassword.addEventListener("input", () => { showError(signinError, ""); refreshSignin(); });

  $("#signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (signinSubmit.disabled || !window.firebaseAuth) return;
    setLoading(signinSubmit, true, "Signing in…");
    try {
      await signInWithEmailAndPassword(window.firebaseAuth, signinEmail.value.trim(), signinPassword.value);
      location.href = safeNext();
    } catch (err) {
      showError(signinError, friendlyAuthError(err.code));
      setLoading(signinSubmit, false);
      refreshSignin();
    }
  });

  /* ------------------------------ sign up ------------------------------- */

  const signupEmail = $("#signup-email");
  const signupPassword = $("#signup-password");
  const signupTerms = $("#signup-terms");
  const signupSubmit = $("#signup-submit");
  const signupError = $("#signup-error");

  function refreshSignup() {
    const value = signupPassword.value;
    let allMet = true;
    for (const [rule, fn] of Object.entries(pwRules)) {
      const met = fn(value);
      document.querySelector(`#pw-rules [data-rule="${rule}"]`).classList.toggle("is-met", met);
      allMet = allMet && met;
    }
    signupSubmit.disabled = !(emailOk(signupEmail.value) && allMet && signupTerms.checked);
  }
  signupEmail.addEventListener("input", () => { showError(signupError, ""); refreshSignup(); });
  signupPassword.addEventListener("input", () => { showError(signupError, ""); refreshSignup(); });
  signupTerms.addEventListener("change", refreshSignup);

  const pending = { email: "", password: "" };

  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (signupSubmit.disabled) return;
    setLoading(signupSubmit, true, "Sending code…");
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signupEmail.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't send the code right now.");
      pending.email = signupEmail.value.trim();
      pending.password = signupPassword.value;
      $("#otp-email-echo").textContent = pending.email;
      setLoading(signupSubmit, false);
      refreshSignup();
      goto("otp");
    } catch (err) {
      showError(signupError, err.message);
      setLoading(signupSubmit, false);
      refreshSignup();
    }
  });

  /* -------------------------------- OTP --------------------------------- */

  const otpBoxes = Array.from(document.querySelectorAll(".otp-box"));
  const otpSubmit = $("#otp-submit");
  const otpError = $("#otp-error");
  const otpRow = $("#otp-row");
  const otpResend = $("#otp-resend");

  function otpValue() {
    return otpBoxes.map((b) => b.value).join("");
  }

  function refreshOtp() {
    otpSubmit.disabled = !/^\d{6}$/.test(otpValue());
  }

  function clearOtpBoxes() {
    otpBoxes.forEach((b) => (b.value = ""));
    otpRow.classList.remove("is-error");
    showError(otpError, "");
    refreshOtp();
  }

  otpBoxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      box.value = box.value.replace(/\D/g, "").slice(-1);
      otpRow.classList.remove("is-error");
      showError(otpError, "");
      if (box.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
      refreshOtp();
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !box.value && i > 0) otpBoxes[i - 1].focus();
    });
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
      text.split("").forEach((ch, idx) => { if (otpBoxes[idx]) otpBoxes[idx].value = ch; });
      (otpBoxes[Math.min(text.length, 5)] || box).focus();
      refreshOtp();
    });
  });

  otpSubmit.addEventListener("click", async () => {
    if (otpSubmit.disabled || !window.firebaseAuth) return;
    setLoading(otpSubmit, true, "Verifying…");
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pending.email, code: otpValue() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That code doesn't match.");

      await createUserWithEmailAndPassword(window.firebaseAuth, pending.email, pending.password);
      location.href = safeNext();
    } catch (err) {
      if (err.code && err.code.startsWith("auth/")) {
        showError(otpError, friendlyAuthError(err.code));
      } else {
        showError(otpError, err.message);
        otpRow.classList.add("is-error");
      }
      setLoading(otpSubmit, false);
      refreshOtp();
    }
  });

  /* resend cooldown */

  let cooldown = 0;
  function startResendCooldown() {
    cooldown = 30;
    otpResend.disabled = true;
    otpResend.textContent = `Resend code (${cooldown}s)`;
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      cooldown -= 1;
      if (cooldown <= 0) {
        clearInterval(resendTimer);
        resendTimer = null;
        otpResend.disabled = false;
        otpResend.textContent = "Resend code";
      } else {
        otpResend.textContent = `Resend code (${cooldown}s)`;
      }
    }, 1000);
  }

  otpResend.addEventListener("click", async () => {
    if (otpResend.disabled) return;
    otpResend.disabled = true;
    otpResend.textContent = "Sending…";
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: pending.email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't send the code right now.");
      clearOtpBoxes();
      otpBoxes[0].focus();
    } catch (err) {
      showError(otpError, err.message);
    }
    startResendCooldown();
  });

  /* ---------------------------- forgot flow ----------------------------- */

  const forgotEmail = $("#forgot-email");
  const forgotSubmit = $("#forgot-submit");
  const forgotError = $("#forgot-error");

  function refreshForgot() {
    forgotSubmit.disabled = !emailOk(forgotEmail.value);
  }
  forgotEmail.addEventListener("input", () => { showError(forgotError, ""); refreshForgot(); });

  $("#forgot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (forgotSubmit.disabled || !window.firebaseAuth) return;
    setLoading(forgotSubmit, true, "Sending…");
    try {
      await sendPasswordResetEmail(window.firebaseAuth, forgotEmail.value.trim());
      $("#forgot-email-echo").textContent = forgotEmail.value.trim();
      goto("forgot-sent");
    } catch (err) {
      showError(forgotError, friendlyAuthError(err.code));
      setLoading(forgotSubmit, false);
      refreshForgot();
    }
  });

  /* ------------------------------- google ------------------------------- */

  async function googleSignIn() {
    if (!window.firebaseAuth) return;
    try {
      await signInWithPopup(window.firebaseAuth, new GoogleAuthProvider());
      location.href = safeNext();
    } catch (err) {
      const target = document.body.dataset.view === "signup" ? signupError : signinError;
      showError(target, friendlyAuthError(err.code));
    }
  }
  $("#google-signin").addEventListener("click", googleSignIn);
  $("#google-signup").addEventListener("click", googleSignIn);

  /* ------------------------------- boot --------------------------------- */

  if (window.firebaseAuth) {
    onAuthStateChanged(window.firebaseAuth, (user) => {
      if (user) location.href = safeNext();
    });
  } else {
    const msg = "Sign-in isn't configured on this deployment yet. The app still works without an account.";
    showError(signinError, msg);
    showError(signupError, msg);
  }

  const mode = params.get("mode");
  goto(mode === "signup" || mode === "forgot" ? mode : "signin");
})();
