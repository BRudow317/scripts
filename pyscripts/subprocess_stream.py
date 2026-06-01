from __future__ import annotations
import sys, threading, subprocess
from typing import IO, TextIO


def subprocess_stream(
        cmd: list[str], 
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        logfile: str | None = None
    ) -> None:
    process = subprocess.Popen(
        cmd, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.PIPE, 
        env=env, 
        cwd=cwd
        )
    assert process.stdout is not None
    assert process.stderr is not None

    log_lock = threading.Lock()
    lf = open(logfile, "a", encoding="utf-8") if logfile else None

    def stream_pipe(pipe: IO[bytes], out_stream: TextIO) -> None:
        for line in iter(pipe.readline, b""):
            text = line.decode("utf-8", errors="replace")
            out_stream.write(text)
            out_stream.flush()
            if lf:
                with log_lock:
                    lf.write(text)
                    lf.flush()
        pipe.close()

    t_out = threading.Thread(target=stream_pipe, args=(process.stdout, sys.stdout))
    t_err = threading.Thread(target=stream_pipe, args=(process.stderr, sys.stderr))
    t_out.start(); t_err.start(); t_out.join(); t_err.join()
    if lf: lf.close()
    process.wait()
    sys.exit( process.returncode )