from __future__ import annotations
import threading
import time
from typing import Any
from cachetools import TTLCache

class ServerCache:
    """Thread-safe in-memory TTL cache. Singleton — all instantiations return the same object."""
    cache = TTLCache(maxsize=1000, ttl=300)
    _instance: "ServerCache | None" = None
    _class_lock = threading.Lock()
    _lock: threading.Lock
    _store: dict[str, tuple[Any, float]]  # key -> (value, expires_at)

    def __new__(cls) -> "ServerCache":
        if cls._instance is None:
            with cls._class_lock:
                if cls._instance is None:
                    inst = super().__new__(cls)
                    inst._store = {}
                    inst._lock = threading.Lock()
                    cls._instance = inst
        return cls._instance

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires = entry
            if time.monotonic() > expires:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: float = 300.0) -> None:
        with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    def invalidate(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        now = time.monotonic()
        with self._lock:
            return sum(1 for _, (_, exp) in self._store.items() if now <= exp)

    def __repr__(self) -> str:
        return f"ServerCache(entries={len(self)})"

    