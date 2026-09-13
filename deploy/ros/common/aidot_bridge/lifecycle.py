"""Handle repeated service/terminal signals without interrupting cleanup."""
from contextlib import contextmanager
import signal
import threading


@contextmanager
def shutdown_requested():
    stopping = threading.Event()
    previous = {}
    try:
        for number in (signal.SIGINT, signal.SIGTERM):
            previous[number] = signal.signal(number, lambda *_: stopping.set())
        yield stopping
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)
