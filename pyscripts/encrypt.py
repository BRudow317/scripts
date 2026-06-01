import base64
import os
import secrets
import struct
from typing import Literal



KeyKind = Literal["jwt", "aes256", "fernet"]

_KEY_DESCRIPTIONS: dict[KeyKind, str] = {
    "jwt":    "URL-safe base64, 256-bit  — paste as JWT_SECRET in .env",
    "aes256": "base64-encoded 32-byte key — paste as UPLOAD_ENCRYPTION_KEY in .env",
    "fernet": "Fernet key (URL-safe base64, 32 bytes) — for file encryption",
}


def generate_key(kind: KeyKind) -> str:
    """
    Generate a cryptographically secure key of the requested kind.

    Returns the key as a plain string ready to paste into .env or a secrets store.
    No file I/O — call save_key() separately if you need persistence.

    Kinds:
        jwt    — secrets.token_urlsafe(32) → 256-bit URL-safe base64
        aes256 — os.urandom(32) → standard base64 (for AES-256)
        fernet — Fernet.generate_key() → URL-safe base64
    """
    if kind == "jwt":
        return secrets.token_urlsafe(32)
    if kind == "aes256":
        return base64.b64encode(os.urandom(32)).decode()
    if kind == "fernet":
        from cryptography.fernet import Fernet
        return Fernet.generate_key().decode()
    raise ValueError(f"Unknown key kind: {kind!r}. Valid options: {list(_KEY_DESCRIPTIONS)}")


def save_key(key: str, path: str) -> None:
    """Write a key string to a file (UTF-8, no trailing newline added)."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(key)


def generate_and_save_key(kind: KeyKind, path: str) -> str:
    """
    Generate a key of the given kind and save it to a file.

    Returns the generated key so you can print or use it immediately.

    Example:
        key = generate_and_save_key("jwt", ".secrets/jwt.key")
        print(f"JWT_SECRET={key}")
    """
    key = generate_key(kind)
    save_key(key, path)
    return key


def stream_and_tag(input_path, output_path):
    """
    Streams a file, replacing CR with <<CR>> and LF with <<LF>>.
    """
    with open(input_path, "rb") as f_in, open(output_path, "wb") as f_out:
        for line in f_in:
            processed = line.replace(b"\r", b"<<CR>>").replace(b"\n", b"<<LF>>")
            f_out.write(processed)


def b64_encode(data: bytes) -> str:
    """Encodes bytes to a Base64 string."""
    return base64.b64encode(data).decode("utf-8")


def b64_decode(data: str) -> bytes:
    """Decodes a Base64 string back to bytes."""
    return base64.b64decode(data)


def encrypt_data(data: bytes, key: bytes) -> bytes:
    """Encrypts bytes using the provided Fernet key."""
    from cryptography.fernet import Fernet
    f = Fernet(key)
    return f.encrypt(data)


def decrypt_data(token: bytes, key: bytes) -> bytes:
    """Decrypts a Fernet token back to the original bytes."""
    from cryptography.fernet import Fernet
    f = Fernet(key)
    return f.decrypt(token)


def stream_encrypt_file(input_path, output_path, key, chunk_size=64 * 1024):
    """Streams a file and encrypts it in chunks."""
    from cryptography.fernet import Fernet
    f = Fernet(key)

    with open(input_path, "rb") as f_in, open(output_path, "wb") as f_out:
        while True:
            chunk = f_in.read(chunk_size)
            if not chunk:
                break

            encrypted_chunk = f.encrypt(chunk)
            # Store chunk size first (unsigned 4-byte int), then encrypted bytes
            f_out.write(struct.pack("<I", len(encrypted_chunk)))
            f_out.write(encrypted_chunk)


def stream_decrypt_file(input_path, output_path, key):
    """Decrypts a file that was encrypted in chunks."""
    from cryptography.fernet import Fernet
    f = Fernet(key)

    with open(input_path, "rb") as f_in, open(output_path, "wb") as f_out:
        while True:
            size_data = f_in.read(4)
            if not size_data:
                break

            chunk_size = struct.unpack("<I", size_data)[0]
            encrypted_chunk = f_in.read(chunk_size)
            f_out.write(f.decrypt(encrypted_chunk))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Generate a cryptographic key.",
        epilog="Example: python -m scripts.encrypt jwt ./.secrets/jwt.key",
    )
    parser.add_argument(
        "kind",
        choices=list(_KEY_DESCRIPTIONS),
        help=f"Key type: {', '.join(_KEY_DESCRIPTIONS)}",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=None,
        help="File path to save the key. Omit to print to stdout only.",
    )
    args = parser.parse_args()

    key = generate_key(args.kind)

    if args.path:
        save_key(key, args.path)
        print(f"Saved {args.kind} key → {args.path}")

    print(key)