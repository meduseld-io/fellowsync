"""Encryption utilities for storing sensitive data at rest (e.g. Spotify Client Secrets)."""

import os
import logging
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

_KEY = os.getenv('ENCRYPTION_KEY', '')
_fernet = None


def _get_fernet():
    """Lazy-init Fernet cipher. Returns None if no key is configured."""
    global _fernet
    if _fernet is not None:
        return _fernet
    if not _KEY:
        logger.warning("ENCRYPTION_KEY not set — secrets will be stored in plaintext")
        return None
    try:
        _fernet = Fernet(_KEY.encode() if isinstance(_KEY, str) else _KEY)
        return _fernet
    except Exception as e:
        logger.error("Invalid ENCRYPTION_KEY: %s", e)
        return None


def encrypt(plaintext):
    """Encrypt a string. Returns encrypted string, or plaintext if no key configured."""
    f = _get_fernet()
    if not f:
        return plaintext
    try:
        return f.encrypt(plaintext.encode()).decode()
    except Exception as e:
        logger.error("Encryption failed: %s", e)
        return plaintext


def decrypt(ciphertext):
    """Decrypt a string. Returns decrypted string, or ciphertext as-is if no key configured."""
    f = _get_fernet()
    if not f:
        return ciphertext
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception as e:
        logger.error("Decryption failed: %s", e)
        return ciphertext


def generate_key():
    """Generate a new Fernet key. Useful for initial setup."""
    return Fernet.generate_key().decode()
