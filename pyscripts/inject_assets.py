from __future__ import annotations
import logging, os, subprocess

logger = logging.getLogger(__name__)


def inject_assets():
    user = os.getenv("QBL_ADMIN_USER")
    email = os.getenv("QBL_ADMIN_EMAIL")
    password = os.getenv("QBL_ADMIN_PWD")

    if not all([user, email, password]):
        raise EnvironmentError("Missing one of QBL_ADMIN_USER, QBL_ADMIN_EMAIL, QBL_ADMIN_PWD environment variables")

    results = subprocess.run(
        ["python", 
        "./server/tools/create_user.py", 
        str(user), str(email), str(password)
        ], 
        capture_output=True, 
        text=True
    )
    if results.returncode != 0:
        logger.error("Failed to create Website Admin:\n%s", results.stderr.strip())
        raise RuntimeError("Website Admin creation failed")
    logger.info("Website QBL_ADMIN User created successfully")