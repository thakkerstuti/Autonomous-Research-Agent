"""Test setup: a throwaway SQLite file and test-only settings.

The environment is set before the app is imported because configuration is
read at import time. Nothing here touches backend/cognexa.db.
"""
import os
import sys
import tempfile

_tmp = tempfile.mkdtemp(prefix="cognexa-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_tmp, 'test.db')}"
os.environ["UPLOAD_DIR"] = os.path.join(_tmp, "uploads")
os.environ["JWT_SECRET"] = "test-secret-" + "x" * 40
os.environ["FRONTEND_URL"] = "http://localhost:3001"
os.environ["ALLOWED_ORIGINS"] = "http://localhost:3001"
os.environ["AUTH_COOKIE_PATH"] = "/auth"  # tests call the API directly, without the /backend rewrite
os.environ["GOOGLE_CLIENT_ID"] = "test-client.apps.googleusercontent.com"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"
os.environ["OAUTH_REDIRECT_URI"] = "http://localhost:3001/backend/auth/google/callback"
os.environ["LLM_MOCK"] = "1"
os.environ["PAPER_WORKER"] = "inline"  # process papers synchronously in tests
for k in ("RENDER", "APP_ENV", "SMTP_HOST"):
    os.environ.pop(k, None)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402
from app.auth.security import limiter  # noqa: E402
from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402

ORIGIN = "http://localhost:3001"
HEADERS = {"Origin": ORIGIN, "X-CogNexa-Auth": "1"}


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    limiter.reset()
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def new_client():
    return TestClient(app)


def register(c, email="ada@example.com", password="correct horse battery", name="Ada"):
    return c.post("/auth/register", json={"email": email, "password": password, "name": name}, headers=HEADERS)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}
