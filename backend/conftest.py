"""Loaded by pytest before tests/conftest.py and before the app is imported.

backend/.env holds the real Supabase Storage settings. Setting them to empty
here means load_dotenv (which never overrides a variable that is already set)
leaves them empty, so no test can reach the real bucket. Tests that exercise
storage swap in a fake (see tests/test_storage.py).
"""
import os

for _key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_STORAGE_BUCKET"):
    os.environ[_key] = ""
