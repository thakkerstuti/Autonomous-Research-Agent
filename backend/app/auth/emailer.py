"""Outgoing email (password reset) over SMTP, configured by environment.

Without SMTP settings: in development the reset link is printed to the
server console so the flow can be tested; in production nothing is logged
(the link is a credential) and a warning is recorded instead.
"""
import smtplib
import ssl
from email.message import EmailMessage

from app.auth import config

log = config.log


def send_password_reset(to_email: str, reset_url: str) -> None:
    subject = "Reset your CogNexa password"
    text = (
        "Someone asked to reset the password for your CogNexa account.\n\n"
        f"Choose a new password here (the link works once, for {config.RESET_TOKEN_MINUTES} minutes):\n"
        f"{reset_url}\n\n"
        "If this wasn't you, you can ignore this email; your password won't change."
    )

    if not config.SMTP_CONFIGURED:
        if config.IS_PRODUCTION:
            log.warning("Password reset requested but SMTP is not configured; no email was sent.")
        else:
            print(f"\n[dev] Password reset link for {to_email}:\n{reset_url}\n", flush=True)
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.SMTP_FROM
    msg["To"] = to_email
    msg.set_content(text)
    try:
        if config.SMTP_PORT == 465:
            with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, context=ssl.create_default_context(), timeout=15) as s:
                if config.SMTP_USERNAME:
                    s.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as s:
                s.starttls(context=ssl.create_default_context())
                if config.SMTP_USERNAME:
                    s.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                s.send_message(msg)
    except Exception as exc:  # never surface delivery problems to the requester
        log.error("Could not send password reset email: %s", type(exc).__name__)
