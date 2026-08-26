"""Hash a master passphrase for FOLIO_MASTER_PASSWORD_HASH.

Reads the passphrase from stdin rather than argv so it never appears in the
process list or shell history.

    python scripts/hash_password.py < passphrase.txt
    Read-Host -AsSecureString | ... | python scripts/hash_password.py
"""
import sys

import bcrypt


def main() -> int:
    passphrase = sys.stdin.readline().rstrip("\r\n")
    if len(passphrase) < 8:
        print("Passphrase must be at least 8 characters.", file=sys.stderr)
        return 1
    print(bcrypt.hashpw(passphrase.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
